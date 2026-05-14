package com.bliss.b2b.service;

import com.bliss.b2b.domain.PaymentPlanStatus;
import com.bliss.b2b.payments.AfterRetriesAction;
import java.util.EnumSet;
import java.util.Set;

/**
 * Allowed transitions for a {@link PaymentPlanStatus}. Each transition is
 * triggered by a specific event in the system; the table below is the
 * authoritative reference.
 *
 * <pre>
 * ACTIVE                       -> PAYMENT_FAILED_IN_RETRY     (installment failed, retries remain)
 * ACTIVE                       -> COMPLETED                   (final installment cleared)
 * ACTIVE                       -> CANCELED                    (customer or merchant cancel)
 *
 * PAYMENT_FAILED_IN_RETRY      -> ACTIVE                      (retry succeeded)
 * PAYMENT_FAILED_IN_RETRY      -> PAYMENT_FAILED_EXHAUSTED    (last retry failed)
 * PAYMENT_FAILED_IN_RETRY      -> CANCELED                    (merchant cancel)
 *
 * PAYMENT_FAILED_EXHAUSTED     -> CANCELED                    (after-retries = cancel_forfeit | cancel_refund)
 * PAYMENT_FAILED_EXHAUSTED     -> DEFAULTED                   (after-retries = mark_defaulted, the default)
 * PAYMENT_FAILED_EXHAUSTED     -> COMPLETED                   (after-retries = convert_to_credit; remaining converted)
 * PAYMENT_FAILED_EXHAUSTED     -> BALANCE_DUE_AT_ARRIVAL      (after-retries = balance_due_at_arrival)
 *
 * BALANCE_DUE_AT_ARRIVAL       -> COMPLETED                   (merchant collected at appointment)
 * BALANCE_DUE_AT_ARRIVAL       -> CANCELED                    (merchant cancel)
 *
 * DEFAULTED                    -> ACTIVE                      (merchant manual resolve, retry succeeded)
 * DEFAULTED                    -> CANCELED                    (merchant manual close-out)
 *
 * COMPLETED, CANCELED          -> (terminal)
 * </pre>
 *
 * <p>The merchant dashboard exposes a manual override for any open plan, so
 * an admin can force a transition that isn't in this table (e.g., from
 * {@code DEFAULTED} back to {@code ACTIVE} via the plan detail page). The
 * automated paths above are what the system performs without admin input.
 */
public final class PaymentPlanStateMachine {

    private PaymentPlanStateMachine() {}

    /**
     * Maps a merchant's {@link AfterRetriesAction} configuration to the
     * terminal status the plan should move to when retries are exhausted.
     */
    public static PaymentPlanStatus resolveTerminalState(AfterRetriesAction action) {
        return switch (action) {
            case CANCEL_FORFEIT, CANCEL_REFUND -> PaymentPlanStatus.CANCELED;
            case MARK_DEFAULTED -> PaymentPlanStatus.DEFAULTED;
            case CONVERT_TO_CREDIT -> PaymentPlanStatus.COMPLETED;
            case BALANCE_DUE_AT_ARRIVAL -> PaymentPlanStatus.BALANCE_DUE_AT_ARRIVAL;
        };
    }

    /**
     * Returns true if {@code from -> to} is in the documented transition
     * table. Used by the automated paths; manual overrides bypass this.
     */
    public static boolean isAllowed(PaymentPlanStatus from, PaymentPlanStatus to) {
        if (from == to) return true;
        Set<PaymentPlanStatus> allowed = switch (from) {
            case ACTIVE -> EnumSet.of(
                    PaymentPlanStatus.PAYMENT_FAILED_IN_RETRY,
                    PaymentPlanStatus.COMPLETED,
                    PaymentPlanStatus.CANCELED);
            case PAYMENT_FAILED_IN_RETRY -> EnumSet.of(
                    PaymentPlanStatus.ACTIVE,
                    PaymentPlanStatus.PAYMENT_FAILED_EXHAUSTED,
                    PaymentPlanStatus.CANCELED);
            case PAYMENT_FAILED_EXHAUSTED -> EnumSet.of(
                    PaymentPlanStatus.CANCELED,
                    PaymentPlanStatus.DEFAULTED,
                    PaymentPlanStatus.COMPLETED,
                    PaymentPlanStatus.BALANCE_DUE_AT_ARRIVAL);
            case BALANCE_DUE_AT_ARRIVAL -> EnumSet.of(
                    PaymentPlanStatus.COMPLETED,
                    PaymentPlanStatus.CANCELED);
            case DEFAULTED -> EnumSet.of(
                    PaymentPlanStatus.ACTIVE,
                    PaymentPlanStatus.CANCELED);
            case COMPLETED, CANCELED -> EnumSet.noneOf(PaymentPlanStatus.class);
        };
        return allowed.contains(to);
    }
}
