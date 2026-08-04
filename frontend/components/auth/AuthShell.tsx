import { Inter } from "next/font/google";
import type { InputHTMLAttributes, ReactNode } from "react";
import { BlissWordmark } from "@/components/BlissWordmark";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

/**
 * The single layout for every Bliss sign-in screen. Merchant and guest sign-in
 * both render through this; the diagnostic that preceded this file found the
 * two had drifted into three different heading scales, two error treatments and
 * two column widths, so everything they can disagree about now lives here.
 *
 * No "use client". That is deliberate and load-bearing:
 *  - The guest page is an async server component (it verifies the session
 *    cookie before rendering), so it needs a server-renderable wrapper with a
 *    client <LoginForm/> slotted in as children.
 *  - The merchant page is "use client" top to bottom, so it needs a shell that
 *    compiles into the client graph without complaint.
 * A component with no directive does both: it inherits the graph of whoever
 * imports it. AuthForm/AuthField/AuthError/AuthSubmit below live in this same
 * file for the same reason — they are only ever used inside a client form, but
 * they carry no state of their own, so they need no directive either.
 *
 * Not yet adopted by signup, verify or check-email. Those are next, which is
 * why subhead, children and footer are all optional: verify and check-email
 * have a heading and no form, and signup wraps its own two-panel grid around a
 * column of this shape.
 */

// Inter is declared here rather than in app/layout.tsx so it is downloaded only
// on routes that import this shell. Loading it at the root would put an unused
// font on every page including the app/inn/ funnels, which are pinned to the
// system stack on purpose. `--font-inter` is applied to the shell root below,
// so `font-inter` resolves for everything inside and nowhere else.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export function AuthShell({
  heading,
  subhead,
  children,
  footer,
}: {
  heading: string;
  subhead?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      className={`${inter.variable} font-inter flex min-h-screen items-center justify-center bg-sand-100 px-6 py-16`}
    >
      <div className="w-full max-w-md">
        {/* Wordmark sits above the card, centred, and stays Georgia bold via
            BlissWordmark's inline style — it is the one thing on the page that
            is not Inter. */}
        <div className="text-center">
          <BlissWordmark className="text-2xl text-brand-violet" />
        </div>

        {/* `.card` is rounded-panel + sand-200 border + white fill and carries
            no shadow, which is the target treatment exactly. Against the
            sand-100 page the white fill is a 1.17:1 step and carries the raised
            read on its own; the sand-200 border is now within a hair of the
            page (1.06:1), so it reads as the card's own edge rather than as the
            separator it was against sand-50. Do not darken the page further
            without revisiting that border. */}
        <Card padding="xl" className="mt-6">
          {/* No top margin: the heading is the first thing in the card, so its
              spacing is the card's own p-8 and nothing else. */}
          <h1 className="font-display text-[32px] leading-[1.15] tracking-[-0.01em] text-ink-900">
            {heading}
          </h1>

          {subhead ? (
            <p className="mt-2 text-sm text-ink-500">{subhead}</p>
          ) : null}

          {children ? <div className="mt-7">{children}</div> : null}

          {footer ? (
            <p className="mt-6 text-center text-xs text-ink-400">{footer}</p>
          ) : null}
        </Card>
      </div>
    </main>
  );
}

/**
 * The form element itself, so the gap between fields cannot be set twice.
 * `flex flex-col gap-4` rather than `space-y-4`: gap does not depend on
 * adjacent-sibling selectors, so a conditionally rendered field (the merchant
 * password input) cannot silently change the rhythm.
 */
export function AuthForm({
  onSubmit,
  children,
}: {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {children}
    </form>
  );
}

/** Label over input at a fixed 6px gap. The only field shape these screens have. */
export function AuthField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <Input {...props} />
    </label>
  );
}

/**
 * Boxed error, radius matched to `.input` so it reads as part of the field
 * stack rather than a floating notice. The red utilities are the ones already
 * in use on the guest form; no brand token covers a validation state.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
    >
      {children}
    </div>
  );
}

/**
 * Full-width primary submit. `w-full` is explicit rather than relying on the
 * flex column's default cross-axis stretch, which is what the merchant button
 * was doing — invisible, and it breaks the moment the form stops being a
 * flex column.
 */
export function AuthSubmit({
  disabled,
  children,
}: {
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button type="submit" variant="primary" disabled={disabled} className="w-full">
      {children}
    </Button>
  );
}
