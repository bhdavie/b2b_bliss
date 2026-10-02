package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.JwtConfig;
import com.bliss.b2b.auth.JwtCookieAuthFilter;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MerchantAuthenticator;
import com.bliss.b2b.auth.MerchantPrincipal;
import io.dropwizard.auth.AuthDynamicFeature;
import io.dropwizard.auth.AuthValueFactoryProvider;
import io.dropwizard.testing.junit5.DropwizardExtensionsSupport;
import io.dropwizard.testing.junit5.ResourceExtension;
import jakarta.ws.rs.client.Entity;
import java.util.stream.Stream;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Every merchant route under /api/v1/merchants/me reaches its handler. Several
 * resources share that prefix; a class rooted at "/api/v1/merchants/me" wins
 * JAX-RS root matching for every /me path and 404s the ones it doesn't define,
 * which took down GET /merchants/me (the dashboard's session read) in October
 * 2026. Without a session cookie each route must answer 401 (it was matched and
 * asked for credentials), never 404 (it was never matched).
 */
@ExtendWith(DropwizardExtensionsSupport.class)
class MerchantRoutesTest {

    private static final ResourceExtension RESOURCES = ResourceExtension.builder()
            .addProvider(new AuthDynamicFeature(new JwtCookieAuthFilter.Builder()
                    .setAuthenticator(new MerchantAuthenticator(new JwtService(new JwtConfig()), null))
                    .setPrefix("Bearer")
                    .setRealm("bliss-b2b")
                    .buildAuthFilter()))
            .addProvider(new AuthValueFactoryProvider.Binder<>(MerchantPrincipal.class))
            .addResource(new MerchantsResource(null, null, null))
            .addResource(new BlissSettingsResource(null))
            .addResource(new MewsSyncResource(null, null, null))
            .addResource(new PayoutsResource(null, null))
            .build();

    static Stream<Arguments> routes() {
        return Stream.of(
                Arguments.of("GET", "/api/v1/merchants/me"),
                Arguments.of("PATCH", "/api/v1/merchants/me"),
                Arguments.of("PUT", "/api/v1/merchants/me/property-locale"),
                Arguments.of("GET", "/api/v1/merchants/me/stripe-status"),
                Arguments.of("GET", "/api/v1/merchants/me/bliss-settings"),
                Arguments.of("PUT", "/api/v1/merchants/me/bliss-settings"),
                Arguments.of("POST", "/api/v1/merchants/me/bliss/enable"),
                Arguments.of("GET", "/api/v1/merchants/me/mews-sync"),
                Arguments.of("POST", "/api/v1/merchants/me/mews-sync"),
                Arguments.of("PUT", "/api/v1/merchants/me/bliss-rates/rate-1/booking-type"),
                Arguments.of("GET", "/api/v1/merchants/me/releases"),
                Arguments.of("GET", "/api/v1/merchants/me/payouts"));
    }

    @ParameterizedTest(name = "{0} {1}")
    @MethodSource("routes")
    void everyMerchantRouteIsMatched(String method, String path) {
        var request = RESOURCES.target(path).request();
        int status = switch (method) {
            case "GET" -> request.get().getStatus();
            case "POST" -> request.post(Entity.json("{}")).getStatus();
            case "PUT" -> request.put(Entity.json("{}")).getStatus();
            default -> request.method(method, Entity.json("{}")).getStatus();
        };
        assertThat(status).as(method + " " + path).isEqualTo(401);
    }
}
