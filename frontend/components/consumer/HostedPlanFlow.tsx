"use client";

import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import {
  createPlan,
  formatDollarsCompact,
  type CreatePlanResponse,
  type PublicBooking,
  type PublicPlanFrequency,
  type PublicPlanOption,
} from "@/lib/publicApi";
import { DepositCallout } from "./DepositCallout";
import { MerchantBlock } from "./MerchantBlock";
import { PlanPicker } from "./PlanPicker";
import { ScheduleVisualizer } from "./ScheduleVisualizer";
import { ServiceCard } from "./ServiceCard";
import {
  StripeCardSection,
  StripeNotConfiguredCard,
  type CollectedCard,
} from "./StripeCardSection";
import { TrustSignals } from "./TrustSignals";
import { Confirmation } from "./Confirmation";

type Step = "plan" | "card" | "confirmed";

export function HostedPlanFlow({ booking }: { booking: PublicBooking }) {
  const [step, setStep] = useState<Step>("plan");
  const [selected, setSelected] = useState<PublicPlanFrequency>(
    pickDefaultFrequency(booking),
  );
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<CreatePlanResponse | null>(null);

  const selectedOption =
    booking.planOptions.find((o) => o.frequency === selected) ??
    booking.planOptions[0];

  const depositCents = booking.eligibility.depositAmountCents;
  const hasDeposit = depositCents > 0;

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!booking.stripe.configured || !booking.stripe.publishableKey) return null;
    return loadStripe(booking.stripe.publishableKey);
  }, [booking.stripe.configured, booking.stripe.publishableKey]);

  if (step === "confirmed" && confirmed) {
    return <Confirmation booking={booking} plan={confirmed} />;
  }

  if (!selectedOption) return null;

  const showCardStep = step === "card";

  return (
    <>
      <MerchantBlock merchant={booking.merchant} />
      <ServiceCard service={booking.service} />

      <div className={showCardStep ? "pointer-events-none opacity-30" : ""}>
        {hasDeposit ? (
          <DepositCallout
            depositAmountCents={depositCents}
            totalAmountCents={booking.service.totalAmountCents}
          />
        ) : null}
        <PlanPicker
          options={booking.planOptions}
          selected={selectedOption.frequency}
          onSelect={(f) => setSelected(f)}
        />
        <ScheduleVisualizer
          option={selectedOption}
          depositAmountCents={depositCents}
        />
      </div>

      {step === "plan" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("card")}
            disabled={!booking.stripe.configured}
            className="mt-6 w-full rounded-md bg-lavender-500 px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-lavender-600 disabled:opacity-60"
          >
            {planCtaLabel(hasDeposit, depositCents, selectedOption, booking.service.totalAmountCents)}
          </button>
          {!booking.stripe.configured ? <StripeNotConfiguredCard /> : null}
          <TrustSignals />
        </>
      ) : null}

      {showCardStep ? (
        stripePromise ? (
          <Elements stripe={stripePromise}>
            <StripeCardSection
              emailInitial={booking.service.customerEmailHint ?? ""}
              busy={busy}
              onCancel={() => setStep("plan")}
              ctaLabel={cardCtaLabel(hasDeposit, depositCents, selectedOption)}
              disclosure={disclosureCopy(hasDeposit, depositCents, selectedOption)}
              onCardCollected={async (card) => {
                await handleSubmit(booking, selectedOption.frequency, card);
              }}
            />
            {topError ? (
              <div className="mt-3 text-[12px] text-red-600" role="alert">
                {topError}
              </div>
            ) : null}
          </Elements>
        ) : (
          <StripeNotConfiguredCard />
        )
      ) : null}
    </>
  );

  async function handleSubmit(
    booking: PublicBooking,
    frequency: PublicPlanFrequency,
    card: CollectedCard,
  ) {
    setTopError(null);
    setBusy(true);
    const result = await createPlan({
      merchantSlug: booking.merchant.slug,
      bookingToken: extractTokenFromCurrentPath(),
      customerEmail: card.email,
      paymentMethodId: card.paymentMethodId,
      frequency,
    });
    setBusy(false);
    if (!result.ok) {
      setTopError(result.error.message);
      return;
    }
    setConfirmed(result.data);
    setStep("confirmed");
  }
}

function pickDefaultFrequency(booking: PublicBooking): PublicPlanFrequency {
  const recommended = booking.planOptions.find((o) => o.recommended);
  if (recommended) return recommended.frequency;
  return booking.planOptions[0]?.frequency ?? "monthly";
}

function extractTokenFromCurrentPath(): string {
  // The path is /pay/{slug}/{token}. We're a client component so reading
  // window.location is fine; the parent server component already validated
  // the URL has the right shape before mounting us.
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[2] ?? "";
}

function planCtaLabel(
  hasDeposit: boolean,
  depositCents: number,
  option: PublicPlanOption,
  totalCents: number,
): string {
  if (!hasDeposit) return "Continue to payment";
  const remaining = totalCents - depositCents;
  const cadence = option.frequency === "biweekly" ? "bi-weekly" : "monthly";
  return `Pay ${formatDollarsCompact(depositCents)} today, schedule ${formatDollarsCompact(remaining)} ${cadence}`;
}

function cardCtaLabel(
  hasDeposit: boolean,
  depositCents: number,
  option: PublicPlanOption,
): string {
  if (hasDeposit) {
    return `Confirm and pay ${formatDollarsCompact(depositCents)} deposit today`;
  }
  return `Confirm and pay ${formatDollarsCompact(option.perPaymentAmountCents)} today`;
}

function disclosureCopy(
  hasDeposit: boolean,
  depositCents: number,
  option: PublicPlanOption,
): string {
  const cadence = option.frequency === "biweekly" ? "bi-weekly" : "monthly";
  if (hasDeposit) {
    return (
      `Your card will be charged ${formatDollarsCompact(depositCents)} today as a deposit. ` +
      `${option.numPayments} ${cadence} payment${option.numPayments === 1 ? "" : "s"} ` +
      `of ${formatDollarsCompact(option.perPaymentAmountCents)} will be charged automatically on the schedule above. ` +
      `You can cancel anytime.`
    );
  }
  return (
    `Your card will be charged ${formatDollarsCompact(option.perPaymentAmountCents)} today. ` +
    `${option.numPayments - 1} more ${cadence} payments will follow on the schedule above. ` +
    `You can cancel anytime.`
  );
}
