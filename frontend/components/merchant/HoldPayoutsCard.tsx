import type { HoldPayout, HoldRelease } from "@/lib/api";
import { formatInstant, formatMoney, formatPlainDate } from "@/lib/money";
import { Panel, SectionHeading } from "@/components/ui/primitives";

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

function stepLabel(r: HoldRelease): string {
  if (r.step === "cancellation") return "Kept after a cancellation";
  if (r.step === "fee_debit") return "Bliss fee on a refund";
  return "Payment";
}

function statusLabel(r: HoldRelease, timeZone: string | null, locale: string | null): string {
  if (r.step === "fee_debit") {
    return r.status === "released" ? "Taken from your Stripe balance" : "Waiting to be collected";
  }
  switch (r.status) {
    case "scheduled":
      return r.failing
        ? "Retrying"
        : `Held until ${formatInstant(r.releaseAt, locale, timeZone, DATE)}`;
    case "released":
      return r.releasedAt ? `Sent ${formatInstant(r.releasedAt, locale, timeZone, DATE)}` : "Sent";
    case "reversed":
      return "Returned for a refund";
    default:
      return "Not sent, the booking was cancelled";
  }
}

/**
 * Hold mode, for the property: what Bliss is holding and when it will be sent,
 * what has been sent, and Stripe's payouts to the bank (spec, phase 5d). Shown
 * only when the property holds payments.
 */
export function HoldPayoutsCard({
  releases,
  payouts,
  locale,
  timeZone,
}: {
  releases: HoldRelease[];
  payouts: HoldPayout[];
  locale: string | null;
  timeZone: string | null;
}) {
  const held = releases.filter((r) => r.status === "scheduled" && r.step !== "fee_debit");
  const heldByCurrency = new Map<string, number>();
  for (const r of held) {
    heldByCurrency.set(r.currency, (heldByCurrency.get(r.currency) ?? 0) + r.amountMinor);
  }
  return (
    <Panel className="gap-[20px] p-[28px]">
      <div className="flex flex-col gap-[6px]">
        <SectionHeading>Your payouts</SectionHeading>
        <p className="text-[14px] text-ink-500">
          Bliss holds each payment until it can no longer be refunded, then sends it to your Stripe
          account, less the Bliss fee. Stripe pays it into your bank.
        </p>
        {heldByCurrency.size > 0 ? (
          <p className="text-[14px] text-ink-900">
            Held for you now:{" "}
            {[...heldByCurrency].map(([currency, total]) => formatMoney(total, { currency, locale })).join(", ")}
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-[10px]">
        <h3 className="text-[15px] font-medium text-ink-900">Payments</h3>
        {releases.length === 0 ? (
          <p className="text-[14px] text-ink-500">Nothing yet. Payments show here once guests pay.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-sand-200">
            {releases.map((r) => (
              <li key={r.id} className="flex flex-col gap-[2px] py-[10px] sm:flex-row sm:justify-between sm:gap-[16px]">
                <span className="flex flex-col gap-[2px]">
                  <span className="text-[14px] text-ink-900">{r.stay ?? "Booking"}</span>
                  <span className="text-[13px] text-ink-500">
                    {stepLabel(r)}
                    {r.checkIn ? `, check-in ${formatPlainDate(r.checkIn, locale, DATE)}` : ""}
                  </span>
                </span>
                <span className="flex flex-col gap-[2px] sm:items-end sm:text-right">
                  <span className="text-[14px] tabular-nums text-ink-900">
                    {formatMoney(r.step === "fee_debit" ? r.feeMinor : r.amountMinor - r.reversedMinor, {
                      currency: r.currency,
                      locale,
                    })}
                  </span>
                  <span className="text-[12px] text-ink-500">{statusLabel(r, timeZone, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {payouts.length > 0 ? (
        <section className="flex flex-col gap-[10px]">
          <h3 className="text-[15px] font-medium text-ink-900">Paid into your bank</h3>
          <ul className="flex flex-col divide-y divide-sand-200">
            {payouts.map((p) => (
              <li key={p.stripePayoutId} className="flex items-start justify-between gap-[16px] py-[10px]">
                <span className="text-[14px] text-ink-900">
                  {p.arrivalDate ? formatPlainDate(p.arrivalDate, locale, DATE) : "Date to come"}
                </span>
                <span className="flex flex-col items-end gap-[2px] text-right">
                  <span className="text-[14px] tabular-nums text-ink-900">
                    {formatMoney(p.amountMinor, { currency: p.currency, locale })}
                  </span>
                  <span className="text-[12px] text-ink-500">
                    {p.status === "paid" ? "Arrived" : p.status === "failed" ? "Didn't go through" : "On its way"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Panel>
  );
}
