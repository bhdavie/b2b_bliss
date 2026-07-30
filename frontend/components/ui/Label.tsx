import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Wrapper over `.label` from app/globals.css, which is `text-xs text-ink-muted`
 * and nothing else. It adds no styling of its own.
 *
 * `htmlFor` comes from the standard label attributes and is passed straight
 * through, so the existing label-to-control association is unchanged.
 */
export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref,
) {
  return <label ref={ref} className={cn("label", className)} {...props} />;
});
