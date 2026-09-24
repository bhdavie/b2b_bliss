package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.JwtConfig;
import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.DemoPassword;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MasterPassword;
import com.bliss.b2b.domain.AdminUser;
import com.bliss.b2b.service.AdminAuthService;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The temporary demo password on the admin surface: an allowlisted address that
 * is already an admin, with the right password, and nobody else. Every refusal is
 * the same 401 as the merchant route, so the internal admin list cannot be
 * enumerated through it, and nothing is ever created (AdminAuthService.devLogin
 * is the find-only lookup, and there is no admin signup to fall into).
 */
class AdminAuthResourcePasswordLoginTest {

    private static final String SECRET = "correct horse battery staple";
    private static final String ADMIN = "brad@bliss-payments.com";
    private static final String OTHER_ADMIN = "ops@bliss-payments.com";

    @Test
    void anAllowlistedAdminSignsInWithTheRightPassword() {
        Response res = resource(SECRET, Set.of(ADMIN)).passwordLogin(request(ADMIN, SECRET));

        assertThat(res.getStatus()).isEqualTo(200);
        assertThat(res.getHeaderString("Set-Cookie")).contains("bliss_admin_session=");
    }

    @Test
    void theEmailIsNormalisedBeforeTheAllowlistCheck() {
        Response res = resource(SECRET, Set.of(ADMIN))
                .passwordLogin(request("  BRAD@Bliss-Payments.COM ", SECRET));

        assertThat(res.getStatus()).isEqualTo(200);
    }

    @Test
    void anAllowlistedAdminWithTheWrongPasswordIs401() {
        assertInvalidCredentials(resource(SECRET, Set.of(ADMIN)).passwordLogin(request(ADMIN, "wrong")));
    }

    @Test
    void anAdminOffTheAllowlistIs401EvenWithTheMasterPassword() {
        // OTHER_ADMIN has an admin_users row. Before fe5f691 this signed in.
        assertInvalidCredentials(
                resource(SECRET, Set.of(ADMIN)).passwordLogin(request(OTHER_ADMIN, SECRET)));
    }

    @Test
    void anAllowlistedAddressThatIsNotAnAdminIs401() {
        // The demo merchant is allowlisted, but that must not make it an admin.
        assertInvalidCredentials(resource(SECRET, Set.of(ADMIN, "demo@marbrook.test"))
                .passwordLogin(request("demo@marbrook.test", SECRET)));
    }

    @Test
    void anUnsetMasterPasswordDisablesTheRoute() {
        for (String unset : new String[] { null, "", "   " }) {
            AdminAuthResource r = resource(unset, Set.of(ADMIN));

            assertThat(r.passwordLogin(request(ADMIN, SECRET)).getStatus()).isEqualTo(404);
            assertThat(r.passwordLogin(request(ADMIN, "x")).getStatus()).isEqualTo(404);
        }
    }

    @Test
    void anEmptyAllowlistDisablesTheRoute() {
        assertThat(resource(SECRET, Set.of()).passwordLogin(request(ADMIN, SECRET)).getStatus())
                .isEqualTo(404);
    }

    @Test
    void aMissingEmailOrPasswordIs400() {
        AdminAuthResource r = resource(SECRET, Set.of(ADMIN));

        assertThat(r.passwordLogin(null).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(" ", SECRET)).getStatus()).isEqualTo(400);
        assertThat(r.passwordLogin(request(ADMIN, "")).getStatus()).isEqualTo(400);
    }

    // ---------------------------------------------------------------- helpers

    private static void assertInvalidCredentials(Response res) {
        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getEntity()).isEqualTo(Map.of("error", "invalid_credentials"));
        assertThat(res.getHeaderString("Set-Cookie")).isNull();
    }

    /**
     * Production-shaped: the dev-login gate is shut. ADMIN and OTHER_ADMIN both
     * have admin_users rows.
     */
    private static AdminAuthResource resource(String secret, Set<String> allowlist) {
        return new AdminAuthResource(
                adminAuthService(Set.of(ADMIN, OTHER_ADMIN)),
                new JwtService(new JwtConfig()),
                new CookieOptions(true, "None", ".bliss-payments.com"),
                false,
                60,
                new DemoPassword(new MasterPassword(secret), allowlist));
    }

    private static AdminAuthResource.PasswordLoginRequest request(String email, String password) {
        return new AdminAuthResource.PasswordLoginRequest(email, password);
    }

    /** Nulls are safe: the constructor only assigns, and devLogin is overridden. */
    private static AdminAuthService adminAuthService(Set<String> admins) {
        return new AdminAuthService(null, null, null, null, null) {
            @Override
            public Optional<AdminUser> devLogin(String email) {
                return admins.contains(email)
                        ? Optional.of(new AdminUser(UUID.randomUUID(), email, "Admin", Instant.EPOCH, null))
                        : Optional.empty();
            }
        };
    }
}
