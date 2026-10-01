"use client";

import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMemo, useState } from "react";
import {
  deriveDisplayAmounts,
  distributeInstallments,
  submitCheckout,
  type CheckoutResponse,
  type PublicMerchant,
  type PublicPlanFrequency,
  type PublicPlanOption,
} from "@/lib/publicApi";
import { DEFAULT_PLAN_RULES, type PlanRules } from "@/lib/api";
import {
  computeDepositCents,
  previewEligibility,
  type PlanFrequency,
  type PreviewResult,
} from "@/lib/eligibility";
import { formatMoneyCompact, todayIn, type MoneyContext } from "@/lib/money";
import { DepositCallout } from "./DepositCallout";
import { MerchantBlock, hostName } from "./MerchantBlock";
import { PlanPicker } from "./PlanPicker";
import { PolicyDisclosure } from "./PolicyDisclosure";
import { ScheduleVisualizer } from "./ScheduleVisualizer";
import { TooClose } from "./TooClose";
import { TrustSignals } from "./TrustSignals";
import {
  StripeCardSection,
  type CollectedCard,
} from "./StripeCardSection";
import { Confirmation } from "./Confirmation";
import { CheckoutSummaryCard } from "./CheckoutSummaryCard";
import { DemoCardSection } from "./DemoCardSection";

export type CheckoutCart = {
  // Minor units of the property's currency.
  totalCents: number;
  // ISO 4217 code from the checkout URL, when it carries one. Sent with the
  // checkout so the backend can refuse a cart priced in another currency.
  currency: string | null;
  checkin: string;
  checkout: string | null;
  description: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
};

type Step = "plan" | "card" | "confirmed";

