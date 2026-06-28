package com.bliss.b2b.auth;

import com.bliss.b2b.BlissConfiguration.JwtConfig;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;

public class JwtService {

    private final SecretKey signingKey;
    private final String issuer;
    private final Duration ttl;

    public JwtService(JwtConfig config) {
        this(config, Duration.ofMinutes(config.getTtlMinutes()));
    }

    public JwtService(JwtConfig config, Duration ttl) {
        byte[] secretBytes = config.getSecret().getBytes(StandardCharsets.UTF_8);
        if (secretBytes.length < 32) {
            throw new IllegalStateException(
                    "JWT secret must be at least 32 bytes (got " + secretBytes.length + ")");
        }
        this.signingKey = Keys.hmacShaKeyFor(secretBytes);
        this.issuer = config.getIssuer();
        this.ttl = ttl;
    }

    public String issue(String email, String merchantId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer(issuer)
                .subject(email)
                .claim("merchantId", merchantId)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }

    /**
     * Issues a customer-side session token. Distinct from {@link #issue}
     * via the {@code role=customer} claim so the verifier on the customer
     * portal can reject merchant tokens that happened to leak across.
     */
    public String issueCustomer(String email) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer(issuer)
                .subject(email)
                .claim("role", "customer")
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }

    public Claims verify(String token) {
        return Jwts.parser()
                .verifyWith(signingKey)
                .requireIssuer(issuer)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
