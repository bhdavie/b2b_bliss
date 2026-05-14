package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.time.Instant;
import java.util.Map;

@Path("/api/v1/hello")
@Produces(MediaType.APPLICATION_JSON)
public class HelloResource {

    @GET
    public Map<String, Object> hello() {
        return Map.of(
                "status", "ok",
                "service", "bliss-b2b-backend",
                "time", Instant.now().toString()
        );
    }

    @GET
    @Path("/me")
    public Map<String, Object> me(@Auth MerchantPrincipal principal) {
        return Map.of(
                "email", principal.merchant().email(),
                "merchantId", principal.merchant().id().toString()
        );
    }
}
