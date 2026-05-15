package com.bliss.b2b.api;

import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.service.MerchantPlanRulesService;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.Optional;

/**
 * Public merchant lookup for the customer-initiated checkout flow
 * ({@code /checkout/{slug}} on the frontend). Returns just the surface
 * needed to render the merchant context block and a customer-facing
 * policy summary; no internal fields, no auth.
 */
@Path("/api/v1/public/merchants")
@Produces(MediaType.APPLICATION_JSON)
public class PublicMerchantsResource {

    private final MerchantDao merchantDao;
    private final MerchantPlanRulesService rulesService;
    private final StripePaymentsService stripeService;

    public PublicMerchantsResource(
            MerchantDao merchantDao,
            MerchantPlanRulesService rulesService,
            StripePaymentsService stripeService
    ) {
        this.merchantDao = merchantDao;
        this.rulesService = rulesService;
        this.stripeService = stripeService;
    }

    @GET
    @Path("/{slug}")
    public Response get(@PathParam("slug") String slug) {
        if (slug == null || slug.isBlank()) return notFound();
        Optional<Merchant> maybe = merchantDao.findBySlug(slug);
        if (maybe.isEmpty()) return notFound();
        Merchant merchant = maybe.get();
        MerchantPlanRules rules = rulesService.forMerchant(merchant.id());
        ConnectStatus connect = ConnectStatus.fromWire(merchant.stripeConnectStatus());
        boolean chargesEnabled = connect == ConnectStatus.CHARGES_ENABLED;

        return Response.ok(new PublicMerchantView(
                new PublicMerchantView.MerchantContext(
                        merchant.slug(),
                        merchant.businessName(),
                        merchant.businessType(),
                        null,
                        null,
                        merchant.email()),
                new PublicMerchantView.Policies(
                        rules.refundPolicy().wire(),
                        rules.refundSlidingThresholdPercent(),
                        rules.cancellationFeeEnabled(),
                        rules.cancellationFeeType() == null ? null : rules.cancellationFeeType().wire(),
                        rules.cancellationFeeValue(),
                        rules.cancellationFeeThresholdPercent(),
                        rules.paymentDuePolicy().wire(),
                        rules.paymentDueCustomMonths(),
                        rules.retryAttempts(),
                        rules.retrySpacingDays(),
                        rules.lateFeeEnabled(),
                        rules.lateFeeType() == null ? null : rules.lateFeeType().wire(),
                        rules.lateFeeValue(),
                        rules.lateFeeScope() == null ? null : rules.lateFeeScope().wire(),
                        rules.afterRetriesAction().wire(),
                        rules.allowedFrequencies().wire(),
                        rules.recommendedFrequency() == null ? null : rules.recommendedFrequency().wire(),
                        rules.minLeadTimeWeeks(),
                        rules.maxLeadTimeWeeks(),
                        rules.minBookingAmountCents(),
                        rules.maxBookingAmountCents(),
                        rules.depositRequired(),
                        rules.depositType() == null ? null : rules.depositType().wire(),
                        rules.depositValue(),
                        rules.depositMaxCents(),
                        rules.discountBasisPoints()),
                new PublicMerchantView.Stripe(
                        stripeService.isConfigured(),
                        stripeService.isConfigured() ? stripeService.publishableKey() : null,
                        chargesEnabled)
        )).build();
    }

    private static Response notFound() {
        return Response.status(404)
                .entity(Map.of("error", "merchant_not_found",
                        "message", "We can't find that merchant. Contact them for a fresh link."))
                .build();
    }
}
