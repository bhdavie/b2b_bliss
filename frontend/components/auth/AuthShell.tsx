import type { InputHTMLAttributes, ReactNode } from "react";
import Image from "next/image";
import { BlissWordmark } from "@/components/BlissWordmark";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

/**
 * The single layout for every Bliss sign-in screen. Merchant and guest sign-in
 * both render through this; the diagnostic that preceded this file found the
 * two had drifted into three different heading scales, two error treatments and
 * two column widths, so everything they can disagree about now lives here.
 * Both /login and /account/login pick up any change made in this file — there
 * is no second copy of this layout to keep in step.
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
 * next/image is safe under the same rule: it renders in either graph.
 *
 * Not yet adopted by signup, verify or check-email. Those are next, which is
 * why subhead, children and footer are all optional: verify and check-email
 * have a heading and no form, and signup wraps its own two-panel grid around a
 * column of this shape.
 */

// The marketing site's check-in illustration, copied into public/ from
// bliss_b2b_website/public/stats-checkin-v2.webp — the artwork behind that
// site's stats band, not its hero (the hero carries a different scene, guests
// arriving under a porte-cochere). 3840x2143, aspect 1.79.
//
// The composition is what the layout below is built around: the left ~half is
// an empty cream wall with a palm and a chair, and the front desk — key
// cubbies, clerk, guest with a suitcase — sits in the right half. So the card
// parks on the left over the empty side, the fade in globals.css flattens that
// side to cream, and the desk is what resolves out of the fade on the right.
const HERO_SRC = "/auth-hero-checkin.webp";

// The cream the artwork fades into. Deliberately a raw hex and deliberately
// NOT sand-100: this is the marketing site's own ground (#F7F4EF on .hero and
// .stats), and the fade only reads as continuous if the colour on this side
// matches the colour the mask was authored against. sand-100 (#F6F4F1) is
// within about one unit per channel and would look identical in isolation, but
// it would quietly make this a Bliss-app value rather than a match to the site,
// which is the thing that has to hold if either end is repainted.
const HERO_CREAM = "#F7F4EF";

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
    // `relative isolate` is required, not decorative: the artwork below is
    // absolutely positioned at -z-10, and `isolate` opens a stacking context so
    // that negative index resolves against this <main> rather than escaping
    // behind the page and disappearing under the body background.
    //
    // Horizontal placement is the whole point of the layout and is the one
    // thing that changes at the breakpoint:
    //  - below lg the card centres (justify-center) so it stays balanced on a
    //    phone or a narrow tablet, where a left-anchored card would crowd the
    //    edge and leave dead space opposite it;
    //  - at lg and up it anchors left (lg:justify-start) with a 10vw gutter,
    //    which is 144px at 1440 and scales with the viewport instead of
    //    pinning to a fixed inset.
    // `px-6` supplies the right-hand gutter at every width; lg:pl-[10vw] only
    // overrides the left, and wins because the variant emits inside a media
    // query further down the sheet.
    // The cream is set here rather than in the stylesheet because it is the
    // ground the masked artwork composites over: the fade is only a fade
    // against this exact colour, so the two belong on the same element.
    <main
      style={{ backgroundColor: HERO_CREAM }}
      className="relative isolate flex min-h-screen items-center justify-center px-6 py-16 font-inter lg:justify-start lg:pl-[10vw]"
    >
      {/* Three explicit layers: artwork (0), cream fade (10), card (20).
          Every one is a POSITIVE z-index on a positioned element, and that is
          the point. The previous version put the artwork on `-z-10` and left
          the card static, relying on paint order to keep the card in front.
          That works right up until the stylesheet does not load: next/image's
          `fill` writes `position:absolute; inset:0` as an INLINE style, so the
          artwork stays a positioned, viewport-filling layer with no CSS at all,
          while `-z-10` is a class and evaporates with the rest of the sheet.
          The image then paints over the card, which is exactly the failure this
          replaces. Ordering the layers with real z-indices, and giving the card
          a positioned context of its own, means the artwork can never outrank
          it no matter which utilities survive. */}

      {/* Layer 0 — artwork. object-cover is the background-size: cover half and
          object-center keeps the crop symmetric. At 1440x900 the height binds
          and only ~86px is trimmed from each side, so the whole desk stays in
          frame; at 768 the width overflows hard and the centre of the
          illustration is what remains behind the centred card.
          alt="" because this is decoration: the screen's meaning is entirely in
          the card, and announcing the illustration would only add noise.
          `priority` because it is unambiguously the LCP element here. */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <Image
          src={HERO_SRC}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>

      {/* Layer 10 — the cream fade, over the artwork and under the card. Now a
          real overlay rather than a mask on the image: the mask thinned the
          artwork to 8% on the left, which left the palm and chair ghosting
          through behind the card. An opaque cream gradient puts the card on
          genuinely flat colour. See globals.css for the stops.
          pointer-events-none is load-bearing, not defensive tidiness: this div
          spans the full viewport, so without it the half of it that overlaps
          the card would swallow clicks meant for the fields underneath.
          aria-hidden because it carries no meaning. */}
      <div
        aria-hidden
        className="auth-hero-fade pointer-events-none absolute inset-0 z-10"
      />

      {/* Layer 20 — the card. `relative` is what makes the z-index apply. */}
      <div className="relative z-20 w-full max-w-md">
        {/* `.card` is rounded-panel + sand-200 border + white fill. It carries
            no shadow of its own, which was right against the flat sand-100 page
            this screen used to have: white on sand-100 is a 1.17:1 step and the
            sand-200 border did the rest.
            Over the illustration neither holds, and the fade does not rescue
            it: flattening the left side to cream is what puts the card on flat
            colour, but that colour is #F7F4EF, so white sits at roughly a
            1.04:1 step against it — the card would read as a pale smudge
            rather than a
            raised surface, and the border alone cannot separate a light edge
            from a light ground. shadow-elevated-lg is what re-establishes the
            lift; it is the existing token (navy-tinted, from the same palette)
            rather than an arbitrary rgba, so it follows a palette change.
            No scrim or overlay: darkening the whole illustration to rescue the
            card would cost the artwork its brightness and the screen its brand
            read. Elevating the card is the cheaper half of the trade. */}
        <Card padding="xl" className="shadow-elevated-lg">
          {/* Wordmark now sits INSIDE the card, above the heading, and left
              aligned to it so the two read as one lockup. It stays Georgia bold
              via BlissWordmark's inline style — the one thing here that is not
              Inter. It is `block` so the heading's own top margin is the only
              thing setting the gap. */}
          <BlissWordmark className="block text-2xl text-brand-violet" />

          <h1 className="mt-5 font-display text-[32px] leading-[1.15] tracking-[-0.01em] text-ink-900">
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
