package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.domain.AdminUser;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.persistence.AdminUserDao;
import com.bliss.b2b.persistence.MagicLinkTokenDao;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Sign-in for the Bliss internal admin.
 *
 * <p>Same token primitives as {@link MagicLinkService}: the same RNG, the same
 * SHA-256 hash at rest, the same TTL, the same single-use consume. Only the
 * subject differs, so the three families cannot drift in how a credential is
 * minted or retired.
 *
 * <p>The one deliberate difference is that every entry point here fails closed
 * on an unknown email. The merchant flow is find-or-create because asking for a
 * link IS how a property signs up; there is no admin signup, so an address that
 * does not already match an {@code admin_users} row gets nothing — no row, no
 * token, no email.
 */
public class AdminAuthService {

    private static final Logger log = LoggerFactory.getLogger(AdminAuthService.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();

    private final AdminUserDao adminUserDao;
    private final MagicLinkTokenDao tokenDao;
    private final EmailService emailService;
    private final AppConfig appConfig;
    private final Duration linkTtl;

    public AdminAuthService(
            AdminUserDao adminUserDao,
            MagicLinkTokenDao tokenDao,
            EmailService emailService,
            AppConfig appConfig,
            Duration linkTtl
    ) {
        this.adminUserDao = adminUserDao;
        this.tokenDao = tokenDao;
        this.emailService = emailService;
        this.appConfig = appConfig;
        this.linkTtl = linkTtl;
    }

    /**
     * Issues an admin magic link for an EXISTING admin.
     *
     * @return empty when no admin_users row has that email, so the caller can
     *         answer identically whether or not the address is one of ours.
     */
    public Optional<AdminUser> requestLink(String email) {
        if (email == null || email.isBlank()) return Optional.empty();
        String normalized = email.trim().toLowerCase();
        Optional<AdminUser> maybe = adminUserDao.findByEmail(normalized);
        if (maybe.isEmpty()) {
            log.info("Admin magic link requested for unknown email");
            return Optional.empty();
        }
        AdminUser admin = maybe.get();
        String rawToken = randomToken();
        String hash = sha256Hex(rawToken);
        Instant expiresAt = Instant.now().plus(linkTtl);
        tokenDao.insertForAdmin(admin.id(), hash, expiresAt);
        // Resolves to app/(admin)/admin/verify/page.tsx. The admin portal is
        // served from the merchant deployment and origin rather than getting a
        // host of its own: it is internal, linked from nowhere, and middleware
        // deliberately leaves /admin out of the two-hostname split, so
        // merchantBaseUrl is the correct base here and not a placeholder.
        String link = appConfig.getMerchantBaseUrl() + "/admin/verify?token=" + rawToken;
        try {
            emailService.send(EmailTemplates.magicLink(admin.email(), link, linkTtl));
        } catch (Exception e) {
            // The row was written before the send, so drop it rather than leave
            // a live credential nobody received. Same cleanup as the other two.
            try {
                tokenDao.deleteByHash(hash);
            } catch (Exception cleanupFailure) {
                log.warn("Could not delete undelivered admin magic-link token: {}",
                        cleanupFailure.getMessage());
            }
            log.warn("Failed to send admin magic link: {}", e.getMessage());
            throw new MagicLinkDeliveryException(
                    "Could not deliver magic link to " + admin.email(), e);
        }
        return Optional.of(admin);
    }

    /**
     * Returns the admin for a valid, unconsumed, unexpired ADMIN token, and
     * consumes it. A merchant or guest token returns empty: the DAO lookup
     * filters on subject_type, so the families cannot cross over.
     */
    public Optional<AdminUser> verify(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return Optional.empty();
        String hash = sha256Hex(rawToken);
        Instant now = Instant.now();
        Optional<UUID> adminUserId = tokenDao.findActiveAdminUserId(hash, now);
        if (adminUserId.isEmpty()) return Optional.empty();
        int consumed = tokenDao.consume(hash, now);
        if (consumed == 0) return Optional.empty();
        adminUserDao.touchLastLogin(adminUserId.get(), now);
        return adminUserDao.findById(adminUserId.get());
    }

    /**
     * Dev-only shortcut, gated by the caller. Skips the token round trip but
     * NOT the existence check: unlike the merchant equivalent this never
     * creates anything, so an unknown email returns empty and the resource
     * answers 401.
     */
    public Optional<AdminUser> devLogin(String email) {
        if (email == null || email.isBlank()) return Optional.empty();
        String normalized = email.trim().toLowerCase();
        Optional<AdminUser> maybe = adminUserDao.findByEmail(normalized);
        if (maybe.isEmpty()) {
            log.info("Admin dev-login attempted for unknown email");
            return Optional.empty();
        }
        AdminUser admin = maybe.get();
        adminUserDao.touchLastLogin(admin.id(), Instant.now());
        return adminUserDao.findById(admin.id());
    }

    private static String randomToken() {
        byte[] buf = new byte[32];
        RNG.nextBytes(buf);
        return URL_ENCODER.encodeToString(buf);
    }

    private static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
