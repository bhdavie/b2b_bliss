package com.bliss.b2b;

import static org.assertj.core.api.Assertions.assertThat;

import io.dropwizard.testing.ConfigOverride;
import io.dropwizard.testing.ResourceHelpers;
import io.dropwizard.testing.junit5.DropwizardAppExtension;
import io.dropwizard.testing.junit5.DropwizardExtensionsSupport;
import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.core.GenericType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * Smoke tests that don't need a real database. The Phase 1 magic-link and
 * /merchants endpoints are covered by manual end-to-end verification against
 * native Postgres until we wire Testcontainers for fully-isolated integration
 * tests.
 */
@ExtendWith(DropwizardExtensionsSupport.class)
class BlissApplicationTest {

    private static final GenericType<Map<String, Object>> JSON_OBJECT =
            new GenericType<Map<String, Object>>() {};

    private static final DropwizardAppExtension<BlissConfiguration> APP = new DropwizardAppExtension<>(
            BlissApplication.class,
            ResourceHelpers.resourceFilePath("config-test.yml"),
            // Demo password switched on, so dev-status reports it below.
            ConfigOverride.config("masterPassword", "test-master-password"),
            ConfigOverride.config("demoLoginEmails", "demo@marbrook.test"));

    private static Client client;

    @BeforeAll
    static void setUpClient() {
        client = ClientBuilder.newClient();
    }

    @AfterAll
    static void tearDownClient() {
        if (client != null) {
            client.close();
        }
    }

    @Test
    void helloReturnsOk() {
        Response response = client.target(baseUrl() + "/api/v1/hello").request().get();
        assertThat(response.getStatus()).isEqualTo(200);
        Map<String, Object> body = response.readEntity(JSON_OBJECT);
        assertThat(body).containsEntry("status", "ok").containsEntry("service", "bliss-b2b-backend");
    }

    @Test
    void protectedEndpointRequiresAuth() {
        Response noAuth = client.target(baseUrl() + "/api/v1/hello/me").request().get();
        assertThat(noAuth.getStatus()).isEqualTo(401);

        Response badBearer = client.target(baseUrl() + "/api/v1/hello/me")
                .request()
                .header("Authorization", "Bearer garbage")
                .get();
        assertThat(badBearer.getStatus()).isEqualTo(401);

        Response badCookie = client.target(baseUrl() + "/api/v1/hello/me")
                .request()
                .cookie("bliss_session", "garbage")
                .get();
        assertThat(badCookie.getStatus()).isEqualTo(401);
    }

    @Test
    void magicLinkRejectsEmptyEmail() {
        Response empty = client.target(baseUrl() + "/api/v1/auth/magic-link")
                .request()
                .post(jakarta.ws.rs.client.Entity.json(Map.of("email", "")));
        assertThat(empty.getStatus()).isEqualTo(400);
    }

    @Test
    void verifyRejectsBlankToken() {
        Response empty = client.target(baseUrl() + "/api/v1/auth/verify")
                .request()
                .post(jakarta.ws.rs.client.Entity.json(Map.of("token", "")));
        assertThat(empty.getStatus()).isEqualTo(400);
    }

    // GET /api/v1/public/merchants/{slug} requires DB access to validate the
    // slug — see the smoke test for end-to-end coverage. Unit-test the
    // validation surface of the checkout endpoint instead; those paths fail
    // fast before any DAO call.

    @Test
    void publicCheckout_invalidFrequency_returns400() {
        // Bad frequency surfaces before any DB / Stripe work.
        Response res = client.target(baseUrl() + "/api/v1/public/checkout")
                .request()
                .post(jakarta.ws.rs.client.Entity.json(Map.of(
                        "merchantSlug", "anything",
                        "totalAmountCents", 180000,
                        "appointmentDate", "2027-01-01",
                        "customerEmail", "x@y.z",
                        "customerName", "X Y",
                        "paymentMethodId", "pm_fake",
                        "frequency", "weekly")));
        assertThat(res.getStatus()).isEqualTo(400);
        Map<String, Object> body = res.readEntity(JSON_OBJECT);
        assertThat(body).containsEntry("error", "invalid_frequency");
    }

    @Test
    void publicCheckout_invalidAppointmentDate_returns400() {
        Response res = client.target(baseUrl() + "/api/v1/public/checkout")
                .request()
                .post(jakarta.ws.rs.client.Entity.json(Map.of(
                        "merchantSlug", "anything",
                        "totalAmountCents", 180000,
                        "appointmentDate", "not-a-date",
                        "customerEmail", "x@y.z",
                        "customerName", "X Y",
                        "paymentMethodId", "pm_fake",
                        "frequency", "monthly")));
        assertThat(res.getStatus()).isEqualTo(400);
        Map<String, Object> body = res.readEntity(JSON_OBJECT);
        assertThat(body).containsEntry("error", "invalid_appointment_date");
    }

    /** dev-status reports the demo password, which is what shows the field. */
    @Test
    void devStatusReportsTheDemoPassword() {
        Response res = client.target(baseUrl() + "/api/v1/auth/dev-status").request().get();
        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(res.readEntity(JSON_OBJECT))
                .containsKey("devLoginEnabled")
                .containsEntry("masterPasswordEnabled", true);
    }

