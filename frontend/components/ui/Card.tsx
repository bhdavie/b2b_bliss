import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Wrapper over `.card` and `.card-subtle` from app/globals.css. It adds no
 * styling of its own beyond the padding tier selected below.
 *
 * `.card` sets no padding, so 18 of the 20 call sites in the app append their
 * own, in five different values. The `padding` prop names those five tiers so a
 * later density change happens here instead of across twenty files. The tiers
 * map one to one onto the values already in use; none were collapsed, renamed
 * or reinterpreted, and no new value was introduced.
 *
 * Default is "none", so a <Card> with no padding prop renders exactly what a
 * bare `className="card"` renders today.
 *
 * Note on the subtle variant: `.card-subtle` already includes `p-4` of its own.
 * Passing a padding tier alongside it will win, because caller utilities are
 * emitted after `@layer components`. Leave padding at "none" to keep the
 * variant's built-in spacing.
 */
export type CardVariant = "default" | "subtle";
export type CardPadding = "none" | "sm" | "md" | "lg" | "xl" | "2xl";

const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "card",
  subtle: "card-subtle",
};

// Written as complete literals so Tailwind's content scanner sees them. Do not
// build these strings dynamically.
const PADDING_CLASS: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
  xl: "p-8",
  "2xl": "p-10",
};

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  padding?: CardPadding;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", padding = "none", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(VARIANT_CLASS[variant], PADDING_CLASS[padding], className)}
      {...props}
    />
  );
});
