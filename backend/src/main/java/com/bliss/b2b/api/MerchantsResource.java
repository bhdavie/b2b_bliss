package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.persistence.MerchantDao;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

@Path("/api/v1/merchants")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class MerchantsResource {

    private final MerchantDao merchantDao;

    public MerchantsResource(MerchantDao merchantDao) {
        this.merchantDao = merchantDao;
    }

    @GET
    @Path("/me")
    public MerchantView me(@Auth MerchantPrincipal principal) {
        return MerchantView.from(principal.merchant());
    }

    @PATCH
    @Path("/me")
    public Response updateMe(@Auth MerchantPrincipal principal, UpdateMerchantRequest req) {
        if (req == null) {
            return Response.status(400).entity(Map.of("error", "body required")).build();
        }
        if (req.businessName() == null || req.businessName().isBlank()) {
            return Response.status(400).entity(Map.of("error", "businessName required")).build();
        }
        if (req.businessType() == null || req.businessType().isBlank()) {
            return Response.status(400).entity(Map.of("error", "businessType required")).build();
        }
        merchantDao.updateProfile(
                principal.merchant().id(),
                req.businessName().trim(),
                req.businessType().trim(),
                emptyToNull(req.phone()),
                emptyToNull(req.addressLine1()),
                emptyToNull(req.addressLine2()),
                emptyToNull(req.addressCity()),
                emptyToNull(req.addressState()),
                emptyToNull(req.addressZip())
        );
        Merchant updated = merchantDao.findById(principal.merchant().id()).orElseThrow();
        return Response.ok(MerchantView.from(updated)).build();
    }

    private static String emptyToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    public record UpdateMerchantRequest(
            @JsonProperty("businessName") String businessName,
            @JsonProperty("businessType") String businessType,
            @JsonProperty("phone") String phone,
            @JsonProperty("addressLine1") String addressLine1,
            @JsonProperty("addressLine2") String addressLine2,
            @JsonProperty("addressCity") String addressCity,
            @JsonProperty("addressState") String addressState,
            @JsonProperty("addressZip") String addressZip
    ) {}
}