export function CheckoutFlow({
  merchant,
  cart,
  returnUrl,
  feeRate,
  money,
}: {
  merchant: PublicMerchant;
  cart: CheckoutCart;
  // The property's currency and locale. The page refuses to render checkout
  // for a property with no currency, so this is always present here.
  money: MoneyContext;
  // Resolved server-side from the route's slug and threaded through, so every
  // figure on this page and its confirmation quotes the one rate.
  feeRate: number;
  // TODO: in production, validate return_url against an allow-list of
  // merchant-registered URLs to prevent open-redirect attacks. No validation
  // needed for local demo.
  returnUrl?: string | null;
}) {
  const [step, setStep] = useState<Step>("plan");
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<CheckoutResponse | null>(null);

  // Mirror the backend rules type for the eligibility helper. The public
  // /merchants/:slug endpoint already returns these in the right shape.
  const rules = adaptPolicies(merchant.policies);
  // "Today" is the property's calendar date, as the backend computes it, so
  // the preview offers the same schedule the plan will be built on.
  const preview: PreviewResult = useMemo(
    () =>
      previewEligibility(
        todayIn(merchant.timeZone),
        cart.checkin,
        cart.checkout,
        cart.totalCents,
        rules,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart.totalCents, cart.checkin, cart.checkout, merchant.timeZone],
  );

  const defaultFreq: PlanFrequency =
    preview.options.find((o) => o.recommended)?.frequency
    ?? preview.options[0]?.frequency
    ?? "monthly";
  const [selected, setSelected] = useState<PlanFrequency>(defaultFreq);
  const selectedOption = preview.options.find((o) => o.frequency === selected) ?? preview.options[0];

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!merchant.stripe.configured || !merchant.stripe.publishableKey) return null;
    return loadStripe(merchant.stripe.publishableKey);
  }, [merchant.stripe.configured, merchant.stripe.publishableKey]);

  if (step === "confirmed" && confirmed) {
    return <Confirmation
        booking={syntheticBookingFromCart(merchant, cart, money, confirmed)}
        plan={syntheticPlanFromCheckout(confirmed)}
        feeRate={feeRate} />;
  }

  const ineligible = !preview.eligible;
  // For ineligible, render the TooClose component which dispatches on
  // the eligibility reason — same UX as the merchant-link flow.
  if (ineligible) {
    return (
      <>
        <MerchantBlock merchant={merchant.merchant} />
        <CheckoutSummaryCard
          cart={cart}
          originalTotalCents={preview.originalTotalAmountCents}
          discountedTotalCents={preview.discountedTotalAmountCents}
          feeRate={feeRate}
          money={money}
        />
        <TooClose
          booking={syntheticBookingFromCart(merchant, cart, money, null, preview.reason, preview.daysToAppointment)}
          returnUrl={returnUrl}
        />
      </>
    );
  }

  if (!selectedOption) return null;
  const showCardStep = step === "card";
  const depositCents = preview.depositAmountCents;
  const hasDeposit = depositCents > 0;
  const publicOption = toPublicPlanOption(selectedOption);
  const planOptions = preview.options.map(toPublicPlanOption);
  const display = deriveDisplayAmounts({
    discountedTotalCents: preview.discountedTotalAmountCents,
    originalDepositCents: depositCents,
    feeRate,
  });
  const distribution = distributeInstallments({
    remainingCents: display.remainingCents,
    numPayments: publicOption.numPayments,
  });

  return (
    <>
      <MerchantBlock merchant={merchant.merchant} />
      <CheckoutSummaryCard
        cart={cart}
        originalTotalCents={preview.originalTotalAmountCents}
        discountedTotalCents={preview.discountedTotalAmountCents}
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
          options={planOptions}
          selected={publicOption.frequency}
          onSelect={(f) => setSelected(f)}
          remainingCents={display.remainingCents}
          money={money}
        />
        <ScheduleVisualizer
          option={publicOption}
          todayCents={display.todayCents}
          perPaymentCents={distribution.perPaymentCents}
          finalPaymentCents={distribution.finalPaymentCents}
          money={money}
        />
        <PolicyDisclosure
          policies={merchant.policies}
          creditInsteadOfRefund={merchant.rail === "mews"}
          money={money}
        />
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
          {returnUrl ? (
            <div className="mt-2 text-center">
              <a
                href={returnUrl}
                className="text-[12px] text-ink-muted hover:underline"
              >
                Return to {hostName(merchant.merchant)}
              </a>
            </div>
          ) : null}
          <TrustSignals />
        </>
      ) : null}

      {showCardStep ? (
        stripePromise ? (
          <Elements stripe={stripePromise}>
            <StripeCardSection
              emailInitial={cart.email ?? ""}
              busy={busy}
              onCancel={() => setStep("plan")}
              ctaLabel="Book now"
              disclosure={disclosureCopy(hasDeposit, display.todayCents, distribution.perPaymentCents, publicOption, money)}
              onCardCollected={async (card) => {
                await handleSubmit(card);
              }}
              returnUrl={returnUrl}
              merchantName={hostName(merchant.merchant)}
            />
            {topError ? (
              <div className="mt-3 text-[12px] text-danger" role="alert">{topError}</div>
            ) : null}
          </Elements>
        ) : (
          <DemoCardSection
            emailInitial={cart.email ?? ""}
            busy={busy}
            onCancel={() => setStep("plan")}
            ctaLabel="Book now"
            disclosure={disclosureCopy(hasDeposit, display.todayCents, distribution.perPaymentCents, publicOption, money)}
            onDemoSubmit={handleDemoSubmit}
            returnUrl={returnUrl}
            merchantName={hostName(merchant.merchant)}
          />
        )
      ) : null}
    </>
  );

  async function handleDemoSubmit(card: import("./DemoCardSection").DemoCardSubmission) {
    // Demo mode: POST to /api/v1/public/checkout the same way the real path
    // does, with a synthesized pm_demo_* id and the form's card details.
    // The backend's PlanCreationService demo branch persists the same DB
    // rows the real path persists. No client-side synthesis here.
    setTopError(null);
    setBusy(true);
    const result = await submitCheckout({
      merchantSlug: merchant.merchant.slug,
      totalAmountCents: cart.totalCents,
      currency: cart.currency,
      appointmentDate: cart.checkin,
      checkoutDate: cart.checkout,
      description: cart.description,
      customerName: cart.name ?? card.email.split("@")[0] ?? "",
      customerEmail: card.email,
      customerPhone: cart.phone,
      paymentMethodId: `pm_demo_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      frequency: publicOption.frequency,
      demoCardLastFour: card.lastFour,
      demoCardExpMonth: card.expMonth,
      demoCardExpYear: card.expYear,
      demoCardBrand: card.brand,
    });
    setBusy(false);
    if (!result.ok) {
      setTopError(result.error.message);
      return;
    }
    setConfirmed(result.data);
    setStep("confirmed");
  }

  async function handleSubmit(card: CollectedCard) {
    setTopError(null);
    setBusy(true);
    const result = await submitCheckout({
      merchantSlug: merchant.merchant.slug,
      totalAmountCents: cart.totalCents,
      currency: cart.currency,
      appointmentDate: cart.checkin,
      checkoutDate: cart.checkout,
      description: cart.description,
      customerName: cart.name ?? card.email.split("@")[0] ?? "",
      customerEmail: card.email,
      customerPhone: cart.phone,
      paymentMethodId: card.paymentMethodId,
      frequency: publicOption.frequency,
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

function adaptPolicies(p: PublicMerchant["policies"]): PlanRules {
  // previewEligibility only consults the eligibility-related fields
  // (lead time, frequencies, amounts, deposit). Spread the system
  // defaults for the policy-stack fields we don't use here so the type
  // matches PlanRules exactly without inventing fake values.
  return {
    ...DEFAULT_PLAN_RULES,
    minLeadTimeWeeks: p.minLeadTimeWeeks,
    maxLeadTimeWeeks: p.maxLeadTimeWeeks,
    allowedFrequencies: p.allowedFrequencies,
    minBookingAmountCents: p.minBookingAmountCents,
    maxBookingAmountCents: p.maxBookingAmountCents,
    recommendedFrequency: p.recommendedFrequency as PlanFrequency | null,
    depositRequired: p.depositRequired,
    depositType: p.depositType,
    depositValue: p.depositValue,
    depositMaxCents: p.depositMaxCents,
    discountBasisPoints: p.discountBasisPoints,
  };
}

function toPublicPlanOption(o: PreviewResult["options"][number]): PublicPlanOption {
  return {
    frequency: o.frequency as PublicPlanFrequency,
    numPayments: o.numPayments,
    perPaymentAmountCents: o.perPaymentAmountCents,
    finalPaymentAmountCents: o.finalPaymentAmountCents,
    dueDates: o.dueDates,
    recommended: o.recommended,
  };
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

/**
 * Confirmation + TooClose components expect a PublicBooking shape. Synthesize
 * one from the cart + merchant so we don't have to fork those components.
 */
function syntheticBookingFromCart(
  merchant: PublicMerchant,
  cart: CheckoutCart,
  money: MoneyContext,
  // The created booking's currency, locale and zone once checkout has gone
  // through; before that, the property's.
  confirmed: CheckoutResponse | null = null,
  reason: string = "ok",
  daysToAppointment: number = 0,
) {
  return {
    merchant: merchant.merchant,
    service: {
      name: cart.description ?? "Booking",
      description: null,
      totalAmountCents: cart.totalCents,
      appointmentDate: cart.checkin,
      checkoutDate: cart.checkout,
      cancellationPolicy: null,
      customerNameHint: cart.name,
      customerEmailHint: cart.email,
    },
    eligibility: {
      eligible: reason === "ok",
      reason,
      daysToAppointment,
      depositAmountCents: 0,
      originalTotalAmountCents: cart.totalCents,
      discountedTotalAmountCents: cart.totalCents,
    },
    planOptions: [],
    stripe: merchant.stripe,
    policies: merchant.policies,
    status: "sent",
    rail: merchant.rail,
    currency: confirmed?.currency ?? money.currency,
    locale: confirmed ? confirmed.locale : (money.locale ?? null),
    timeZone: confirmed ? confirmed.timeZone : merchant.timeZone,
  };
}

function syntheticPlanFromCheckout(r: CheckoutResponse) {
  return {
    planId: r.planId,
    bookingId: r.bookingId,
    bookingToken: r.bookingToken,
    frequency: r.frequency,
    numPayments: r.numPayments,
    totalAmountCents: r.totalAmountCents,
    originalTotalAmountCents: r.originalTotalAmountCents,
    depositAmountCents: r.depositAmountCents,
    schedule: r.schedule,
    firstChargeIntentId: r.firstChargeIntentId,
    firstChargeStatus: r.firstChargeStatus,
  };
}

// Suppress unused: computeDepositCents is exported by eligibility.ts but
// only used internally for preview math. Re-importing here is intentional
// to keep this file's eligibility-related imports in one place if we add
// deposit-specific helpers later.
void computeDepositCents;
