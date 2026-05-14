package com.bliss.b2b;

import static org.assertj.core.api.Assertions.assertThat;

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
            ResourceHelpers.resourceFilePath("config-test.yml"));

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

    private static String baseUrl() {
        return "http://localhost:" + APP.getLocalPort();
    }
}
