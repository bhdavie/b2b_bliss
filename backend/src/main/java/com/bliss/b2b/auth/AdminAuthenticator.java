package com.bliss.b2b.auth;

import com.bliss.b2b.domain.AdminUser;
import com.bliss.b2b.persistence.AdminUserDao;
import io.dropwizard.auth.AuthenticationException;
import io.dropwizard.auth.Authenticator;
import io.jsonwebtoken.Claims;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Admin session verification.
 *
 * <p>Every check here is positive, unlike the merchant path which historically
 * relied on other subjects simply not carrying a {@code merchantId} claim. A
 * token gets in only if it says {@code role=admin}, carries a parseable
 * {@code adminUserId}, and that row is still present in {@code admin_users}.
 * Deleting the row revokes every outstanding session for it immediately, which
 * matters more here than on the other two surfaces.
 */
public class AdminAuthenticator implements Authenticator<String, AdminPrincipal> {

    private static final Logger log = LoggerFactory.getLogger(AdminAuthenticator.class);

    private final JwtService jwtService;
    private final AdminUserDao adminUserDao;

    public AdminAuthenticator(JwtService jwtService, AdminUserDao adminUserDao) {
        this.jwtService = jwtService;
        this.adminUserDao = adminUserDao;
    }

    @Override
    public Optional<AdminPrincipal> authenticate(String token) throws AuthenticationException {
        try {
            Claims claims = jwtService.verify(token);
            if (!"admin".equals(claims.get("role"))) return Optional.empty();
            String adminUserIdStr = claims.get("adminUserId", String.class);
            if (adminUserIdStr == null || adminUserIdStr.isBlank()) return Optional.empty();
            UUID adminUserId = UUID.fromString(adminUserIdStr);
            Optional<AdminUser> admin = adminUserDao.findById(adminUserId);
            return admin.map(AdminPrincipal::new);
        } catch (Exception e) {
            log.debug("Admin JWT verification failed: {}", e.getMessage());
            return Optional.empty();
        }
    }
}
