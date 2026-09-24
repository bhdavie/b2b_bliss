package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.JwtConfig;
import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.DemoPassword;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MasterPassword;
import com.bliss.b2b.domain.AdminUser;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MerchantStatus;
import com.bliss.b2b.domain.OnboardingState;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.persistence.AdminUserDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.service.MagicLinkService;
import jakarta.ws.rs.core.Response;
import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * The temporary demo password. It must sign in an allowlisted demo merchant with
 * the right password and nobody else, with one indistinguishable 401 for every
 * refusal, and it must never create an account.
 *
 * <p>"Never creates" is asserted rather than assumed: the MerchantDao stub
 * answers findByEmail and throws on every other method, so an insert would fail
 * the test, and devLogin (the call that provisions) is counted.
 */
class AuthResourcePasswordLoginTest {

    private static final String SECRET = "correct horse battery staple";
    private static final String DEMO = "demo@marbrook.test";
    private static final String ADMIN = "brad@bliss-payments.com";
    private static final String MERCHANT = "owner@realhotel.test";

    private final AtomicInteger provisioned = new AtomicInteger();

    @Test
    void anAllowlistedDemoMerchantSignsInWithTheRightPassword() {
        Response res = resource(SECRET, Set.of(DEMO), Set.of()).passwordLogin(request(DEMO, SECRET));

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(res.getHeaderString("Set-Cookie")).contains("bliss_session=");
        assertThat(provisioned).hasValue(0);
    }

    @Test
    void theEmailIsNormalisedBeforeTheAllowlistCheck() {
        Response res = resource(SECRET, Set.of(DEMO), Set.of())
                .passwordLogin(request("  DEMO@Marbrook.TEST ", SECRET));

        assertThat(res.getStatus()).isEqualTo(200);
    }

    @Test
    void anAllowlistedDemoMerchantWithTheWrongPasswordIs401() {
        Response res = resource(SECRET, Set.of(DEMO), Set.of()).passwordLogin(request(DEMO, "wrong"));

        assertInvalidCredentials(res);
    }

    @Test
    void aRealMerchantOffTheAllowlistIs401EvenWithTheMasterPassword() {
        // MERCHANT exists in the merchants table. Before fe5f691 this signed in.
        Response res = resource(SECRET, Set.of(DEMO), Set.of()).passwordLogin(request(MERCHANT, SECRET));

        assertInvalidCredentials(res);
    }

    @Test
    void anAdminIs401WithTheMasterPasswordEvenWhenAllowlisted() {
        // Allowlisted, right password, and a merchant row exists for it, so the
        // only thing that can refuse this is the admin check itself.
        Response res = resource(SECRET, Set.of(DEMO, ADMIN), Set.of(ADMIN))
                .passwordLogin(request(ADMIN, SECRET));

        assertInvalidCredentials(res);
    }

    @Test
    void anAllowlistedAddressWithNoMerchantIs401AndNothingIsCreated() {
        Response res = resource(SECRET, Set.of("nobody-yet@marbrook.test"), Set.of())
                .passwordLogin(request("nobody-yet@marbrook.test", SECRET));

        assertInvalidCredentials(res);
    }

    @Test
    void everyRefusalIsTheSameResponse() {
        // Wrong password, off the allowlist, admin, and no merchant row must be
        // indistinguishable, or the route answers questions about who is who.
        AuthResource r = resource(SECRET, Set.of(DEMO, ADMIN, "ghost@marbrook.test"), Set.of(ADMIN));
        for (Response res : new Response[] {
                r.passwordLogin(request(DEMO, "wrong")),
                r.passwordLogin(request(MERCHANT, SECRET)),
                r.passwordLogin(request(ADMIN, SECRET)),
                r.passwordLogin(request("ghost@marbrook.test", SECRET)) }) {
            assertInvalidCredentials(res);
        }
    }

    @Test
    void anUnsetMasterPasswordDisablesTheRoute() {
        for (String unset : new String[] { null, "", "   " }) {
            AuthResource r = resource(unset, Set.of(DEMO), Set.of());

            assertThat(r.passwordLogin(request(DEMO, SECRET)).getStatus()).isEqualTo(404);
            // An empty submission cannot match an unset secret either.
            assertThat(r.passwordLogin(request(DEMO, "x")).getStatus()).isEqualTo(404);
            assertThat(devStatus(r)).containsEntry("masterPasswordEnabled", false);
        }
    }

