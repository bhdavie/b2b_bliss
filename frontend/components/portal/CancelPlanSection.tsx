"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelPlan, type PortalCancellation, type PublicRail } from "@/lib/publicApi";
import { formatMoney, plainDateToUtc, type MoneyContext } from "@/lib/money";
import { Button } from "@/components/ui/Button";

// Cancel a plan. When the server sends `cancellation` (every active plan), the
// guest sees the booking's terms and exactly what cancelling now does, worked
// out server-side from the terms the booking was made under; confirming calls
// the cancel endpoint, which stops the remaining payments and refunds or
// credits what is due. The fallback below, for a response without it, keeps the
// older estimate from the rate name.

type Refundability = "flexible" | "nonrefundable";

function deriveRefundability(serviceName: string): Refundability {
  return /advance purchase|non[- ]?refundable/i.test(serviceName)
    ? "nonrefundable"
    : "flexible";
}

/**
 * True when it is more than 48 hours until midnight at the start of the
 * arrival date, measured at the property: both ends are read as wall-clock
 * time in the property's zone (UTC when it has none), so the guest's own
 * browser zone does not move the window. A DST change inside the window can
 * shift it by the hour the clocks move, which is acceptable for this notice.
 */
function moreThan48hAway(appointmentDateIso: string, timeZone: string | null): boolean {
  const arrival = plainDateToUtc(appointmentDateIso);
  if (!arrival) return false;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const nowAtProperty = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return arrival.getTime() - nowAtProperty > 48 * 60 * 60 * 1000;
}

export function CancelPlanSection({
  token,
  serviceName,
  appointmentDate,
  paidCents,
  processingFeeCents,
  rail,
  money,
  timeZone,
  cancellation = null,
}: {
  token: string;
  serviceName: string;
  appointmentDate: string;
  paidCents: number;
  processingFeeCents: number;
  rail?: PublicRail;
  // The booking's currency and locale, and the property's zone for the 48
  // hour window.
  money: MoneyContext;
  timeZone: string | null;
  cancellation?: PortalCancellation | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundability = deriveRefundability(serviceName);
  const inWindow = moreThan48hAway(appointmentDate, timeZone);
  // A Mews stay is cancelled in the hotel's system and credited toward a
  // future stay there, never refunded in cash. The amount follows the hotel's
  // cancellation policy and is settled by the server, so it is shown after.
  const isMewsStay = rail === "mews";

  async function confirmMewsCancel() {
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await cancelPlan(token);
    } catch {
      setBusy(false);
      setError("Something went wrong. Please check your connection and try again.");
      return;
    }
    if (res.ok) {
      const credit = res.creditCents > 0 ? `&credit=${res.creditCents}` : "";
      router.push(`/account/history?canceled=${encodeURIComponent(token)}${credit}`);
      return;
    }
    if (res.status === 404 || res.status === 409) {
      router.push(`/account/history?canceled=${encodeURIComponent(token)}`);
      return;
    }
    setBusy(false);
    // 502: the hotel's system couldn't be reached. Nothing changed, and the
    // server's message says so.
    setError(res.status === 502 ? res.error.message : "We could not cancel your stay. Please try again.");
  }

  async function confirmCancel() {
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await cancelPlan(token);
    } catch {
      // Genuine network failure unrelated to the plan state.
      setBusy(false);
      setError("Something went wrong. Please check your connection and try again.");
      return;
    }
    // A 404 (plan no longer active) or 409 means the plan is already cancelled.
    // Treat that as success and route to history the same way, so the guest
    // never sees a raw "plan not found" string.
    const alreadyCancelled =
      !res.ok && (res.status === 404 || res.status === 409);
    if (res.ok || alreadyCancelled) {
      // Keep busy true so the buttons stay disabled through navigation.
      router.push(`/account/history?canceled=${encodeURIComponent(token)}`);
      return;
    }
    setBusy(false);
    setError("We could not cancel this plan. Please try again.");
  }

  if (cancellation) {
    return (
      <div className="space-y-3">
        {cancellation.terms ? (
          <p className="text-[13px] text-ink-900">{cancellation.terms}</p>
        ) : null}
        <p className="text-[13px] text-ink-500">
          Cancelling stops every remaining payment. {cancellation.message}
        </p>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        {confirming ? (
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={isMewsStay ? confirmMewsCancel : confirmCancel}
              disabled={busy}
              variant="primary"
            >
              {busy ? "Cancelling" : "Confirm cancellation"}
            </Button>
            <Button type="button" onClick={() => setConfirming(false)} disabled={busy} variant="ghost">
              {isMewsStay ? "Keep my stay" : "Keep my plan"}
            </Button>
          </div>
        ) : (
          <Button type="button" onClick={() => setConfirming(true)} variant="ghost">
            {isMewsStay ? "Cancel stay" : "Cancel plan"}
          </Button>
        )}
      </div>
    );
  }

  if (isMewsStay) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-ink-500">
          Cancelling your stay stops every remaining payment. What you&apos;ve paid becomes credit
          toward a future stay at this property, following its cancellation policy. You&apos;ll see
          the amount once your stay is cancelled.
        </p>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        {confirming ? (
          <div className="flex gap-2">
            <Button type="button" onClick={confirmMewsCancel} disabled={busy} variant="primary">
              {busy ? "Cancelling" : "Confirm cancellation"}
            </Button>
            <Button type="button" onClick={() => setConfirming(false)} disabled={busy} variant="ghost">
              Keep my stay
            </Button>
          </div>
        ) : (
          <Button type="button" onClick={() => setConfirming(true)} variant="ghost">
            Cancel stay
          </Button>
        )}
      </div>
    );
  }

  // Non-refundable rate: cancel is not offered.
  if (refundability === "nonrefundable") {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-ink-900">
          This rate is non-refundable per the hotel&apos;s policy.
        </p>
        <p className="text-[13px] text-ink-500">
          The amount already paid is not returned, so this plan cannot be
          cancelled here. Reach out to the hotel directly with any questions.
        </p>
        <Button type="button" disabled variant="ghost" className="opacity-60">
          Cancel plan
        </Button>
      </div>
    );
  }

  // Flexible rate: full refund including the Bliss fee when in window; out of
  // window the refund follows the hotel policy and the Bliss fee is withheld.
  const refundCents = inWindow
    ? paidCents
    : Math.max(0, paidCents - processingFeeCents);

  if (!confirming) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-ink-500">
          {inWindow
            ? "You are more than 48 hours before arrival, so cancelling returns your full payment."
            : "You are within 48 hours of arrival. Your refund follows the hotel's policy and the Bliss processing fee is not returned."}
        </p>
        <Button
          type="button"
          onClick={() => setConfirming(true)}
          variant="ghost"
        >
          Cancel plan
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-card border border-sand-500 bg-white p-4">
      <div>
        <div className="text-[11px] text-ink-500">
          Refund {inWindow ? "(includes the Bliss fee)" : "(per the hotel policy)"}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {formatMoney(refundCents, money)}
        </div>
      </div>
      <p className="text-[13px] text-ink-500">
        Cancelling stops every remaining installment. This figure is what you
        are due back. We will sort the refund out for you.
      </p>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={confirmCancel}
          disabled={busy}
          variant="primary"
        >
          {busy ? "Cancelling" : "Confirm cancellation"}
        </Button>
        <Button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          variant="ghost"
        >
          Keep my plan
        </Button>
      </div>
    </div>
  );
}
