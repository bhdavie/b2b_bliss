package com.bliss.b2b.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.BlissConfiguration.JwtConfig;
import com.bliss.b2b.api.AuthResource;
import com.bliss.b2b.api.IpRateLimiter;
import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.DemoPassword;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MasterPassword;
import com.bliss.b2b.auth.MerchantAuthenticator;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.MerchantStatus;
import com.bliss.b2b.integration.EmailMessage;
import com.bliss.b2b.persistence.AdminUserDao;
import com.bliss.b2b.persistence.CustomerDao;
import com.bliss.b2b.persistence.MagicLinkTokenDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.migration.V30__Encrypt_pms_connection_tokens;
import com.bliss.b2b.security.TokenCipher;
import jakarta.ws.rs.core.Response;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.flywaydb.core.Flyway;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/**
 * Signup protection and suspension: a property is created only when its
 * sign-up link is clicked (and Bliss is told), links to one address are spaced
 * out, link requests are rate limited per IP, and a suspended account gets no
 * links, no sign-in and no working session. Throwaway Postgres; SKIPS without
 * one.
 */
class SignupProtectionTest {

    private static final String ADMIN_URL = System.getenv().getOrDefault(
            "BLISS_TEST_DB_URL", "jdbc:postgresql://localhost:5432/bliss");
    private static final String DB_NAME =
            "bliss_signuptest_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    private static final Pattern TOKEN = Pattern.compile("token=([A-Za-z0-9_-]+)");

    private static Jdbi jdbi;
    private static String dbUrl;

