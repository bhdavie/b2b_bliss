package com.bliss.b2b.service;

import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.domain.Customer;
import com.bliss.b2b.persistence.CustomerDao;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

/**
 * Customer-side authentication for the /account portal.
 *
 * <p>Session issuing only. Authentication is the magic-link token verified in
 * MagicLinkService; this class turns a verified customer into a signed cookie
 * payload and reads that payload back.
 */
public class CustomerAuthService {

    private final CustomerDao customerDao;
    private final JwtService jwtService;
    private final Clock clock;

    public CustomerAuthService(CustomerDao customerDao, JwtService jwtService, Clock clock) {
        this.customerDao = customerDao;
        this.jwtService = jwtService;
        this.clock = clock;
    }

    /**
     * Issues a customer session for an already-authenticated customer and
     * stamps last_login_at.
     *
     * <p>This no longer authenticates anything itself. Proof of identity is the
     * single-use magic-link token, verified by
     * {@link com.bliss.b2b.service.MagicLinkService#verifyCustomer}; this
     * method only mints the cookie payload once that has succeeded.
     *
     * <p>What it replaced was a demo gate that looked the email up and accepted
     * any password without checking it. There is still no password column, no
     * bcrypt and no sessions table; the difference is that possession of a
     * mailbox is now actually required, rather than possession of an address
     * someone could guess.
     */
    public String issueSession(Customer customer) {
        customerDao.touchLastLogin(customer.id(), Instant.now(clock));
        return jwtService.issueCustomer(customer.email());
    }

    /**
     * Verify a session token from the {@code bliss_customer_session} cookie.
     * Returns the customer's email on success, empty on any verification
     * failure or role mismatch.
     */
    public Optional<String> verifySession(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        try {
            Claims claims = jwtService.verify(token);
            Object role = claims.get("role");
            if (!"customer".equals(role)) return Optional.empty();
            String email = claims.getSubject();
            if (email == null || email.isBlank()) return Optional.empty();
            return Optional.of(email);
        } catch (JwtException e) {
            return Optional.empty();
        }
    }

}
