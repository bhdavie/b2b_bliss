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
 * <p>The entire body of {@link #attemptLogin} is the demo gate. When
 * production auth lands the body is rewritten in one place — callers and
 * the surrounding {@link LoginResult} shape stay the same.
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
     * Validate an email/password pair and, on success, return a signed
     * customer session token.
     *
     * <p>====================================================================
     * <p>DEMO-MODE AUTH. This method only validates that the email exists
     * on the customers table; password is accepted but never checked.
     * There is no bcrypt, no sessions table, no rate limiting, and no
     * lockout. The signed cookie's TTL is the only protection on the
     * account.
     *
     * <p>TODO(prod): replace this entire method body with a flow that
     * <ol>
     *   <li>looks up customer + password_hash on customers (column does not
     *       exist yet — needs a Flyway migration),
     *   <li>verifies via bcrypt,
     *   <li>writes a row to a sessions table keyed by a refresh token,
     *   <li>rate-limits by IP + email.
     * </ol>
     * The method signature and {@link LoginResult} stay the same so the
     * caller in {@code PublicAccountResource} does not change.
     * <p>====================================================================
     */
    public LoginResult attemptLogin(String email, String password) {
        if (email == null || email.isBlank()) {
            return LoginResult.notFound();
        }
        String normalized = email.trim().toLowerCase();
        Optional<Customer> maybe = customerDao.findByEmail(normalized);
        if (maybe.isEmpty()) {
            return LoginResult.notFound();
        }
        Customer customer = maybe.get();
        customerDao.touchLastLogin(customer.id(), Instant.now(clock));
        String token = jwtService.issueCustomer(customer.email());
        return LoginResult.ok(customer.email(), token);
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

    public sealed interface LoginResult {
        boolean ok();

        static LoginResult ok(String email, String token) {
            return new Ok(email, token);
        }

        static LoginResult notFound() {
            return new NotFound();
        }

        record Ok(String email, String token) implements LoginResult {
            @Override public boolean ok() { return true; }
        }

        record NotFound() implements LoginResult {
            @Override public boolean ok() { return false; }
        }
    }
}
