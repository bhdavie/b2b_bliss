"use client";

import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import {
  createPlan,
  deriveDisplayAmounts,
  distributeInstallments,
  type CreatePlanResponse,
  type PublicBooking,
  type PublicPlanFrequency,
  type PublicPlanOption,
} from "@/lib/publicApi";
import { formatMoneyCompact, todayIn, type MoneyContext } from "@/lib/money";
import { DepositCallout } from "./DepositCallout";
import { MerchantBlock } from "./MerchantBlock";
import { PlanPicker } from "./PlanPicker";
import { PolicyDisclosure } from "./PolicyDisclosure";
import { ScheduleVisualizer } from "./ScheduleVisualizer";
import { ServiceCard } from "./ServiceCard";
import {
  StripeCardSection,
  type CollectedCard,
} from "./StripeCardSection";
import { TrustSignals } from "./TrustSignals";
import { Confirmation } from "./Confirmation";
import { DemoCardSection } from "./DemoCardSection";

type Step = "plan" | "card" | "confirmed";

export function HostedPlanFlow({
  booking,
  feeRate,
}: {
  booking: PublicBooking;
  // Resolved server-side from the route's slug and threaded through, so every
  // figure on this page and its confirmation quotes the one rate.
  feeRate: number;
}) {
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

  const money: MoneyContext = { currency: booking.currency, locale: booking.locale };
  const depositCents = booking.eligibility.depositAmountCents;
  const hasDeposit = depositCents > 0;

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!booking.stripe.configured || !booking.stripe.publishableKey) return null;
    return loadStripe(booking.stripe.publishableKey);
  }, [booking.stripe.configured, booking.stripe.publishableKey]);

  if (step === "confirmed" && confirmed) {
    return <Confirmation booking={booking} plan={confirmed} feeRate={feeRate} />;
  }

  if (!selectedOption) return null;

  const showCardStep = step === "card";
  const display = deriveDisplayAmounts({
    discountedTotalCents: booking.eligibility.discountedTotalAmountCents,
    originalDepositCents: depositCents,
    feeRate,
  });
  const distribution = distributeInstallments({
    remainingCents: display.remainingCents,
    numPayments: selectedOption.numPayments,
  });

  return (
    <div>
      <MerchantBlock merchant={booking.merchant} />
      <ServiceCard
        service={booking.service}
        originalTotalCents={booking.eligibility.originalTotalAmountCents}
        discountedTotalCents={booking.eligibility.discountedTotalAmountCents}
        feeRate={feeRate}
        money={money}
      />

      <div className={showCardStep ? "pointer-events-none opacity-30" : ""}>
        {hasDeposit ? (
          <DepositCallout
            todayCents={display.todayCents}
            remainingCents={display.remainingCents}
            depositRate={display.depositRate}
            money={money}
          />
        ) : null}
        <PlanPicker
          options={booking.planOptions}
          selected={selectedOption.frequency}
          onSelect={(f) => setSelected(f)}
          remainingCents={display.remainingCents}
          money={money}
        />
        <ScheduleVisualizer
          option={selectedOption}
          todayCents={display.todayCents}
          perPaymentCents={distribution.perPaymentCents}
          finalPaymentCents={distribution.finalPaymentCents}
          money={money}
        />
        <PolicyDisclosure policies={booking.policies} money={money} />
      </div>

      {step === "plan" ? (
        <>
          <button
            type="button"
            onClick={() => setStep("card")}
            className="btn-primary mt-6 w-full"
          >
            Book now
          </button>
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
              ctaLabel="Book now"
              disclosure={disclosureCopy(hasDeposit, display.todayCents, distribution.perPaymentCents, selectedOption, money)}
              onCardCollected={async (card) => {
                await handleSubmit(booking, selectedOption.frequency, card);
              }}
            />
            {topError ? (
              <div className="mt-3 text-[12px] text-danger" role="alert">
                {topError}
              </div>
            ) : null}
          </Elements>
        ) : (
          <DemoCardSection
            emailInitial={booking.service.customerEmailHint ?? ""}
            busy={busy}
            onCancel={() => setStep("plan")}
            ctaLabel="Book now"
            disclosure={disclosureCopy(hasDeposit, display.todayCents, distribution.perPaymentCents, selectedOption, money)}
            onDemoSubmit={handleDemoSubmit}
          />
        )
      ) : null}
    </div>
  );

  function handleDemoSubmit() {
    if (!selectedOption) return;
    // Synthesize a CreatePlanResponse from in-scope booking data so the
    // customer always lands on the confirmation page, even when the
    // merchant's Stripe account isn't wired up. Amounts mirror the
    // deriveDisplayAmounts / distributeInstallments split, so the
    // confirmation page reads back consistent numbers.
    const now = Date.now();
    const schedule: CreatePlanResponse["schedule"] = [];
    if (display.todayCents > 0) {
      schedule.push({
        sequence: schedule.length + 1,
        dueDate: todayIn(booking.timeZone),
        amountCents: display.todayCents,
        status: "scheduled",
        kind: "deposit",
      });
    }
    selectedOption.dueDates.forEach((dueDate, i) => {
      const isFinal = i === selectedOption.dueDates.length - 1;
      schedule.push({
        sequence: schedule.length + 1,
        dueDate,
        amountCents: isFinal
          ? distribution.finalPaymentCents
          : distribution.perPaymentCents,
        status: "scheduled",
        kind: "installment",
      });
    });
    const synthetic: CreatePlanResponse = {
      planId: `demo-plan-${now}`,
      bookingId: `demo-booking-${now}`,
      // No real plan persisted on this path — the Confirmation Manage-plan
      // link is gated on a truthy token, so empty string falls back to
      // the static notice. /pay demo persistence is out of scope for now.
      bookingToken: "",
      frequency: selectedOption.frequency,
      numPayments: selectedOption.numPayments,
      totalAmountCents: booking.eligibility.discountedTotalAmountCents,
      originalTotalAmountCents: booking.eligibility.originalTotalAmountCents,
      depositAmountCents: display.todayCents,
      schedule,
      firstChargeIntentId: null as unknown as string,
      firstChargeStatus: "demo",
    };
    setConfirmed(synthetic);
    setStep("confirmed");
  }

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

function disclosureCopy(
  hasDeposit: boolean,
  todayCents: number,
  perPaymentCents: number,
  option: PublicPlanOption,
  money: MoneyContext,
): string {
  const cadence = option.frequency === "biweekly" ? "bi-weekly" : "monthly";
  if (hasDeposit) {
    return (
      `Your card will be charged ${formatMoneyCompact(todayCents, money)} today as a deposit. ` +
      `${option.numPayments} ${cadence} payment${option.numPayments === 1 ? "" : "s"} ` +
      `of ${formatMoneyCompact(perPaymentCents, money)} will be charged automatically on the schedule above. ` +
      `Cancel your booking anytime before check-in.`
    );
  }
  return (
    `Your card will be charged ${formatMoneyCompact(perPaymentCents, money)} today. ` +
    `${option.numPayments - 1} more ${cadence} payments will follow on the schedule above. ` +
    `Cancel your booking anytime before check-in.`
  );
}