    @Test
    void anEmptyAllowlistDisablesTheRoute() {
        AuthResource r = resource(SECRET, Set.of(), Set.of());

        assertThat(r.passwordLogin(request(DEMO, SECRET)).getStatus()).isEqualTo(404);
        assertThat(devStatus(r)).containsEntry("masterPasswordEnabled", false);
    }

    @Test
    void devStatusReportsItWhenConfigured() {
        assertThat(devStatus(resource(SECRET, Set.of(DEMO), Set.of())))
                .containsEntry("masterPasswordEnabled", true)
                .containsEntry("devLoginEnabled", false);
    }

    @Test
    void aMissingEmailOrPasswordIs400() {
        AuthResource r = resource(SECRET, Set.of(DEMO), Set.of());

        assertThat(r.passwordLogin(null).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(null, SECRET)).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request("  ", SECRET)).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(DEMO, null)).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(DEMO, "")).getStatus()).isEqualTo(400);
    }

    // ---------------------------------------------------------------- helpers

    private void assertInvalidCredentials(Response res) {
        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getEntity()).isEqualTo(Map.of("error", "invalid_credentials"));
        assertThat(res.getHeaderString("Set-Cookie")).isNull();
        assertThat(provisioned).hasValue(0);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> devStatus(AuthResource r) {
        return (Map<String, Object>) r.devStatus().getEntity();
    }

    /**
     * Production-shaped: the dev-login gate is shut. Every address except the
     * "nobody-yet" and "ghost" ones has a merchant row, admins included, so the
     * admin refusal is tested against an address that would otherwise succeed.
     *
     * @param secret    MASTER_PASSWORD
     * @param allowlist BLISS_DEMO_LOGIN_EMAILS, already normalised
     * @param admins    addresses that have an admin_users row
     */
    private AuthResource resource(String secret, Set<String> allowlist, Set<String> admins) {
        return new AuthResource(
                magicLinkService(),
                new JwtService(new JwtConfig()),
                new CookieOptions(true, "None", ".bliss-payments.com"),
                false,
                60,
                merchantDao(Set.of(DEMO, ADMIN, MERCHANT)),
                adminUserDao(admins),
                new DemoPassword(new MasterPassword(secret), allowlist),
                allowlist);
    }

    private static AuthResource.PasswordLoginRequest request(String email, String password) {
        return new AuthResource.PasswordLoginRequest(email, password);
    }

    /** Counts the provisioning call. Password-login must never make it. */
    private MagicLinkService magicLinkService() {
        return new MagicLinkService(null, null, null, null, null, null, false) {
            @Override
            public Merchant devLogin(String email) {
                provisioned.incrementAndGet();
                return merchant(email);
            }
        };
    }

    /** findByEmail over a fixed set; any other method, an insert above all, throws. */
    private static MerchantDao merchantDao(Set<String> existing) {
        return (MerchantDao) Proxy.newProxyInstance(
                MerchantDao.class.getClassLoader(),
                new Class<?>[] { MerchantDao.class },
                (proxy, method, args) -> {
                    if (method.getName().equals("findByEmail")) {
                        String email = (String) args[0];
                        return existing.contains(email) ? Optional.of(merchant(email)) : Optional.empty();
                    }
                    throw new UnsupportedOperationException("password-login called " + method.getName());
                });
    }

    private static Merchant merchant(String email) {
        return new Merchant(
                UUID.randomUUID(), "marbrook", email, "Marbrook House", null, null,
                null, null, null, null, null, "US", null, "not_started",
                MerchantStatus.ACTIVE, PmsType.NONE, OnboardingState.ACTIVE,
                Instant.EPOCH, Instant.EPOCH, Instant.EPOCH);
    }

    private static AdminUserDao adminUserDao(Set<String> admins) {
        return new AdminUserDao() {
            @Override
            public Optional<AdminUser> findByEmail(String email) {
                return admins.contains(email)
                        ? Optional.of(new AdminUser(UUID.randomUUID(), email, "Admin", Instant.EPOCH, null))
                        : Optional.empty();
            }

            @Override
            public Optional<AdminUser> findById(UUID id) {
                throw new UnsupportedOperationException();
            }

            @Override
            public int touchLastLogin(UUID id, Instant now) {
                throw new UnsupportedOperationException();
            }
        };
    }
}
