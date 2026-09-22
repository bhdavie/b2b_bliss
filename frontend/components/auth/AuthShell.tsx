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
 * Six screens render through it today: the property sign-in (/login), the
 * guest sign-in (/account/login), the admin sign-in, /account/verify and
 * /account/check-email. subhead, children and footer are all optional because
 * verify and check-email have a heading and no form. Signup is still on its own
 * older chrome and its two-panel plan preview; it is the one left to move.
 *
 * `hero` picks the backdrop. The two sign-ins named in the photo move pass
 * "property" and "guest" and get the marketing site's photographs full-bleed;
 * everything else takes the default and renders the illustration exactly as it
 * did before. See the two blocks of constants below.
 */

// ILLUSTRATION VARIANT (the default). The marketing site's check-in
// illustration, copied into public/ from bliss_b2b_website/public/
// stats-checkin-v2.webp — the artwork behind that site's stats band. 3840x2143,
// aspect 1.79.
//
// The composition is what the illustration layout is built around: the left
// ~half is an empty cream wall with a palm and a chair, and the front desk sits
// in the right half. So the card parks on the left over the empty side, the
// fade in globals.css flattens that side to cream, and the desk resolves out of
// the fade on the right.
//
// Still the default because three screens beyond the two sign-ins render
// through this shell — the admin sign-in, /account/verify and
// /account/check-email — and none of them were in scope for the photo move.
// They render exactly what they rendered before. If they should follow, pass
// them a `hero` and this constant, the fade in globals.css and the asset all go.
const HERO_SRC = "/auth-hero-checkin.webp";

// The ground the artwork fades into. Tracks the marketing site's cool neutral
// ground (#F4F5F7 on .hero and .stats), not the Bliss app token, and stays a
// raw hex for that reason: the fade only reads as continuous if the colour on
// this side matches the colour the site was repainted to. It happens to be the
// same value as sand-100 right now, so the two are visually indistinguishable,
// but they are still separate decisions and the site is the one this follows.
// If the site moves again, this moves with it and sand-100 does not.
// Illustration variant only: the photo variants sit on white.
const HERO_CREAM = "#F4F5F7";

// PHOTO VARIANTS. The marketing site's two hero photographs at the same three
// widths it serves, copied into public/ with their names unchanged so a
// re-export there lands here as a straight file copy. Not regenerated.
//
// Which photo goes to which screen follows the site's own split: property
// sign-in takes the /hotels hero (brass bell, ledger and key on white marble),
// guest sign-in takes the guest hero (breakfast tray and ribbon on white
// linen).
//
// object-position: right bottom for the same reason the site anchors them
// there — the subject sits in the bottom-right of a 1.79 frame, so that corner
// survives whichever way `cover` crops: viewports narrower than 1.79 crop off
// the left, wider ones off the top.
const PHOTO_HEROES = {
  property: {
    src: "/hotels-hero.webp",
    srcSet:
      "/hotels-hero@1600.webp 1600w, /hotels-hero.webp 2400w, /hotels-hero@3840.webp 3840w",
  },
  guest: {
    src: "/guest-hero.webp",
    srcSet:
      "/guest-hero@1600.webp 1600w, /guest-hero.webp 2400w, /guest-hero@3840.webp 3840w",
  },
} as const;

/** Which backdrop a screen renders behind the card. */
export type AuthHero = keyof typeof PHOTO_HEROES | "illustration";

// The grey fade for the PHOTO variants. Same device as the illustration's
// .auth-hero-fade and the same #F4F5F7, re-cut for these two frames: the class
// in globals.css is tuned to the illustration (solid to 42%, clear by 72%) and
// belongs to it, and on a photograph a ramp running to 72% greys out half the
// picture. The element below still carries .auth-hero-fade, so the lineage is
// one name in the DOM and the class stays the fallback; this overrides only the
// stop geometry. The tidier home for it is globals.css the day that file is in
// scope.
//
// STOPS IN PIXELS, not percentages, because the thing the solid zone has to
// cover is a fixed-px box: the card is 576px wide at a 89px offset, so its
// right edge is at 665px at EVERY desktop width. Percentage stops would track
// the viewport instead and leave the card's right edge sitting mid-ramp at
// 1280 while over-covering at 1920. 677px is the card's edge plus 12px.
//
// WHERE IT LANDS AT 1440x900. Both photographs are 1.79 frames covering a 1.6
// viewport, so `cover` scales to height and crops ~171px off the left:
//  - guest: the ribbon's leftmost sweep is at 50.2% of the frame, which lands
//    at 638px. That is BEHIND the card (89-665px), so the ribbon is first
//    visible at the card's edge and the ramp's 65px is what touches it. The
//    tray and cups sit past 1150px, untouched.
//  - property: the leftmost object in the marble frame is the dark card at
//    56.8% of the frame, landing at 744px. The ramp is clear at 742px, so it
//    stops 2px short of it. The bell, ledger and key are further right again.
// The ramp is 65px where the illustration's is 432px, which is the "shorten the
// ramp" trade: it has to end before those props. Five eased stops rather than a
// straight line because what reads as a band is the sudden change in SLOPE
// where a linear ramp meets zero, not the ramp itself.
const PHOTO_FADE =
  "linear-gradient(to right," +
  " #F4F5F7 0px," +
  " #F4F5F7 677px," +
  " rgba(244, 245, 247, 0.82) 694px," +
  " rgba(244, 245, 247, 0.55) 710px," +
  " rgba(244, 245, 247, 0.28) 724px," +
  " rgba(244, 245, 247, 0.09) 734px," +
  " rgba(244, 245, 247, 0) 742px)";

