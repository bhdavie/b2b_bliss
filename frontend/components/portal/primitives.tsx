/**
 * Shared chrome for the guest portal screens, matching the treatment landed on
 * the plan detail screen: no card wrappers around sections, small uppercase
 * section labels instead of large headings, sand borders and ink type.
 *
 * PlanPortal.tsx still carries its own private copy of SectionHeading. Folding
 * that one into this file is a follow-up: it needs an edit to PlanPortal, which
 * was out of scope for the screens this file was created for.
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
      className={`text-[13px] uppercase tracking-[0.06em] text-ink-400 ${className}`}
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

/** The bordered, 20px-radius panel used for cards on both screens. */
export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col rounded-panel border border-sand-200 ${className}`}
    >
      {children}
    </div>
  );
}