    @BeforeAll
    static void createDatabase() {
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            assumeTrue(admin.isValid(2), "database not reachable; skipping");
            st.execute("CREATE DATABASE " + DB_NAME);
        } catch (Exception e) {
            assumeTrue(false, "cannot create a test database (" + e.getMessage() + "); skipping");
        }
        int slash = ADMIN_URL.lastIndexOf('/');
        int query = ADMIN_URL.indexOf('?', slash);
        dbUrl = ADMIN_URL.substring(0, slash + 1) + DB_NAME + (query < 0 ? "" : ADMIN_URL.substring(query));
        Flyway.configure().dataSource(dbUrl, null, null).locations("classpath:db/migration")
                .javaMigrations(new V30__Encrypt_pms_connection_tokens(TokenCipher.development()))
                .load().migrate();
        jdbi = Jdbi.create(dbUrl).installPlugin(new SqlObjectPlugin());
    }

    @AfterAll
    static void dropDatabase() throws Exception {
        if (dbUrl == null) return;
        try (Connection admin = DriverManager.getConnection(ADMIN_URL); Statement st = admin.createStatement()) {
            st.execute("DROP DATABASE IF EXISTS " + DB_NAME + " WITH (FORCE)");
        }
    }

    private final List<EmailMessage> sent = new ArrayList<>();

    private MagicLinkService links() {
        return new MagicLinkService(jdbi.onDemand(MerchantDao.class), jdbi.onDemand(CustomerDao.class),
                jdbi.onDemand(MagicLinkTokenDao.class), sent::add, new AppConfig(), Duration.ofMinutes(15), false)
                .withSignupAlert("brad@bliss-payments.test");
    }

    private static String email() {
        return "owner-" + UUID.randomUUID().toString().substring(0, 8) + "@inn.test";
    }

    private Optional<Merchant> merchant(String email) {
        return jdbi.onDemand(MerchantDao.class).findByEmail(email);
    }

    private String tokenSentTo(String email) {
        EmailMessage m = sent.stream().filter(e -> e.to().equals(email)).reduce((a, b) -> b).orElseThrow();
        Matcher match = TOKEN.matcher(m.body());
        assertThat(match.find()).isTrue();
        return match.group(1);
    }

    private void backdateLinks(String email) {
        jdbi.useHandle(h -> h.execute("""
                UPDATE magic_link_tokens SET created_at = created_at - INTERVAL '2 minutes'
                WHERE signup_email = ? OR merchant_id IN (SELECT id FROM merchants WHERE email = ?)""",
                email, email));
    }

    private void suspend(String email) {
        jdbi.useHandle(h -> h.execute("UPDATE merchants SET status = 'suspended' WHERE email = ?", email));
    }

    // --- Create the property on link click --------------------------------------

    @Test
    void requestingALinkCreatesNothing_clickingItCreatesTheVerifiedPropertyAndAlertsBliss() {
        String email = email();

        assertThat(links().requestLink(email)).isEqualTo(MagicLinkService.LinkResult.SENT);
        assertThat(merchant(email)).as("no row for an unconfirmed address").isEmpty();

        Optional<Merchant> signedIn = links().verify(tokenSentTo(email));

        assertThat(signedIn).hasValueSatisfying(m -> {
            assertThat(m.email()).isEqualTo(email);
            assertThat(m.status()).isEqualTo(MerchantStatus.ACTIVE);
            assertThat(m.emailVerifiedAt()).isNotNull();
        });
        assertThat(sent).filteredOn(e -> e.to().equals("brad@bliss-payments.test")).singleElement()
                .satisfies(e -> {
                    assertThat(e.subject()).isEqualTo("New property signup: " + email);
                    assertThat(e.body()).contains("Name: Not entered yet").contains("Email: " + email)
                            .contains("Signed up: ").contains("Onboarding step: created")
                            .doesNotContain("—");
                });
    }

    @Test
    void aSignUpLinkWorksOnce_andAnExistingPropertySignsInWithoutAnAlert() {
        String email = email();
        links().requestLink(email);
        String token = tokenSentTo(email);
        links().verify(token);
        assertThat(links().verify(token)).as("single use").isEmpty();

        backdateLinks(email);
        sent.clear();
        links().requestLink(email);
        assertThat(links().verify(tokenSentTo(email))).hasValueSatisfying(m ->
                assertThat(m.email()).isEqualTo(email));
        assertThat(sent).noneSatisfy(e -> assertThat(e.to()).isEqualTo("brad@bliss-payments.test"));
    }

    @Test
    void aSecondLinkToTheSameAddressWithinAMinuteIsNotSent() {
        String email = email();

        assertThat(links().requestLink(email)).isEqualTo(MagicLinkService.LinkResult.SENT);
        assertThat(links().requestLink(email)).isEqualTo(MagicLinkService.LinkResult.COOLDOWN);
        assertThat(sent).filteredOn(e -> e.to().equals(email)).hasSize(1);

        backdateLinks(email);
        assertThat(links().requestLink(email)).isEqualTo(MagicLinkService.LinkResult.SENT);
    }

    // --- Suspension ---------------------------------------------------------

    @Test
    void aSuspendedPropertyGetsNoLink_cannotUseAnOldOne_andStaysSuspended() {
        String email = email();
        links().requestLink(email);
        links().verify(tokenSentTo(email));
        backdateLinks(email);
        links().requestLink(email);
        String oldToken = tokenSentTo(email);
        backdateLinks(email);
        suspend(email);
        sent.clear();

        assertThat(links().requestLink(email)).isEqualTo(MagicLinkService.LinkResult.SUSPENDED);
        assertThat(sent).isEmpty();
        assertThat(links().verify(oldToken)).isEmpty();
        assertThat(merchant(email)).hasValueSatisfying(m -> assertThat(m.status()).isEqualTo(MerchantStatus.SUSPENDED));
    }

    @Test
    void aSuspendedPropertysExistingSessionStopsWorking() throws Exception {
        String email = email();
        links().requestLink(email);
        Merchant m = links().verify(tokenSentTo(email)).orElseThrow();
        JwtService jwt = new JwtService(new JwtConfig());
        String session = jwt.issue(m.email(), m.id().toString());
        MerchantAuthenticator auth = new MerchantAuthenticator(jwt, jdbi.onDemand(MerchantDao.class));
        assertThat(auth.authenticate(session)).isPresent();

        suspend(email);

        assertThat(auth.authenticate(session)).isEmpty();
    }

    @Test
    void theDemoPasswordCannotSignInASuspendedProperty() {
        String email = email();
        links().requestLink(email);
        links().verify(tokenSentTo(email));
        suspend(email);
        AuthResource resource = resource(Set.of(email));

        Response res = resource.passwordLogin(new AuthResource.PasswordLoginRequest(email, "master-secret-for-tests"));

        assertThat(res.getStatus()).isEqualTo(401);
        assertThat(res.getHeaderString("Set-Cookie")).isNull();
    }

    // --- Rate limit ---------------------------------------------------------

    @Test
    void linkRequestsAreRateLimitedPerIp() {
        AuthResource resource = resource(Set.of())
                .withLinkLimiter(new IpRateLimiter(2, Duration.ofMinutes(10), Clock.systemUTC()));

        assertThat(resource.requestMagicLink(new AuthResource.MagicLinkRequest(email()), null).getStatus())
                .isEqualTo(204);
        assertThat(resource.requestMagicLink(new AuthResource.MagicLinkRequest(email()), null).getStatus())
                .isEqualTo(204);
        Response third = resource.requestMagicLink(new AuthResource.MagicLinkRequest(email()), null);
        assertThat(third.getStatus()).isEqualTo(429);
        assertThat(third.getHeaderString("Retry-After")).isNotNull();
    }

    private AuthResource resource(Set<String> allowlist) {
        return new AuthResource(links(), new JwtService(new JwtConfig()),
                new CookieOptions(true, "None", ".bliss-payments.com"), false, 60,
                jdbi.onDemand(MerchantDao.class), jdbi.onDemand(AdminUserDao.class),
                new DemoPassword(new MasterPassword("master-secret-for-tests"), allowlist), allowlist);
    }
}
