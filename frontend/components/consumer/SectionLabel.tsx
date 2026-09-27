import type { ReactNode } from "react";

/**
 * Section label on the guest checkout. Sentence case (the guest flow follows
 * the copy rule of no all-caps; the dashboard's uppercase `.label` stays a
 * dashboard convention), muted ink, medium weight.
 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-medium text-ink-500">{children}</div>;
}
