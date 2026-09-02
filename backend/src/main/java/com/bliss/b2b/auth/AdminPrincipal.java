package com.bliss.b2b.auth;

import com.bliss.b2b.domain.AdminUser;
import java.security.Principal;

public record AdminPrincipal(AdminUser admin) implements Principal {
    @Override
    public String getName() {
        return admin.email();
    }
}
