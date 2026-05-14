package com.bliss.b2b.auth;

import io.dropwizard.auth.AuthFilter;
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.Cookie;
import java.io.IOException;

@Priority(Priorities.AUTHENTICATION)
public class JwtCookieAuthFilter extends AuthFilter<String, MerchantPrincipal> {

    private static final String BEARER_PREFIX = "Bearer ";

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String token = extractToken(requestContext);
        if (token == null) {
            throw new WebApplicationException(unauthorizedHandler.buildResponse(prefix, realm));
        }
        if (!authenticate(requestContext, token, "MAGIC_LINK")) {
            throw new WebApplicationException(unauthorizedHandler.buildResponse(prefix, realm));
        }
    }

    private static String extractToken(ContainerRequestContext requestContext) {
        Cookie cookie = requestContext.getCookies().get(SessionCookies.COOKIE_NAME);
        if (cookie != null && cookie.getValue() != null && !cookie.getValue().isBlank()) {
            return cookie.getValue();
        }
        String header = requestContext.getHeaderString("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            return header.substring(BEARER_PREFIX.length());
        }
        return null;
    }

    public static class Builder extends AuthFilterBuilder<String, MerchantPrincipal, JwtCookieAuthFilter> {
        @Override
        protected JwtCookieAuthFilter newInstance() {
            return new JwtCookieAuthFilter();
        }
    }
}
