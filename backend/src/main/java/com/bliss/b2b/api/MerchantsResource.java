package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailTemplates;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.payments.Money;
import com.bliss.b2b.persistence.MerchantDao;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.stripe.exception.StripeException;
import com.stripe.model.Account;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Path("/api/v1/merchants")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class MerchantsResource {

    private static final Logger log = LoggerFactory.getLogger(MerchantsResource.class);

    private final MerchantDao merchantDao;
    private final StripeConnectService stripe;
    private final EmailService emailService;

    public MerchantsResource(MerchantDao merchantDao, StripeConnectService stripe, EmailService emailService) {
        this.merchantDao = merchantDao;
        this.stripe = stripe;
        this.emailService = emailService;
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

    /**
     * Sets the property's currency, time zone and locale by hand. Only for a
     * property with nothing to read them from: no PMS chosen, or a Stripe
     * property while Stripe is not configured (the demo). A Mews, Cloudbeds or
     * live Stripe property takes them from that system, so a hand-set value
     * would only drift from what is actually charged.
     */
    @PUT
    @Path("/me/property-locale")
    public Response setPropertyLocale(@Auth MerchantPrincipal principal, PropertyLocaleRequest req) {
        Merchant merchant = principal.merchant();
        boolean sourced = switch (merchant.pmsType()) {
            case MEWS, CLOUDBEDS -> true;
            case STRIPE -> stripe.isLiveFor(merchant);
            case NONE -> false;
        };
        if (sourced) {
            return Response.status(409).entity(Map.of(
                    "error", "property_locale_sourced",
                    "message", "Your currency and time zone come from your connected system.")).build();
        }
        if (req == null) {
            return Response.status(400).entity(Map.of("error", "body required")).build();
        }
        String currency;
        String timeZone = emptyToNull(req.timeZone());
        String locale = emptyToNull(req.locale());
        try {
            currency = Money.code(req.currency());
            if (timeZone == null) {
                throw new IllegalArgumentException("timeZone required");
            }
            java.time.ZoneId.of(timeZone);
            if (locale != null && java.util.Locale.forLanguageTag(locale).getLanguage().isEmpty()) {
                throw new IllegalArgumentException("unknown locale '" + locale + "'");
            }
        } catch (IllegalArgumentException | java.time.DateTimeException e) {
            return Response.status(400).entity(Map.of(
                    "error", "invalid_property_locale", "message", e.getMessage())).build();
        }
        merchantDao.updatePropertyLocale(merchant.id(), currency, timeZone, locale);
        Merchant updated = merchantDao.findById(merchant.id()).orElseThrow();
        return Response.ok(MerchantView.from(updated)).build();
    }

    @GET
    @Path("/me/stripe-status")
    public StripeStatusView stripeStatus(@Auth MerchantPrincipal principal) {
        Merchant merchant = principal.merchant();
        String stripeAccountId = merchant.stripeConnectAccountId();
        if (stripeAccountId == null || stripeAccountId.isBlank()) {
            return new StripeStatusView(
                    ConnectStatus.NOT_STARTED.wire(), null, false, false, false, null,
                    stripe.isLiveFor(merchant));
        }
        if (!stripe.isLiveFor(merchant)) {
            ConnectStatus cached = ConnectStatus.fromWire(merchant.stripeConnectStatus());
            return new StripeStatusView(
                    cached.wire(), stripeAccountId, false, false, false, null, false);
        }
        try {
            Account account = stripe.fetchAccount(stripeAccountId);
            com.bliss.b2b.service.PropertyOnboardingService.recordStripeAccountLocale(
                    merchantDao, merchant.id(), account);
            ConnectStatus newStatus = StripeConnectService.fromAccount(account);
            ConnectStatus oldStatus = ConnectStatus.fromWire(merchant.stripeConnectStatus());
            if (newStatus != oldStatus) {
                merchantDao.updateStripeConnectStatus(merchant.id(), newStatus.wire());
                if (oldStatus != ConnectStatus.CHARGES_ENABLED
                        && newStatus == ConnectStatus.CHARGES_ENABLED) {
                    try {
                        emailService.send(EmailTemplates.stripeOnboardingComplete(merchant));
                    } catch (Exception e) {
                        log.warn("Failed to send Stripe onboarding email: {}", e.getMessage());
                    }
                }
            }
            String disabledReason = account.getRequirements() != null
                    ? account.getRequirements().getDisabledReason() : null;
            return new StripeStatusView(
                    newStatus.wire(),
                    stripeAccountId,
                    Boolean.TRUE.equals(account.getChargesEnabled()),
                    Boolean.TRUE.equals(account.getPayoutsEnabled()),
                    Boolean.TRUE.equals(account.getDetailsSubmitted()),
                    disabledReason,
                    true);
        } catch (StripeException e) {
            log.warn("Stripe Account.retrieve failed for {}: {}", stripeAccountId, e.getMessage());
            ConnectStatus cached = ConnectStatus.fromWire(merchant.stripeConnectStatus());
            return new StripeStatusView(cached.wire(), stripeAccountId, false, false, false, null, true);
        }
    }

    private static String emptyToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    public record PropertyLocaleRequest(
            @JsonProperty("currency") String currency,
            @JsonProperty("timeZone") String timeZone,
            @JsonProperty("locale") String locale
    ) {}

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