// The desktop size bump, photo variants only. The card goes from max-w-md to
// max-w-xl there, which is 128px of extra width, and type left at the small
// card's sizes would read as small content in a big box. Every one of these is
// one step up from what the card carries, all behind `lg:` so the phone card is
// untouched, and they are complete literals so Tailwind's scanner sees them.
//   padding  p-8 (32px)             -> p-10 (40px), the Card component's next tier
//   wordmark text-2xl (24px)        -> text-3xl (30px)
//   heading  32px/1.15              -> 38px/1.12
//   inputs   16px, 17/15px padding  -> 18px, 21/19px padding
// The inputs are reached through `.input` rather than by threading a size prop
// down through AuthField: that component is shared with the admin sign-in and
// the verify screens, which keep the small card, so the bump has to be scoped
// to this card rather than to the field.
const BIG_CARD =
  "lg:p-10 lg:[&_.input]:px-[21px] lg:[&_.input]:py-[19px] lg:[&_.input]:text-lg";
const BIG_WORDMARK = "lg:text-3xl";
const BIG_HEADING = "lg:text-[38px] lg:leading-[1.12]";

export function AuthShell({
  heading,
  subhead,
  hero = "illustration",
  children,
  footer,
}: {
  heading: string;
  subhead?: string;
  /** Defaults to the illustration, which is what every screen not named in the photo move still renders. */
  hero?: AuthHero;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const photo = hero === "illustration" ? null : PHOTO_HEROES[hero];
  // Only the photo variants grow. The illustration screens keep the card
  // they have: their fade is cut to a max-w-md card's right edge.
  const big = photo !== null;

  // Identical in both variants, so the card cannot drift between them.
  const card = (
    // `.card` is rounded-panel + sand-200 border + white fill, and carries no
    // shadow of its own.
    // On the illustration that is not enough: the fade puts the card on flat
    // #F4F5F7, where white sits at roughly a 1.09:1 step and would read as a
    // pale smudge rather than a raised surface.
    // On the photographs it is not enough either, and for the opposite reason —
    // both are bright, near-white surfaces (marble, linen), so the card's white
    // fill has even less to separate it from its ground. The brief allows a
    // veil here and it is not needed: shadow-elevated-lg plus `.card`'s own
    // sand-200 edge, both existing tokens, do the separating. Darkening the
    // photograph to rescue the card would cost the screen the brand read the
    // photograph is here for.
    <Card
      padding="xl"
      className={big ? `shadow-elevated-lg ${BIG_CARD}` : "shadow-elevated-lg"}
    >
      {/* Wordmark sits INSIDE the card, above the heading, left aligned to it so
          the two read as one lockup. It stays Georgia bold via BlissWordmark's
          inline style — the one thing here that is not Inter. It is `block` so
          the heading's own top margin is the only thing setting the gap. */}
      <BlissWordmark
        className={
          big
            ? `block text-2xl text-brand-violet ${BIG_WORDMARK}`
            : "block text-2xl text-brand-violet"
        }
      />

      <h1
        className={
          big
            ? `mt-5 font-display text-[32px] leading-[1.15] tracking-[-0.01em] text-ink-900 ${BIG_HEADING}`
            : "mt-5 font-display text-[32px] leading-[1.15] tracking-[-0.01em] text-ink-900"
        }
      >
        {heading}
      </h1>

      {subhead ? <p className="mt-2 text-sm text-ink-500">{subhead}</p> : null}

      {children ? <div className="mt-7">{children}</div> : null}

      {footer ? (
        <p className="mt-6 text-center text-xs text-ink-400">{footer}</p>
      ) : null}
    </Card>
  );

  if (photo) {
    return (
      // Two layouts in one element, split at lg, which is where this shell
      // already moved the card and so stays the screen's only breakpoint:
      //  - below lg it is a plain column, card first and the photograph as a
      //    320px band under it. This is the marketing heroes' mobile treatment,
      //    where the background stops being a background and becomes a band
      //    (.g-hero at max-width: 860px). No vertical centring: the card sits
      //    under its top padding and the band follows, so nothing can overflow
      //    off the top of a short viewport.
      //  - at lg the photograph becomes an absolute full-bleed layer and the
      //    card is the only thing left in flow, vertically centred against the
      //    viewport and anchored left on the marketing text column's line.
      // `relative isolate` is required, not decorative: it opens the stacking
      // context the layers below resolve against. Ground is white, not the
      // illustration's cream — both photographs are white-linen scenes.
      <main className="relative isolate flex min-h-screen flex-col bg-white font-inter lg:flex-row lg:items-center lg:justify-start">
        {/* React hoists this into <head>. It is the same preload the marketing
            site emits for these files, and unconditional for the same reason:
            the photograph is on screen at every width, as the background above
            lg and as the band below it, so it is never a wasted fetch. */}
        <link
          rel="preload"
          as="image"
          fetchPriority="high"
          imageSrcSet={photo.srcSet}
          imageSizes="100vw"
        />

        {/* Layer 0 — the photograph.
            A plain <img> rather than next/image, the same call the marketing
            site documents on its own heroes: next/image would regenerate its
            own srcset at Next's device widths and discard the three widths
            these files were cut at. The preload above and fetchPriority give it
            the loading priority that rule exists to protect.
            alt="" because it is decoration — the screen's meaning is entirely
            in the card, and announcing the photograph would only add noise. */}
        <div className="order-2 h-80 w-full shrink-0 overflow-hidden lg:absolute lg:inset-0 lg:z-0 lg:order-none lg:h-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- see above. */}
          <img
            className="block h-full w-full object-cover object-right-bottom"
            src={photo.src}
            srcSet={photo.srcSet}
            sizes="100vw"
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        </div>

        {/* Layer 10 — the grey fade, over the photograph and under the card.
            Desktop only, the same line the illustration variant draws: below lg
            the photograph is a band UNDER the card rather than behind it, so a
            left-hand fade would have nothing to do. `hidden lg:block` rather
            than leaning on the class's own media query, because the stops
            below are an inline style and inline styles answer to no breakpoint.
            pointer-events-none is load-bearing, not tidiness: this div spans
            the viewport, so without it the half of it that overlaps the card
            would swallow clicks meant for the fields underneath. */}
        <div
          aria-hidden
          style={{ backgroundImage: PHOTO_FADE }}
          className="auth-hero-fade pointer-events-none absolute inset-0 z-10 hidden lg:block"
        />

        {/* Layer 20 — the card. `lg:relative` is what makes the z-index apply,
            so the photograph can never outrank it whichever utilities survive.
            Size and content are untouched: w-full max-w-md, as before.
            Below lg: centred in its gutters, and pb-11 is the 44px the
            marketing heroes leave between the copy and the band.
            lg:ml-[89px] is the marketing hero's text column: the nav card's
            content edge, --nav-inset-x (64px) plus its 1px border and 24px
            padding. The site derives it as --g-edge on .g-hero; there is no nav
            card on this screen to derive it from, so it is written out. The
            card's left edge lands on the marketing headline's line.
            A MARGIN, not the padding this started as. Tailwind's preflight puts
            every box on border-box, so an 89px padding-left came out of the
            max-width rather than sitting beside it: the desktop card measured
            max-w-md minus 89 = 359px, narrower than the same card on a phone.
            As a margin the offset sits outside the box and max-w-xl is the
            card's real width, 576px, with its right edge at 665px — which is
            the number the fade's solid zone is cut to. */}
        <div className="order-1 mx-auto w-full max-w-md px-6 pb-11 pt-16 lg:relative lg:z-20 lg:order-none lg:mx-0 lg:ml-[89px] lg:max-w-xl lg:px-0 lg:py-16">
          {card}
        </div>
      </main>
    );
  }

  return (
    // `relative isolate` is required, not decorative: the artwork below is
    // absolutely positioned, and `isolate` opens a stacking context so the
    // layers resolve against this <main> rather than escaping behind the page.
    //
    // Horizontal placement is the one thing that changes at the breakpoint:
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
      <div className="relative z-20 w-full max-w-md">{card}</div>
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
