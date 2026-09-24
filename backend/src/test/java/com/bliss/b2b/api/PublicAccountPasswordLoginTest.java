package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.JwtConfig;
import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.DemoPassword;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MasterPassword;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.service.CustomerAuthService;
import jakarta.ws.rs.core.Response;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The temporary demo password on the guest surface: an allowlisted address with
 * an existing guest account, with the right password, and nobody else.
 *
 * <p>"Never creates a guest account" is asserted rather than assumed: the
 * CustomerDao stub answers the lookup and the last-login stamp, and throws on
 * every other method, so an insert would fail the test.
 */
class PublicAccountPasswordLoginTest {

    private static final String SECRET = "correct horse battery staple";
    private static final String DEMO_GUEST = "saoirse.byrne+seed@example.com";
    private static final String REAL_GUEST = "real.guest@example.com";

    @Test
    void anAllowlistedGuestSignsInWithTheRightPassword() {
        Response res = resource(SECRET, Set.of(DEMO_GUEST)).passwordLogin(request(DEMO_GUEST, SECRET));

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(res.getHeaderString("Set-Cookie")).contains("bliss_customer_session=");
    }

    @Test
    void theEmailIsNormalisedBeforeTheAllowlistCheck() {
        Response res = resource(SECRET, Set.of(DEMO_GUEST))
                .passwordLogin(request("  Saoirse.Byrne+SEED@example.com ", SECRET));

        assertThat(res.getStatus()).isEqualTo(200);
    }

    @Test
    void anAllowlistedGuestWithTheWrongPasswordIs401() {
        assertInvalidCredentials(
                resource(SECRET, Set.of(DEMO_GUEST)).passwordLogin(request(DEMO_GUEST, "wrong")));
    }

    @Test
    void aRealGuestOffTheAllowlistIs401EvenWithTheMasterPassword() {
        // REAL_GUEST has a customer row; only the allowlist keeps it out.
        assertInvalidCredentials(
                resource(SECRET, Set.of(DEMO_GUEST)).passwordLogin(request(REAL_GUEST, SECRET)));
    }

    @Test
    void anAllowlistedAddressWithNoGuestAccountIs401AndNothingIsCreated() {
        // Same 401, not /magic-link's no_account_found, and the DAO stub would
        // throw on any insert.
        assertInvalidCredentials(resource(SECRET, Set.of("nobody-yet@example.com"))
                .passwordLogin(request("nobody-yet@example.com", SECRET)));
    }

    @Test
    void anUnsetMasterPasswordDisablesTheRoute() {
        for (String unset : new String[] { null, "", "   " }) {
            PublicAccountResource r = resource(unset, Set.of(DEMO_GUEST));

            assertThat(r.passwordLogin(request(DEMO_GUEST, SECRET)).getStatus()).isEqualTo(404);
            assertThat(r.passwordLogin(request(DEMO_GUEST, "x")).getStatus()).isEqualTo(404);
            assertThat(devStatus(r)).containsEntry("masterPasswordEnabled", false);
        }
    }

    @Test
    void anEmptyAllowlistDisablesTheRoute() {
        PublicAccountResource r = resource(SECRET, Set.of());

        assertThat(r.passwordLogin(request(DEMO_GUEST, SECRET)).getStatus()).isEqualTo(404);
        assertThat(devStatus(r)).containsEntry("masterPasswordEnabled", false);
    }

    @Test
    void devStatusReportsItWhenConfigured() {
        assertThat(devStatus(resource(SECRET, Set.of(DEMO_GUEST))))
                .containsEntry("masterPasswordEnabled", true)
                .containsEntry("devLoginEnabled", false);
    }

    @Test
    void aMissingEmailOrPasswordIs400() {
        PublicAccountResource r = resource(SECRET, Set.of(DEMO_GUEST));

        assertThat(r.passwordLogin(null).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(" ", SECRET)).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(DEMO_GUEST, "")).getStatus()).isEqualTo(400);
    }

    // ---------------------------------------------------------------- helpers

    private static void assertInvalidCredentials(Response res) {
        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getEntity()).isEqualTo(Map.of("error", "invalid_credentials"));
        assertThat(res.getHeaderString("Set-Cookie")).isNull();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> devStatus(PublicAccountResource r) {
        return (Map<String, Object>) r.devStatus().getEntity();
    }

    /** Production-shaped: the dev-login gate is shut. Both guests have customer rows. */
    private static PublicAccountResource resource(String secret, Set<String> allowlist) {
        CustomerDao customers = customerDao(Set.of(DEMO_GUEST, REAL_GUEST));
        JwtService jwt = new JwtService(new JwtConfig());
        return new PublicAccountResource(
                new CustomerAuthService(customers, jwt, Clock.systemUTC()),
                null, // magicLinkService: password-login does not use it
                false,
                null, // planDao: only /plans uses it
                customers,
                Clock.systemUTC(),
                new CookieOptions(true, "None", ".bliss-payments.com"),
                60,
                new DemoPassword(new MasterPassword(secret), allowlist));
    }

    private static PublicAccountResource.PasswordLoginRequest request(String email, String password) {
        return new PublicAccountResource.PasswordLoginRequest(email, password);
    }

    /** findByEmail over a fixed set, plus the last-login stamp; anything else throws. */
    private static CustomerDao customerDao(Set<String> existing) {
        return (CustomerDao) Proxy.newProxyInstance(
                CustomerDao.class.getClassLoader(),
                new Class<?>[] { CustomerDao.class },
                (proxy, method, args) -> switch (method.getName()) {
                    case "findByEmail" -> {
                        String email = (String) args[0];
                        yield existing.contains(email)
                                ? Optional.of(new Customer(UUID.randomUUID(), email, null, "Demo",
                                        "Guest", null, null, Instant.EPOCH, Instant.EPOCH))
                                : Optional.empty();
                    }
                    case "touchLastLogin" -> 1;
                    default -> throw new UnsupportedOperationException(
                            "guest password-login called " + method.getName());
                });
    }
}
