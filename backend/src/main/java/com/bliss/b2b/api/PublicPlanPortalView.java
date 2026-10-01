package com.bliss.b2b.api;

import com.bliss.b2b.domain.Booking;
import com.bliss.b2b.domain.CustomerCard;
import com.bliss.b2b.domain.Merchant;
import com.bliss.b2b.domain.PaymentPlan;
import com.bliss.b2b.domain.PaymentScheduleEntry;
import com.bliss.b2b.domain.PmsType;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.service.PlanPortalService.PortalSnapshot;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * Wire shape returned by {@code GET /api/v1/public/plans/{bookingToken}}.
 * All money values are pre-derived server-side so the frontend reads them
 * directly without re-running the discount/fee math. Mirrors the source-of-
 * truth derivations the {@code Confirmation} component uses.
 */
public record PublicPlanPortalView(
        MerchantView merchant,
        BookingView booking,
        PlanView plan,
        List<ScheduleEntryView> schedule,
        CardView card,
        long processingFeeCents,
        long paidCents,
        long remainingCents,
        LocalDate nextDueDate,
        Long nextDueAmountCents,
        boolean complete,
        StripeStateView stripe,
        String rail,
        // The booking's currency (every amount here is minor units of it),
        // and the locale and zone to format amounts and dates in.
        String currency,
        String locale,
        String timeZone,
        // The booking's cancellation terms and what cancelling now would do.
        CancellationView cancellation
) {

    public static PublicPlanPortalView from(
            PortalSnapshot s,
            StripePaymentsService stripeService,
            StripeConnectResolver stripeConnectResolver) {
        // As-of-today derivation (single source of truth, see PlanProgress).
        var progress = s.progress();
        boolean stripeConfigured = stripeService.isConfigured();
        String rail = s.merchant().pmsType() == PmsType.MEWS
                ? "mews"
                : (stripeConfigured ? "stripe" : "demo");
        String connectedAccountId = stripeConfigured
                ? stripeConnectResolver.resolveOrNull(s.merchant().id())
                : null;
        return new PublicPlanPortalView(
                MerchantView.from(s.merchant()),
                BookingView.from(s.booking()),
                PlanView.from(s.plan()),
                s.schedule().stream().map(ScheduleEntryView::from).toList(),
                CardView.from(s.card()),
                s.processingFeeCents(),
                progress.paidCents(),
                progress.remainingCents(),
                progress.nextDueDate(),
                progress.nextDueAmountCents(),
                progress.complete(),
                new StripeStateView(stripeConfigured, stripeService.publishableKey(), connectedAccountId),
                rail,
                s.booking().currency(),
                s.booking().localeTag(),
                s.booking().timeZone(),
                CancellationView.from(s.merchant(), s.booking(), s.cancellation()));
    }

    public record MerchantView(
            String slug,
            String businessName,
            String businessType,
            String brandColorPrimary,
            String logoUrl,
            String contactEmail
    ) {
        static MerchantView from(Merchant m) {
            return new MerchantView(
                    m.slug(),
                    m.guestFacingName(),
                    m.businessType(),
                    null, // brandColorPrimary — not on the domain record yet
                    m.logoUrl(),
                    m.email());
        }
    }

    public record BookingView(
            String serviceName,
            String description,
            LocalDate appointmentDate,
            LocalDate checkoutDate,
            long totalAmountCents,
            Long originalTotalAmountCents,
            String customerNameHint,
            String customerEmailHint
    ) {
        static BookingView from(Booking b) {
            return new BookingView(
                    b.serviceName(),
                    b.serviceDescription(),
                    b.appointmentDate(),
                    b.checkoutDate(),
                    b.totalAmountCents(),
                    b.originalTotalAmountCents(),
                    b.customerNameHint(),
                    b.customerEmailHint());
        }
    }

    public record PlanView(
            String id,
            String frequency,
            int numPayments,
            long totalAmountCents,
            long depositAmountCents,
            String status,
            LocalDate startDate,
            LocalDate endDate,
            Instant refundedAt,
            Long refundAmountCents
    ) {
        static PlanView from(PaymentPlan p) {
            return new PlanView(
                    p.id().toString(),
                    p.frequency().wire(),
                    p.numPayments(),
                    p.totalAmountCents(),
                    p.depositAmountCents(),
                    p.status().wire(),
                    p.startDate(),
                    p.endDate(),
                    p.refundedAt(),
                    p.refundAmountCents());
        }
    }

    public record ScheduleEntryView(
            int sequence,
            LocalDate dueDate,
            long amountCents,
            String status,
            String kind,
            String stripePaymentIntentId,
            Instant paidAt
    ) {
        static ScheduleEntryView from(PaymentScheduleEntry e) {
            return new ScheduleEntryView(
                    e.sequence(),
                    e.dueDate(),
                    e.amountCents(),
                    e.status().wire(),
                    e.kind().wire(),
                    e.stripePaymentIntentId(),
                    e.paidAt());
        }
    }

    public record CardView(
            String brand,
            String lastFour,
            int expMonth,
            int expYear
    ) {
        static CardView from(CustomerCard c) {
            if (c == null) return null;
            return new CardView(c.brand(), c.lastFour(), c.expMonth(), c.expYear());
        }
    }

    public record StripeStateView(
            boolean configured,
            String publishableKey,
            // Connected Standard account for direct charges (null = platform).
            String connectedAccountId) {}

    /**
     * A booking's cancellation terms, and the outcome of cancelling now in a
     * sentence the guest reads before confirming (configurable-property spec,
     * section 10.3). {@code bookingType} and {@code terms} are null for a
     * booking made before booking types were synced.
     */
    public record CancellationView(
            String bookingType,
            Instant freeCancellationUntil,
            String terms,
            String outcome,
            long returnCents,
            boolean asCredit,
            long keptByPropertyCents,
            long keptBlissFeeCents,
            String message) {

        public static CancellationView from(Merchant m, Booking b,
                com.bliss.b2b.service.CancellationService.Assessment a) {
            if (a == null || b.currency() == null) {
                return null;
            }
            com.bliss.b2b.payments.PropertyLocale pl = b.propertyLocale();
            boolean credit = a.creditCents() > 0 || (a.netRefundCents() == 0 && b.mewsReservationId() != null);
            long back = credit ? a.creditCents() : a.netRefundCents();
            String property = m.guestFacingName() == null ? "the property" : m.guestFacingName();

            String terms = null;
            if (b.bookingType() != null) {
                boolean nonRefundable = "non_refundable".equals(b.bookingType());
                terms = nonRefundable ? "Non-refundable"
                        : b.freeCancellationUntil() != null && Instant.now().isBefore(b.freeCancellationUntil())
                        ? "Free cancellation until " + pl.date(b.freeCancellationUntil().atZone(pl.zone()).toLocalDate())
                        : com.bliss.b2b.persistence.BlissRateDao.parseTerms(b.cancellationTermsJson()).describe();
            }

            String message;
            if ("forfeit".equals(a.outcome())) {
                message = "This booking is non-refundable, so the " + pl.format(a.paidCents())
                        + " you've paid isn't refunded.";
            } else if (back <= 0) {
                message = "Nothing you've paid would be refunded.";
            } else {
                message = credit
                        ? "Your " + pl.format(back) + " becomes credit for a future stay at " + property + "."
                        : "You'll get " + pl.format(back) + " back.";
                if ("penalty".equals(a.outcome()) && a.feeCents() > 0) {
                    message += " " + pl.format(a.feeCents()) + " is kept under " + property
                            + "'s cancellation policy"
                            + (a.keptBlissFeeCents() > 0
                                    ? ", including the Bliss fee of " + pl.format(a.keptBlissFeeCents()) + "."
                                    : ".");
                }
            }
            return new CancellationView(b.bookingType(), b.freeCancellationUntil(), terms, a.outcome(), back, credit,
                    a.feeCents(), a.keptBlissFeeCents(), message);
        }
    }
}
