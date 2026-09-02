package com.bliss.b2b.auth;

import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.persistence.MerchantDao;
import io.dropwizard.auth.AuthenticationException;
import io.dropwizard.auth.Authenticator;
import io.jsonwebtoken.Claims;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MerchantAuthenticator implements Authenticator<String, MerchantPrincipal> {

    private static final Logger log = LoggerFactory.getLogger(MerchantAuthenticator.class);

    private final JwtService jwtService;
    private final MerchantDao merchantDao;

    public MerchantAuthenticator(JwtService jwtService, MerchantDao merchantDao) {
        this.jwtService = jwtService;
        this.merchantDao = merchantDao;
    }

    @Override
    public Optional<MerchantPrincipal> authenticate(String token) throws AuthenticationException {
        try {
            Claims claims = jwtService.verify(token);
            // Reject any token that declares a role other than merchant. Guest
            // and admin tokens were already excluded in practice by carrying no
            // merchantId claim, but that was a negative check: it held only for
            // as long as no other subject happened to carry one. This is the
            // positive one. Tokens with NO role claim still pass, because that
            // is what a merchant token looks like today and live sessions must
            // keep working across the deploy.
            Object role = claims.get("role");
            if (role != null && !"merchant".equals(role)) return Optional.empty();
            String merchantIdStr = claims.get("merchantId", String.class);
            if (merchantIdStr == null) return Optional.empty();
            UUID merchantId = UUID.fromString(merchantIdStr);
            Optional<Merchant> merchant = merchantDao.findById(merchantId);
            return merchant.map(MerchantPrincipal::new);
        } catch (Exception e) {
            log.debug("JWT verification failed: {}", e.getMessage());
            return Optional.empty();
        }
    }
}
