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
 * ACTIVE                       -> CANCELED                    (customer or merchant cancel; CancellationService runs)
 *
 * PAYMENT_FAILED_IN_RETRY      -> ACTIVE                      (retry succeeded)
 * PAYMENT_FAILED_IN_RETRY      -> PAYMENT_FAILED_EXHAUSTED    (last retry failed)
 * PAYMENT_FAILED_IN_RETRY      -> CANCELED                    (merchant cancel; CancellationService runs)
 *
 * PAYMENT_FAILED_EXHAUSTED     -> CANCELED                    (after-retries = treat_as_cancellation; CancellationService runs)
 * PAYMENT_FAILED_EXHAUSTED     -> BALANCE_DUE                 (after-retries = balance_due_at_checkin)
 *
 * BALANCE_DUE                  -> COMPLETED                   (merchant collected at appointment)
 * BALANCE_DUE                  -> CANCELED                    (merchant cancel; CancellationService runs)
 *
 * DEFAULTED                    -> ACTIVE                      (merchant manual resolve, retry succeeded)
 * DEFAULTED                    -> CANCELED                    (merchant manual close-out via CancellationService)
 *
 * COMPLETED, CANCELED          -> (terminal)
 * </pre>
 *
 * <p>The {@code DEFAULTED} state is reachable only via the merchant's
 * manual override (the admin escape hatch on the plan detail page) —
 * no automated path lands there in Phase 12 onward.
 */
public final class PaymentPlanStateMachine {

    private PaymentPlanStateMachine() {}

    /**
     * Maps a merchant's {@link AfterRetriesAction} configuration to the
     * terminal status the plan should move to when retries are exhausted.
     * {@code TREAT_AS_CANCELLATION} resolves to {@code CANCELED}; the
     * actual cancellation work (refund assessment, fee, audit) is the
     * {@link CancellationService}'s job — this method only names the
     * target state.
     */
    public static PaymentPlanStatus resolveTerminalState(AfterRetriesAction action) {
        return switch (action) {
            case TREAT_AS_CANCELLATION -> PaymentPlanStatus.CANCELED;
            case BALANCE_DUE_AT_CHECKIN -> PaymentPlanStatus.BALANCE_DUE;
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
                    PaymentPlanStatus.BALANCE_DUE);
            case BALANCE_DUE -> EnumSet.of(
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
