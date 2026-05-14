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
} from "@/lib/publicApi";
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
        <PlanPicker
          options={booking.planOptions}
          selected={selectedOption.frequency}
          onSelect={(f) => setSelected(f)}
        />
        <ScheduleVisualizer option={selectedOption} />
      </div>

      {step === "plan" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("card")}
            disabled={!booking.stripe.configured}
            className="mt-6 w-full rounded-md bg-lavender-500 px-4 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-lavender-600 disabled:opacity-60"
          >
            Continue to payment
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
              ctaLabel={`Confirm and pay ${formatDollarsCompact(selectedOption.perPaymentAmountCents)} today`}
              disclosure={`Your card will be charged ${formatDollarsCompact(selectedOption.perPaymentAmountCents)} today. ${
                selectedOption.numPayments - 1
              } more ${
                selectedOption.frequency === "biweekly"
                  ? "bi-weekly"
                  : "monthly"
              } payments will follow on the schedule above. You can cancel anytime.`}
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
