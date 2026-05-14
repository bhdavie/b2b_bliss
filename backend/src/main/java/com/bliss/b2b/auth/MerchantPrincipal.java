package com.bliss.b2b.auth;

import com.bliss.b2b.domain.Merchant;
import java.security.Principal;

public record MerchantPrincipal(Merchant merchant) implements Principal {
    @Override
    public String getName() {
        return merchant.email();
    }
}
