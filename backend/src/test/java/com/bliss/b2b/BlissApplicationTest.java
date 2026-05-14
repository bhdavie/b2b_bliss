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

    private static String baseUrl() {
        return "http://localhost:" + APP.getLocalPort();
    }
}
