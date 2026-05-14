import {
  formatDollarsCompact,
  type PublicPolicies,
} from "@/lib/publicApi";

/**
 * "Cancellation policy" trust-signal section below the schedule on the
 * hosted plan setup page. Plain-language summaries of the merchant's
 * configured refund, cancellation-fee, payment-deadline, and late-fee
 * rules. Not buried fine print — three short lines a customer can scan.
 */
export function PolicyDisclosure({ policies }: { policies: PublicPolicies }) {
  const refundLine = refundCopy(policies);
  const cancelFeeLine = cancellationFeeCopy(policies);
  const dueLine = dueDateCopy(policies);
  const failureLine = failedPaymentCopy(policies);
  const lateFeeLine = lateFeeCopy(policies);

  return (
    <section className="mt-6 rounded-md border border-surface-border bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.6px] text-ink-muted">
        Cancellation policy
      </div>
      <ul className="mt-3 space-y-2 text-[13px] text-ink">
        <PolicyLine>{refundLine}</PolicyLine>
        {cancelFeeLine ? <PolicyLine>{cancelFeeLine}</PolicyLine> : null}
        <PolicyLine>{dueLine}</PolicyLine>
        <PolicyLine subtle>{failureLine}</PolicyLine>
        {lateFeeLine ? <PolicyLine subtle>{lateFeeLine}</PolicyLine> : null}
      </ul>
    </section>
  );
}

function PolicyLine({
  children,
  subtle,
}: {
  children: React.ReactNode;
  subtle?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-1.5 inline-block h-1 w-1 flex-none rounded-full ${
          subtle ? "bg-ink-soft" : "bg-lavender-500"
        }`}
        aria-hidden="true"
      />
      <span className={subtle ? "text-ink-muted text-[12px]" : ""}>{children}</span>
    </li>
  );
}

function refundCopy(policies: PublicPolicies): string {
  switch (policies.refundPolicy) {
    case "full":
      return "Full refund anytime before your appointment.";
    case "none":
      return "No refunds on paid installments.";
    case "first_installment_only":
      return "Only your first installment is refundable. Later payments stay with the merchant.";
    case "sliding_scale": {
      const t = policies.refundSlidingThresholdPercent ?? 50;
      return `Full refund before ${t}% through your plan, no refund after.`;
    }
    case "credit_only":
      return "No cash refunds. Paid amount becomes credit toward a future booking.";
  }
}

function cancellationFeeCopy(policies: PublicPolicies): string | null {
  if (!policies.cancellationFeeEnabled || policies.cancellationFeeValue == null) return null;
  const amount = policies.cancellationFeeType === "percentage"
    ? `${policies.cancellationFeeValue}%`
    : formatDollarsCompact(policies.cancellationFeeValue);
  if (policies.cancellationFeeThresholdPercent != null) {
    return `${amount} cancellation fee after ${policies.cancellationFeeThresholdPercent}% through your plan.`;
  }
  return `${amount} cancellation fee applies.`;
}

function dueDateCopy(policies: PublicPolicies): string {
  switch (policies.paymentDuePolicy) {
    case "at_appointment":
      return "All payments due by check-in.";
    case "one_week_before":
      return "All payments due 1 week before your appointment.";
    case "one_month_before":
      return "All payments due 1 month before your appointment.";
    case "custom_months": {
      const m = policies.paymentDueCustomMonths ?? 0;
      return `All payments due ${m} ${m === 1 ? "month" : "months"} before your appointment.`;
    }
  }
}

function failedPaymentCopy(policies: PublicPolicies): string {
  const attempts = policies.retryAttempts;
  const spacing = policies.retrySpacingDays;
  const retryClause = attempts === 1
    ? `we'll retry once`
    : `we'll retry up to ${attempts} times, ${spacing} ${spacing === 1 ? "day" : "days"} apart`;
  const afterClause = policies.afterRetriesAction === "balance_due_at_checkin"
    ? "your booking holds the remaining balance until check-in"
    : "your booking is canceled under the refund policy above";
  return `If a payment fails, ${retryClause}. After that, ${afterClause}.`;
}

function lateFeeCopy(policies: PublicPolicies): string | null {
  if (!policies.lateFeeEnabled || policies.lateFeeValue == null) return null;
  const amount = policies.lateFeeType === "percentage"
    ? `${policies.lateFeeValue}%`
    : formatDollarsCompact(policies.lateFeeValue);
  const scope = policies.lateFeeScope === "once_per_plan" ? "once" : "each time";
  return `${amount} late fee applies ${scope} a payment fails.`;
}
