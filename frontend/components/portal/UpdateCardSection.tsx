"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { replacePaymentMethod } from "@/lib/publicApi";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SectionHeading } from "@/components/ui/primitives";

/**
 * Replace the saved card on a plan. Branches once on
 * {@code stripeConfigured}: real arm would mount Stripe Elements + a
 * SetupIntent confirm; demo arm uses a plain form and synthesizes a
 * pm_demo_* id. For the current demo we only ship the demo arm — the
 * real arm is a placeholder that surfaces the SetupIntent client_secret
 * fetch but stops short of mounting Stripe.js (out of scope for the
 * current build; the portal still renders, just with a "card update
 * requires Stripe configuration" notice).
 *
 * The editor opens in a centred modal portalled to document.body rather than
 * expanding in place. Both mount points sit in a narrow column — 300px on the
 * plan detail, 420px on Settings — and a card form does not fit either. A modal
 * escapes both without the surrounding layout having to know it is open, so the
 * Card on file panel underneath stays exactly as it is.
 */
export function UpdateCardSection({
  token,
  stripeConfigured: _stripeConfigured,
  stripePublishableKey: _stripePublishableKey,
  onReplaced,
  variant = "inline",
}: {
  token: string;
  stripeConfigured: boolean;
  stripePublishableKey: string | null;
  onReplaced: () => void | Promise<void>;
  /**
   * How the closed trigger renders. "inline" is the plan detail's text link
   * sitting beside the card row; "block" is Settings' full-width outline pill.
   */
  variant?: "inline" | "block";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/30");
  const [zip, setZip] = useState("12345");

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Open-state side effects, all undone on close: focus into the dialog, Escape
  // to dismiss, and the page behind held still. Focus returns to the trigger,
  // which stays mounted now that the panel no longer swaps itself out.
  useEffect(() => {
    if (!open) return;

    // Captured now rather than read in the cleanup: the trigger stays mounted
    // for the modal's whole lifetime, so this is the element focus goes back to.
    const trigger = triggerRef.current;
    dialogRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const digits = cardNumber.replace(/\D+/g, "");
    const lastFour = digits.slice(-4).padStart(4, "0");
    const [mm, yy] = expiry.split("/").map((s) => s.trim());
    const expMonth = parseInt(mm ?? "12", 10) || 12;
    const yyNum = parseInt(yy ?? "30", 10);
    const expYear = Number.isFinite(yyNum) ? (yyNum < 100 ? 2000 + yyNum : yyNum) : 2030;
    const brand = inferBrand(digits);

    setBusy(true);
    const result = await replacePaymentMethod(token, {
      paymentMethodId: `pm_demo_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      demoCardLastFour: lastFour,
      demoCardExpMonth: expMonth,
      demoCardExpYear: expYear,
      demoCardBrand: brand,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    await onReplaced();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={
          variant === "block"
            ? "rounded-full border border-sand-500 p-4 text-center text-base font-medium tracking-[-0.01em] text-brand-violet transition-colors hover:bg-sand-50"
            : "flex-none text-[15px] text-brand-violet underline-offset-2 hover:underline"
        }
      >
        Update card
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              {/* Neutral scrim: ink at 40%, not the old navy-tinted overlay. */}
              <div
                className="absolute inset-0 bg-ink-900/40"
                onClick={() => setOpen(false)}
                aria-hidden="true"
              />

              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="relative flex max-h-[calc(100vh-48px)] w-full max-w-[480px] flex-col overflow-y-auto rounded-panel bg-white p-8 focus:outline-none"
              >
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div id={titleId}>
                    <SectionHeading>Replace card</SectionHeading>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                    className="-mr-1 -mt-1 flex-none text-xl leading-none text-ink-500 transition-colors hover:text-ink-900"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <label className="block">
                    <span className="label">Card number</span>
                    <Input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      inputMode="numeric"
                      autoComplete="cc-number"
                      className="mt-1.5 tabular-nums"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block">
                      <span className="label">Expiry</span>
                      <Input
                        type="text"
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        className="mt-1.5 tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="label">ZIP</span>
                      <Input
                        type="text"
                        value={zip}
                        onChange={(e) => setZip(e.target.value)}
                        inputMode="numeric"
                        autoComplete="postal-code"
                        className="mt-1.5 tabular-nums"
                      />
                    </label>
                  </div>
                  {error ? (
                    <div role="alert" className="text-xs text-red-700">
                      {error}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="submit" disabled={busy} variant="primary">
                      {busy ? "Saving…" : "Save new card"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setOpen(false)}
                      disabled={busy}
                      variant="ghost"
                      className="disabled:opacity-50"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function inferBrand(digits: string): string {
  if (digits.length === 0) return "visa";
  const first = digits[0];
  if (first === "4") return "visa";
  if (first === "5" || first === "2") return "mastercard";
  if (first === "3") return "amex";
  if (first === "6") return "discover";
  return "visa";
}
