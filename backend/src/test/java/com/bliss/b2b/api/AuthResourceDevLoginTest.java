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
import com.bliss.b2b.service.MagicLinkService;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * The dev-login gate. The demo password has its own file,
 * {@link AuthResourcePasswordLoginTest}.
 *
 * <p>Three properties, and the third is the one worth the file on its own: an
 * admin address must not get through even when it is on the allowlist, and must
 * be refused BEFORE {@link MagicLinkService#devLogin} runs, because that call
 * provisions a verified merchant for an address it does not recognise. A refusal
 * that happened after it would have created the very account it was refusing.
 *
 * <p>Hand-rolled stubs rather than a mocking framework: this module has AssertJ
 * and dropwizard-testing and no Mockito, and the collaborators here are a
 * three-method interface and one overridable method.
 */
class AuthResourceDevLoginTest {

    private static final String DEMO = "demo@marbrook.test";
    private static final String ADMIN = "brad@bliss-payments.com";
    private static final String STRANGER = "someone-else@example.test";

    /** Counts devLogin calls, so "refused before provisioning" is a real assertion. */
    private final AtomicInteger provisioned = new AtomicInteger();

    @Test
    void productionRefusesAnAddressThatIsNotOnTheAllowlist() {
        Response res = resource(Set.of(DEMO), Set.of()).devLogin(request(STRANGER));

        // 404, not 401: the closed route does not admit to existing.
        assertThat(res.getStatus()).isEqualTo(404);
        assertThat(provisioned).hasValue(0);
    }

    @Test
    void anAdminAddressIsRefusedEvenWhenItIsOnTheAllowlist() {
        // Allowlisted AND the gate open, so the only thing that can reject this
        // is the admin check itself.
        Response res = resource(Set.of(ADMIN, DEMO), Set.of(ADMIN)).devLogin(request(ADMIN));

        assertThat(res.getStatus()).isEqualTo(404);
        // The whole point: no merchant was minted for the admin on the way out.
        assertThat(provisioned).hasValue(0);
    }

    @Test
    void anAllowlistedDemoMerchantSignsInWithTheGateShut() {
        Response res = resource(Set.of(DEMO), Set.of()).devLogin(request(DEMO));

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(provisioned).hasValue(1);
        assertThat(res.getHeaderString("Set-Cookie")).contains("bliss_session=");
    }

    @Test
    void theAddressIsNormalisedBeforeEitherCheck() {
        // Allowlist and admin lookup both key on the lowercased, trimmed form, so
        // neither can be stepped around with casing or padding.
        assertThat(resource(Set.of(DEMO), Set.of()).devLogin(request("  DEMO@Marbrook.TEST ")).getStatus())
                .isEqualTo(200);
        assertThat(resource(Set.of(ADMIN), Set.of(ADMIN)).devLogin(request("  BRAD@Bliss-Payments.COM ")).getStatus())
                .isEqualTo(404);
    }

    @Test
    void aMissingEmailIsRejectedAheadOfTheGate() {
        assertThat(resource(Set.of(DEMO), Set.of()).devLogin(request(null)).getStatus()).isEqualTo(400);
        assertThat(resource(Set.of(DEMO), Set.of()).devLogin(request("   ")).getStatus()).isEqualTo(400);
        assertThat(resource(Set.of(DEMO), Set.of()).devLogin(null).getStatus()).isEqualTo(400);
        assertThat(provisioned).hasValue(0);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * @param allowlist BLISS_DEMO_LOGIN_EMAILS, already normalised
     * @param admins    addresses that have an admin_users row
     */
    private AuthResource resource(Set<String> allowlist, Set<String> admins) {
        return new AuthResource(
                magicLinkService(),
                new JwtService(new JwtConfig()),
                new CookieOptions(true, "None", ".bliss-payments.com"),
                // false = the production gate. The allowlist is the only way through.
                false,
                60,
                null, // merchantDao: only password-login uses it
                adminUserDao(admins),
                new DemoPassword(new MasterPassword(null), allowlist),
                allowlist);
    }

    private static AuthResource.DevLoginRequest request(String email) {
        return new AuthResource.DevLoginRequest(email);
    }

    /** Nulls are safe: the constructor only assigns, and devLogin is overridden. */
    private MagicLinkService magicLinkService() {
        return new MagicLinkService(null, null, null, null, null, null, false) {
            @Override
            public Merchant devLogin(String email) {
                provisioned.incrementAndGet();
                return new Merchant(
                        UUID.randomUUID(), "marbrook", email, "Marbrook House", null, null,
                        null, null, null, null, null, "US", null, "not_started",
                        MerchantStatus.ACTIVE, PmsType.NONE, OnboardingState.ACTIVE,
                        Instant.EPOCH, Instant.EPOCH, Instant.EPOCH);
            }
        };
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
