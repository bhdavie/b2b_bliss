/**
 * Shared page chrome for the settled design, used by the guest portal and the
 * merchant dashboard alike: no card wrappers around sections, small uppercase
 * section labels instead of large headings, sand borders and ink type.
 *
 * These sit alongside Button/Card/Input/Label rather than under either surface,
 * because turns 5, 6 and 7-13 of the design export all draw the same page head,
 * section label and panel.
 */

export function SectionHeading({
  children,
  className = "",
  track = "0.06em",
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * The export uses 0.06em on the guest screens (turns 5-6) and 0.08em on the
   * merchant ones (turns 9-13). Passed explicitly rather than overridden via
   * className, so the winner does not depend on utility emission order.
   */
  track?: "0.06em" | "0.08em";
}) {
  return (
    <div
      className={`text-[13px] uppercase text-ink-400 ${
        track === "0.08em" ? "tracking-[0.08em]" : "tracking-[0.06em]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** 44px title over an 18px subtitle. The History and Settings page heads. */
export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-12 flex flex-col gap-2.5">
      <h1 className="text-[44px] font-medium leading-[1.05] tracking-[-0.035em] text-ink-900">
        {title}
      </h1>
      <p className="text-lg text-ink-500">{subtitle}</p>
    </div>
  );
}

/**
 * 24px card title with a hairline under it, the head each Payment settings tab
 * draws inside its own card. Distinct from SectionHeading above, which is the
 * 13px uppercase eyebrow — this is the larger in-card title.
 *
 * Lifted here from PoliciesCard once PlanRulesCard and BlackoutDatesCard needed
 * the same head; the markup is unchanged from that original.
 */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="border-b border-sand-100 pb-4 text-2xl font-medium tracking-[-0.02em] text-ink-900">
      {children}
    </h3>
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
