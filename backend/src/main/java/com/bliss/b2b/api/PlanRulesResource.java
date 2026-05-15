package com.bliss.b2b.api;

import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.payments.AfterRetriesAction;
import com.bliss.b2b.payments.AllowedFrequencies;
import com.bliss.b2b.payments.DepositType;
import com.bliss.b2b.payments.FeeType;
import com.bliss.b2b.payments.LateFeeScope;
import com.bliss.b2b.payments.MerchantPlanRules;
import com.bliss.b2b.payments.PaymentDuePolicy;
import com.bliss.b2b.payments.PlanFrequency;
import com.bliss.b2b.payments.RefundPolicy;
import com.bliss.b2b.service.MerchantPlanRulesService;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.dropwizard.auth.Auth;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

@Path("/api/v1/merchants/me/plan-rules")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PlanRulesResource {

    private static final int MAX_WEEKS = 520;
    private static final long MAX_AMOUNT_CENTS = 1_000_000_000L;
    private static final long MIN_PERCENT = 1L;
    private static final long MAX_PERCENT = 99L;
    private static final int MAX_CUSTOM_MONTHS = 24;
    private static final int MAX_DISCOUNT_BASIS_POINTS = 5_000;

    private final MerchantPlanRulesService service;

    public PlanRulesResource(MerchantPlanRulesService service) {
        this.service = service;
    }

    @GET
    public PlanRulesView get(@Auth MerchantPrincipal principal) {
        return PlanRulesView.from(service.forMerchant(principal.merchant().id()));
    }

    @PUT
    public Response upsert(@Auth MerchantPrincipal principal, PlanRulesRequest req) {
        if (req == null) {
            return badRequest("body required");
        }
        if (req.minLeadTimeWeeks() == null) {
            return badRequest("minLeadTimeWeeks required");
        }
        int minLead = req.minLeadTimeWeeks();
        if (minLead < 0 || minLead > MAX_WEEKS) {
            return badRequest("minLeadTimeWeeks must be 0-" + MAX_WEEKS);
        }
        Integer maxLead = req.maxLeadTimeWeeks();
        if (maxLead != null && (maxLead < 1 || maxLead > MAX_WEEKS)) {
            return badRequest("maxLeadTimeWeeks must be 1-" + MAX_WEEKS);
        }
        if (maxLead != null && maxLead < minLead) {
            return badRequest("maxLeadTimeWeeks must be >= minLeadTimeWeeks");
        }
        AllowedFrequencies allowed;
        try {
            allowed = AllowedFrequencies.fromWire(req.allowedFrequencies());
        } catch (IllegalArgumentException e) {
            return badRequest("allowedFrequencies must be one of monthly, biweekly, both");
        }
        Long minAmt = req.minBookingAmountCents();
        if (minAmt != null && (minAmt <= 0 || minAmt > MAX_AMOUNT_CENTS)) {
            return badRequest("minBookingAmountCents must be positive");
        }
        Long maxAmt = req.maxBookingAmountCents();
        if (maxAmt != null && (maxAmt <= 0 || maxAmt > MAX_AMOUNT_CENTS)) {
            return badRequest("maxBookingAmountCents must be positive");
        }
        if (minAmt != null && maxAmt != null && maxAmt < minAmt) {
            return badRequest("maxBookingAmountCents must be >= minBookingAmountCents");
        }
        PlanFrequency recommended = null;
        if (req.recommendedFrequency() != null && !req.recommendedFrequency().isBlank()) {
            try {
                recommended = PlanFrequency.fromWire(req.recommendedFrequency());
            } catch (IllegalArgumentException e) {
                return badRequest("recommendedFrequency must be one of monthly, biweekly");
            }
            if (!allowed.includes(recommended)) {
                return badRequest("recommendedFrequency must be permitted by allowedFrequencies");
            }
        }

        boolean depositRequired = Boolean.TRUE.equals(req.depositRequired());
        DepositType depositType = null;
        Long depositValue = null;
        Long depositMaxCents = req.depositMaxCents();
        if (depositRequired) {
            if (req.depositType() == null || req.depositType().isBlank()) {
                return badRequest("depositType required when depositRequired is true");
            }
            try {
                depositType = DepositType.fromWire(req.depositType());
            } catch (IllegalArgumentException e) {
                return badRequest("depositType must be one of percentage, fixed");
            }
            if (req.depositValue() == null) {
                return badRequest("depositValue required when depositRequired is true");
            }
            depositValue = req.depositValue();
            switch (depositType) {
                case PERCENTAGE -> {
                    if (depositValue < MIN_PERCENT || depositValue > MAX_PERCENT) {
                        return badRequest("depositValue must be " + MIN_PERCENT + "-" + MAX_PERCENT
                                + " when depositType is percentage");
                    }
                }
                case FIXED -> {
                    if (depositValue <= 0 || depositValue > MAX_AMOUNT_CENTS) {
                        return badRequest("depositValue must be positive when depositType is fixed");
                    }
                }
            }
            if (depositMaxCents != null && (depositMaxCents <= 0 || depositMaxCents > MAX_AMOUNT_CENTS)) {
                return badRequest("depositMaxCents must be positive");
            }
        } else {
            depositType = null;
            depositValue = null;
            depositMaxCents = null;
        }

        // --- Refund policy ---
        RefundPolicy refundPolicy;
        try {
            refundPolicy = req.refundPolicy() == null
                    ? RefundPolicy.FULL
                    : RefundPolicy.fromWire(req.refundPolicy());
        } catch (IllegalArgumentException e) {
            return badRequest("refundPolicy must be one of full, none, first_installment_only, sliding_scale, credit_only");
        }
        Integer slidingThreshold = req.refundSlidingThresholdPercent();
        if (refundPolicy == RefundPolicy.SLIDING_SCALE) {
            if (slidingThreshold == null || slidingThreshold < 1 || slidingThreshold > 99) {
                return badRequest("refundSlidingThresholdPercent must be 1-99 when refundPolicy is sliding_scale");
            }
        } else {
            slidingThreshold = null;
        }

        // --- Cancellation fee ---
        boolean cancellationFeeEnabled = Boolean.TRUE.equals(req.cancellationFeeEnabled());
        FeeType cancellationFeeType = null;
        Long cancellationFeeValue = null;
        Integer cancellationFeeThreshold = req.cancellationFeeThresholdPercent();
        if (cancellationFeeEnabled) {
            if (req.cancellationFeeType() == null || req.cancellationFeeType().isBlank()) {
                return badRequest("cancellationFeeType required when cancellationFeeEnabled is true");
            }
            try {
                cancellationFeeType = FeeType.fromWire(req.cancellationFeeType());
            } catch (IllegalArgumentException e) {
                return badRequest("cancellationFeeType must be one of fixed, percentage");
            }
            if (req.cancellationFeeValue() == null) {
                return badRequest("cancellationFeeValue required when cancellationFeeEnabled is true");
            }
            cancellationFeeValue = req.cancellationFeeValue();
            if (!validFeeValue(cancellationFeeType, cancellationFeeValue)) {
                return badRequest("cancellationFeeValue must be positive (1-100 if percentage)");
            }
            if (cancellationFeeThreshold != null
                    && (cancellationFeeThreshold < 0 || cancellationFeeThreshold > 100)) {
                return badRequest("cancellationFeeThresholdPercent must be 0-100");
            }
        } else {
            cancellationFeeType = null;
            cancellationFeeValue = null;
            cancellationFeeThreshold = null;
        }

        // --- Payment due policy ---
        PaymentDuePolicy paymentDuePolicy;
        try {
            paymentDuePolicy = req.paymentDuePolicy() == null
                    ? PaymentDuePolicy.AT_APPOINTMENT
                    : PaymentDuePolicy.fromWire(req.paymentDuePolicy());
        } catch (IllegalArgumentException e) {
            return badRequest("paymentDuePolicy must be one of at_appointment, one_week_before, one_month_before, custom_months");
        }
        Integer customMonths = req.paymentDueCustomMonths();
        if (paymentDuePolicy == PaymentDuePolicy.CUSTOM_MONTHS) {
            if (customMonths == null || customMonths < 1 || customMonths > MAX_CUSTOM_MONTHS) {
                return badRequest("paymentDueCustomMonths must be 1-" + MAX_CUSTOM_MONTHS + " when paymentDuePolicy is custom_months");
            }
        } else {
            customMonths = null;
        }

        // --- Retry policy ---
        int retryAttempts = req.retryAttempts() == null ? 3 : req.retryAttempts();
        if (retryAttempts < 1 || retryAttempts > 5) {
            return badRequest("retryAttempts must be 1-5");
        }
        int retrySpacingDays = req.retrySpacingDays() == null ? 3 : req.retrySpacingDays();
        if (retrySpacingDays != 1 && retrySpacingDays != 3 && retrySpacingDays != 7) {
            return badRequest("retrySpacingDays must be one of 1, 3, 7");
        }

        // --- Late fee ---
        boolean lateFeeEnabled = Boolean.TRUE.equals(req.lateFeeEnabled());
        FeeType lateFeeType = null;
        Long lateFeeValue = null;
        LateFeeScope lateFeeScope = null;
        if (lateFeeEnabled) {
            if (req.lateFeeType() == null || req.lateFeeType().isBlank()) {
                return badRequest("lateFeeType required when lateFeeEnabled is true");
            }
            try {
                lateFeeType = FeeType.fromWire(req.lateFeeType());
            } catch (IllegalArgumentException e) {
                return badRequest("lateFeeType must be one of fixed, percentage");
            }
            if (req.lateFeeValue() == null) {
                return badRequest("lateFeeValue required when lateFeeEnabled is true");
            }
            lateFeeValue = req.lateFeeValue();
            if (!validFeeValue(lateFeeType, lateFeeValue)) {
                return badRequest("lateFeeValue must be positive (1-100 if percentage)");
            }
            if (req.lateFeeScope() == null || req.lateFeeScope().isBlank()) {
                return badRequest("lateFeeScope required when lateFeeEnabled is true");
            }
            try {
                lateFeeScope = LateFeeScope.fromWire(req.lateFeeScope());
            } catch (IllegalArgumentException e) {
                return badRequest("lateFeeScope must be one of per_failure, once_per_plan");
            }
        }

        // --- After-retries action ---
        AfterRetriesAction afterRetries;
        try {
            afterRetries = req.afterRetriesAction() == null
                    ? AfterRetriesAction.TREAT_AS_CANCELLATION
                    : AfterRetriesAction.fromWire(req.afterRetriesAction());
        } catch (IllegalArgumentException e) {
            return badRequest("afterRetriesAction must be one of treat_as_cancellation, balance_due_at_checkin");
        }

        // --- Plan discount ---
        int discountBasisPoints = req.discountBasisPoints() == null ? 0 : req.discountBasisPoints();
        if (discountBasisPoints < 0 || discountBasisPoints > MAX_DISCOUNT_BASIS_POINTS) {
            return badRequest("discountBasisPoints must be 0-" + MAX_DISCOUNT_BASIS_POINTS);
        }

        MerchantPlanRules rules = new MerchantPlanRules(
                minLead, maxLead, allowed, minAmt, maxAmt, recommended,
                depositRequired, depositType, depositValue, depositMaxCents,
                refundPolicy, slidingThreshold,
                cancellationFeeEnabled, cancellationFeeType, cancellationFeeValue, cancellationFeeThreshold,
                paymentDuePolicy, customMonths,
                retryAttempts, retrySpacingDays,
                lateFeeEnabled, lateFeeType, lateFeeValue, lateFeeScope,
                afterRetries,
                discountBasisPoints);
        service.save(principal.merchant().id(), rules);
        return Response.ok(PlanRulesView.from(rules)).build();
    }

    private static boolean validFeeValue(FeeType type, long value) {
        return switch (type) {
            case PERCENTAGE -> value >= 1 && value <= 100;
            case FIXED -> value > 0 && value <= MAX_AMOUNT_CENTS;
        };
    }

    private static Response badRequest(String message) {
        return Response.status(400).entity(Map.of("error", message)).build();
    }

    public record PlanRulesRequest(
            @JsonProperty("minLeadTimeWeeks") Integer minLeadTimeWeeks,
            @JsonProperty("maxLeadTimeWeeks") Integer maxLeadTimeWeeks,
            @JsonProperty("allowedFrequencies") String allowedFrequencies,
            @JsonProperty("minBookingAmountCents") Long minBookingAmountCents,
            @JsonProperty("maxBookingAmountCents") Long maxBookingAmountCents,
            @JsonProperty("recommendedFrequency") String recommendedFrequency,
            @JsonProperty("depositRequired") Boolean depositRequired,
            @JsonProperty("depositType") String depositType,
            @JsonProperty("depositValue") Long depositValue,
            @JsonProperty("depositMaxCents") Long depositMaxCents,
            @JsonProperty("refundPolicy") String refundPolicy,
            @JsonProperty("refundSlidingThresholdPercent") Integer refundSlidingThresholdPercent,
            @JsonProperty("cancellationFeeEnabled") Boolean cancellationFeeEnabled,
            @JsonProperty("cancellationFeeType") String cancellationFeeType,
            @JsonProperty("cancellationFeeValue") Long cancellationFeeValue,
            @JsonProperty("cancellationFeeThresholdPercent") Integer cancellationFeeThresholdPercent,
            @JsonProperty("paymentDuePolicy") String paymentDuePolicy,
            @JsonProperty("paymentDueCustomMonths") Integer paymentDueCustomMonths,
            @JsonProperty("retryAttempts") Integer retryAttempts,
            @JsonProperty("retrySpacingDays") Integer retrySpacingDays,
            @JsonProperty("lateFeeEnabled") Boolean lateFeeEnabled,
            @JsonProperty("lateFeeType") String lateFeeType,
            @JsonProperty("lateFeeValue") Long lateFeeValue,
            @JsonProperty("lateFeeScope") String lateFeeScope,
            @JsonProperty("afterRetriesAction") String afterRetriesAction,
            @JsonProperty("discountBasisPoints") Integer discountBasisPoints
    ) {}
}
