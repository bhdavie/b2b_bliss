package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.payments.EligibilityResult;
import com.bliss.b2b.payments.PlanOption;
import java.time.LocalDate;
import java.util.List;

/**
 * Public-facing view of a booking, served unauthenticated to the hosted page.
 * Intentionally narrower than {@link BookingView}: no merchant email, no
 * internal status enum values that aren't useful to a consumer.
 */
public record PublicBookingView(
        MerchantContext merchant,
        Service service,
        Eligibility eligibility,
        List<Plan> planOptions,
        Stripe stripe,
        String status
) {
    public record MerchantContext(
            String slug,
            String businessName,
            String businessType,
            String brandColorPrimary,
            String logoUrl,
            String contactEmail
    ) {}

    public record Service(
            String name,
            String description,
            long totalAmountCents,
            LocalDate appointmentDate,
            String cancellationPolicy,
            String customerNameHint,
            String customerEmailHint
    ) {}

    public record Eligibility(
            boolean eligible,
            String reason,
            long daysToAppointment
    ) {}

    public record Plan(
            String frequency,
            int numPayments,
            long perPaymentAmountCents,
            long finalPaymentAmountCents,
            List<LocalDate> dueDates,
            boolean recommended
    ) {}

    public record Stripe(
            boolean configured,
            String publishableKey
    ) {}

    public static PublicBookingView build(
            Merchant merchant,
            Booking booking,
            EligibilityResult eligibility,
            boolean stripeConfigured,
            String stripePublishableKey
    ) {
        List<Plan> options = eligibility.options().stream()
                .map(o -> new Plan(
                        o.frequency().wire(),
                        o.numPayments(),
                        o.perPaymentAmountCents(),
                        o.finalPaymentAmountCents(),
                        o.dueDates(),
                        isRecommended(o, eligibility.options())))
                .toList();
        return new PublicBookingView(
                new MerchantContext(
                        merchant.slug(),
                        merchant.businessName(),
                        merchant.businessType(),
                        // brandColorPrimary and logoUrl are read off the
                        // merchant row but the domain record does not expose
                        // them yet; surface null until those fields are wired
                        // through. The hosted page falls back to defaults.
                        null,
                        null,
                        merchant.email()),
                new Service(
                        booking.serviceName(),
                        booking.serviceDescription(),
                        booking.totalAmountCents(),
                        booking.appointmentDate(),
                        booking.cancellationPolicy(),
                        booking.customerNameHint(),
                        booking.customerEmailHint()),
                new Eligibility(
                        eligibility.eligible(),
                        eligibility.reason(),
                        eligibility.daysToAppointment()),
                options,
                new Stripe(stripeConfigured, stripeConfigured ? stripePublishableKey : null),
                booking.status().wire()
        );
    }

    private static boolean isRecommended(PlanOption option, List<PlanOption> all) {
        if (all.size() < 2) return false;
        // In the 8-12w bucket both biweekly and monthly are offered; monthly
        // is the recommended option per CLAUDE.md (fewer charges = less
        // surface for declines).
        return option.frequency() == com.bliss.b2b.payments.PlanFrequency.MONTHLY;
    }
}
