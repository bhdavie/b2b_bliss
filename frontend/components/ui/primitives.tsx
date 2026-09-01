/**
 * Shared page chrome for the merchant app and the guest portal.
 *
 * The rule these now enforce: nothing sits loose on the sand page ground.
 * Every heading, label and block of content in both surfaces lives inside a
 * white card. The sidebar, the onboarding funnel (which has no sidebar) and the
 * auth screens are the only things outside one.
 *
 * That leaves exactly two exports here, and each has a single job:
 *  - SectionHeading — THE in-card heading. One treatment for the whole app.
 *  - PageHeader — a 44px page title, now used ONLY by the onboarding funnel.
 *
 * Two former exports are gone rather than left to compete with SectionHeading:
 * SectionTitle (24px + hairline, the /settings cards) and PageLead (the
 * orienting line that /install and /account/history floated above their first
 * card). Their content did not disappear; it moved inside the card it was
 * describing. See the notes on each remaining export.
 */

export function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[13px] uppercase tracking-[0.08em] text-ink-400 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * 44px title over an 18px subtitle.
 *
 * No route inside the merchant app or the guest portal uses this any more, and
 * none should: a page title on either surface goes inside a card, on
 * SectionHeading. /plan/[token] was the last holdout and gave it up too.
 *
 * What keeps this alive is the onboarding funnel — /onboarding, /onboarding/pms
 * and /onboarding/plan-rules. The funnel has no sidebar and no cards; it is a
 * centred column with a wordmark and a step head, so it is exempt from the
 * card rule and it is the one place a 44px title still does a job. Do not
 * reintroduce it behind the sidebar.
 */
export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-12 flex flex-col gap-2.5">
      {/* Title takes the marketing site's hero-headline face: DM Serif Display
          (`font-display`), already loaded in app/layout.tsx under --font-display
          and already the face AuthShell's heading uses.
          font-normal, NOT font-medium: DM Serif Display ships a single 400
          weight, so asking for 500 makes the browser synthesize a bold. The
          marketing site hits the same problem — its .hero h1 declares
          font-weight: 700, and the later serif rule resets it to 400 with the
          comment "avoids synthetic bold". This is part of the face, not a
          weight change of its own.
          Size, leading and tracking are untouched, and 44px / 1.05 / -0.035em
          already matched the marketing hero's own line-height and letter
          spacing exactly.
          Subtitle deliberately left on the sans face. */}
      {/* text-brand-violet (#8B5CF6), the token rather than the hex. At 44px
          this is large text, so the amethyst clears AA at that size even though
          the palette notes it does not for body copy — which is why the
          subtitle below stays on ink-500 rather than following the title. */}
      <h1 className="font-display text-[44px] font-normal leading-[1.05] tracking-[-0.035em] text-brand-violet">
        {title}
      </h1>
      <p className="text-lg text-ink-500">{subtitle}</p>
    </div>
  );
}

/**
 * The 20px-radius panel used for cards on both screens.
 *
 * Two treatments, same radius and same no-shadow rule:
 *  - "outlined" (default) — sand-200 hairline, no fill, so the panel takes the
 *    page ground. A bordered REGION rather than a raised surface.
 *  - "filled" — white fill plus the same sand-200 hairline. The card surface.
 *
 * `filled` was sand-50 (#FDFCFB) while the app page was #FFFFFF, which put the
 * card a step DARKER than the page it sat on: cards read as recessed, and the
 * border was doing all the work of separating them because a 1.02:1 fill step
 * cannot. Now the page is sand-100 (#F6F4F1) and the fill is white, so the card
 * is the lighter surface and the fill carries the separation on its own — a
 * 1.06:1 step, small but in the direction the eye expects.
 *
 * The two variants are now genuinely different things rather than two shades of
 * the same thing, which is why `outlined` was left with no fill: on a sand-100
 * page it reads as an inset region, which is what its call sites want.
 */
export type PanelVariant = "outlined" | "filled";

const PANEL_VARIANT_CLASS: Record<PanelVariant, string> = {
  outlined: "border border-sand-200",
  filled: "border border-sand-200 bg-white",
};

export function Panel({
  children,
  className = "",
  variant = "outlined",
}: {
  children: React.ReactNode;
  className?: string;
  variant?: PanelVariant;
}) {
  return (
    <div
      className={`flex flex-col rounded-panel ${PANEL_VARIANT_CLASS[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
