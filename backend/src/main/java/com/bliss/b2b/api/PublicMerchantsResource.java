package com.bliss.b2b.api;

import com.bliss.b2b.domain.ConnectStatus;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.service.MerchantPlanRulesService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
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
    private final StripeConnectResolver stripeConnectResolver;

    public PublicMerchantsResource(
            MerchantDao merchantDao,
            MerchantPlanRulesService rulesService,
            StripePaymentsService stripeService,
            StripeConnectResolver stripeConnectResolver
    ) {
        this.merchantDao = merchantDao;
        this.rulesService = rulesService;
        this.stripeService = stripeService;
        this.stripeConnectResolver = stripeConnectResolver;
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
                        rules.discountBasisPoints(),
                        rules.blackoutDates().stream().map(java.time.LocalDate::toString).toList()),
                new PublicMerchantView.Stripe(
                        stripeService.isConfigured(),
                        stripeService.isConfigured() ? stripeService.publishableKey() : null,
                        chargesEnabled,
                        stripeService.isConfigured()
                                ? stripeConnectResolver.resolveOrNull(merchant.id()) : null),
                merchant.pmsType() == com.bliss.b2b.domain.PmsType.MEWS
                        ? "mews"
                        : (stripeService.isConfigured() ? "stripe" : "demo")
        )).build();
    }

    /**
     * Plan rules for a merchant, readable from ANY origin.
     *
     * <p>Exists for the Mews overlay, which runs inside a hotel's own booking
     * engine on app.mews.com or the property's domain — a third-party origin
     * that the global CORS filter
     * ({@code BlissApplication#registerCors}, driven by BLISS_CORS_ORIGINS)
     * does not and should not allow. Rather than widening that allow-list, this
     * one endpoint sets its own {@code Access-Control-Allow-Origin: *}.
     *
     * <p>The scoping is per-response, not per-filter: the global filter is
     * untouched and every other route keeps the configured allow-list.
     * {@code setHeader} (not {@code addHeader}) is used so that when the caller
     * IS an allowed origin, the filter's specific value is REPLACED rather than
     * appended — two Access-Control-Allow-Origin values would be rejected by
     * every browser.
     *
     * <p>Credentials are explicitly refused. A wildcard origin and
     * {@code Access-Control-Allow-Credentials: true} are incompatible, and the
     * global filter sets that flag true. Overriding it to false here keeps the
     * pairing legal and means a future caller that adds
     * {@code credentials: "include"} fails loudly at the browser instead of
     * quietly sending a session cookie to a hotel's page. Nothing in this
     * payload is session-scoped, so there is nothing to authenticate.
     *
     * <p>A plain {@code fetch(url)} for this is a CORS "simple request": GET,
     * no custom headers, so no preflight is issued and the global filter's
     * OPTIONS handling is never consulted.
     */
    @GET
    @Path("/{slug}/plan-rules")
    public Response planRules(@PathParam("slug") String slug,
                              @Context HttpServletResponse servletResponse) {
        allowAnyOrigin(servletResponse);
        if (slug == null || slug.isBlank()) return notFound();
        Optional<Merchant> maybe = merchantDao.findBySlug(slug);
        if (maybe.isEmpty()) return notFound();
        Merchant merchant = maybe.get();
        MerchantPlanRules rules = rulesService.forMerchant(merchant.id());
        return Response.ok(PublicPlanRulesView.from(rules, merchant.pmsType())).build();
    }

    /**
     * Opens exactly this response to any origin, credential-free. Scoped to the
     * single endpoint that calls it; the servlet-level CORS filter is unchanged.
     */
    private static void allowAnyOrigin(HttpServletResponse response) {
        if (response == null) return;
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Credentials", "false");
    }

    private static Response notFound() {
        return Response.status(404)
                .entity(Map.of("error", "merchant_not_found",
                        "message", "We can't find that merchant. Contact them for a fresh link."))
                .build();
    }
}