    @Test
    void publicCheckout_stripeNotConfigured_returns503() {
        // Stripe is intentionally not configured in the test config, so any
        // request that gets past JSON parsing hits the 503 inert path.
        Response res = client.target(baseUrl() + "/api/v1/public/checkout")
                .request()
                .post(jakarta.ws.rs.client.Entity.json(Map.of(
                        "merchantSlug", "anything",
                        "totalAmountCents", 180000,
                        "appointmentDate", "2099-01-01",
                        "customerEmail", "x@y.z",
                        "customerName", "X Y",
                        "paymentMethodId", "pm_fake",
                        "frequency", "monthly")));
        assertThat(res.getStatus()).isEqualTo(503);
        Map<String, Object> body = res.readEntity(JSON_OBJECT);
        assertThat(body).containsEntry("error", "stripe_not_configured");
    }

    // Guest referral intake. Everything below fails before any DB work, so it
    // runs without Postgres. Each test sends its own X-Forwarded-For, because
    // the limiter is keyed on it and this app instance is shared by the class.

    @Test
    void publicReferral_invalidEmail_returns400() {
        Response res = client.target(baseUrl() + "/api/v1/public/referrals")
                .request()
                .header("X-Forwarded-For", "198.51.100.10")
                .post(jakarta.ws.rs.client.Entity.json(Map.of(
                        "guestEmail", "not-an-email",
                        "hotelName", "The Lumiares",
                        "hotelCity", "Lisbon")));
        assertThat(res.getStatus()).isEqualTo(400);
        assertThat(res.readEntity(JSON_OBJECT)).containsEntry("error", "invalid_email");
    }

    @Test
    void publicReferral_blankHotelCity_returns400() {
        Response res = client.target(baseUrl() + "/api/v1/public/referrals")
                .request()
                .header("X-Forwarded-For", "198.51.100.11")
                .post(jakarta.ws.rs.client.Entity.json(Map.of(
                        "guestEmail", "maya@example.com",
                        "hotelName", "The Lumiares",
                        "hotelCity", "   ")));
        assertThat(res.getStatus()).isEqualTo(400);
        assertThat(res.readEntity(JSON_OBJECT)).containsEntry("error", "invalid_hotel_city");
    }

    @Test
    void publicReferral_sixthPostFromOneIpInTheWindow_returns429() {
        // Invalid bodies on purpose: the limiter counts every POST, and a 400
        // never reaches the database, so the first five are cheap and DB-free.
        // The key is the LAST X-Forwarded-For entry, the one the router
        // appends, so a different client-supplied first entry on every request
        // does not buy a fresh budget.
        for (int i = 0; i < 5; i++) {
            Response res = client.target(baseUrl() + "/api/v1/public/referrals")
                    .request()
                    .header("X-Forwarded-For", "10.9.9." + i + ", 198.51.100.20")
                    .post(jakarta.ws.rs.client.Entity.json(Map.of("guestEmail", "")));
            assertThat(res.getStatus()).as("attempt %d", i + 1).isEqualTo(400);
        }
        Response limited = client.target(baseUrl() + "/api/v1/public/referrals")
                .request()
                .header("X-Forwarded-For", "203.0.113.99, 198.51.100.20")
                .post(jakarta.ws.rs.client.Entity.json(Map.of("guestEmail", "")));
        assertThat(limited.getStatus()).isEqualTo(429);
        assertThat(limited.getHeaderString("Retry-After")).isNotBlank();
        assertThat(limited.readEntity(JSON_OBJECT)).containsEntry("error", "rate_limited");

        // A different caller is unaffected.
        Response other = client.target(baseUrl() + "/api/v1/public/referrals")
                .request()
                .header("X-Forwarded-For", "198.51.100.21")
                .post(jakarta.ws.rs.client.Entity.json(Map.of("guestEmail", "")));
        assertThat(other.getStatus()).isEqualTo(400);
    }

    // Admin referral queue. No cookie and a garbage token both stop at the
    // admin auth filter, before AdminAuthenticator would touch admin_users.

    @Test
    void adminReferrals_requireAdminAuth() throws Exception {
        String id = java.util.UUID.randomUUID().toString();

        assertThat(client.target(baseUrl() + "/api/v1/admin/referrals").request().get().getStatus())
                .isEqualTo(401);
        assertThat(client.target(baseUrl() + "/api/v1/admin/referrals/" + id).request().get().getStatus())
                .isEqualTo(401);
        assertThat(client.target(baseUrl() + "/api/v1/admin/referrals")
                .request()
                .cookie("bliss_admin_session", "garbage")
                .get().getStatus())
                .isEqualTo(401);
        // A merchant session cookie is the wrong cookie entirely.
        assertThat(client.target(baseUrl() + "/api/v1/admin/referrals")
                .request()
                .cookie("bliss_session", "garbage")
                .get().getStatus())
                .isEqualTo(401);

        // PATCH through java.net.http: the default Jersey client connector
        // (HttpURLConnection) cannot send PATCH without a reflection workaround.
        java.net.http.HttpClient http = java.net.http.HttpClient.newHttpClient();
        java.net.http.HttpResponse<String> patch = http.send(
                java.net.http.HttpRequest.newBuilder(
                                java.net.URI.create(baseUrl() + "/api/v1/admin/referrals/" + id))
                        .header("Content-Type", "application/json")
                        .method("PATCH", java.net.http.HttpRequest.BodyPublishers.ofString(
                                "{\"status\":\"contacted\"}"))
                        .build(),
                java.net.http.HttpResponse.BodyHandlers.ofString());
        assertThat(patch.statusCode()).isEqualTo(401);
    }

    private static String baseUrl() {
        return "http://localhost:" + APP.getLocalPort();
    }
}
