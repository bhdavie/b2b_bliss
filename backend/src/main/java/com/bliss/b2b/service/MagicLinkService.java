package com.bliss.b2b.service;

import com.bliss.b2b.BlissConfiguration.AppConfig;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.persistence.MagicLinkTokenDao;
import com.bliss.b2b.persistence.MerchantDao;
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

public class MagicLinkService {

    private static final Logger log = LoggerFactory.getLogger(MagicLinkService.class);
    private static final SecureRandom RNG = new SecureRandom();
    private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();

    private final MerchantDao merchantDao;
    private final MagicLinkTokenDao tokenDao;
    private final EmailService emailService;
    private final AppConfig appConfig;
    private final Duration linkTtl;
    /**
     * When true, merchants created here are flagged {@code is_demo=true} so the
     * dev reset kill switch can purge them. Set from {@code BLISS_DEMO_LOGIN}:
     * while the instance is in demo mode, every new signup is a demo account.
     */
    private final boolean demoSignups;

    public MagicLinkService(
            MerchantDao merchantDao,
            MagicLinkTokenDao tokenDao,
            EmailService emailService,
            AppConfig appConfig,
            Duration linkTtl,
            boolean demoSignups
    ) {
        this.merchantDao = merchantDao;
        this.tokenDao = tokenDao;
        this.emailService = emailService;
        this.appConfig = appConfig;
        this.linkTtl = linkTtl;
        this.demoSignups = demoSignups;
    }

    /**
     * Idempotent on email: if no merchant exists for the email, one is created
     * in pending_verification. Always issues a fresh magic link.
     */
    public void requestLink(String email) {
        String normalized = email.trim().toLowerCase();
        Merchant merchant = merchantDao.findByEmail(normalized).orElseGet(() -> {
            String slug = generateSlug();
            merchantDao.insertPending(slug, normalized, demoSignups);
            log.info("Created merchant slug={} email={} demo={}", slug, normalized, demoSignups);
            return merchantDao.findByEmail(normalized).orElseThrow();
        });
        String rawToken = randomToken();
        String hash = sha256Hex(rawToken);
        Instant expiresAt = Instant.now().plus(linkTtl);
        tokenDao.insert(merchant.id(), hash, expiresAt);
        // /verify is a merchant-dashboard route, so this is the merchant host.
        String link = appConfig.getMerchantBaseUrl() + "/verify?token=" + rawToken;
        try {
            emailService.send(EmailTemplates.magicLink(merchant.email(), link, linkTtl));
        } catch (Exception e) {
            // The token row was written before the send, so drop it rather than
            // leave a live credential nobody received. Best-effort: if the
            // delete also fails the row still expires on its own.
            try {
                tokenDao.deleteByHash(hash);
            } catch (Exception cleanupFailure) {
                log.warn("Could not delete undelivered magic-link token for {}: {}",
                        merchant.email(), cleanupFailure.getMessage());
            }
            log.warn("Failed to send magic link to {}: {}", merchant.email(), e.getMessage());
            throw new MagicLinkDeliveryException("Could not deliver magic link to " + merchant.email(), e);
        }
    }

    /**
     * Dev-only shortcut: find-or-create a merchant for the email and mark it
     * verified without any token check. The caller (gated on dev mode) issues
     * a session immediately. Re-uses the same find-or-create + mark-verified
     * primitives as the real flow so onboarding state stays consistent.
     */
    public Merchant devLogin(String email) {
        String normalized = email.trim().toLowerCase();
        Merchant merchant = merchantDao.findByEmail(normalized).orElseGet(() -> {
            String slug = generateSlug();
            merchantDao.insertPending(slug, normalized, demoSignups);
            log.info("Dev-login created merchant slug={} email={} demo={}", slug, normalized, demoSignups);
            return merchantDao.findByEmail(normalized).orElseThrow();
        });
        if (merchant.emailVerifiedAt() == null) {
            merchantDao.markVerified(merchant.id(), Instant.now());
            return merchantDao.findById(merchant.id()).orElseThrow();
        }
        return merchant;
    }

    /**
     * Returns the merchant for a valid, unconsumed, unexpired token. Consumes
     * the token in the same call. Empty for invalid/expired/already-used tokens.
     */
    public Optional<Merchant> verify(String rawToken) {
        String hash = sha256Hex(rawToken);
        Instant now = Instant.now();
        Optional<UUID> merchantId = tokenDao.findActiveMerchantId(hash, now);
        if (merchantId.isEmpty()) return Optional.empty();
        int consumed = tokenDao.consume(hash, now);
        if (consumed == 0) return Optional.empty();
        Merchant merchant = merchantDao.findById(merchantId.get()).orElseThrow();
        if (merchant.emailVerifiedAt() == null) {
            merchantDao.markVerified(merchant.id(), now);
            return merchantDao.findById(merchant.id());
        }
        return Optional.of(merchant);
    }

    private static String randomToken() {
        byte[] buf = new byte[32];
        RNG.nextBytes(buf);
        return URL_ENCODER.encodeToString(buf);
    }

    private static String generateSlug() {
        byte[] buf = new byte[6];
        RNG.nextBytes(buf);
        return URL_ENCODER.encodeToString(buf).toLowerCase();
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
