import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Wrapper over the three button classes already defined in app/globals.css.
 * It adds no styling of its own: every visual property, including the hover and
 * disabled states, still comes from the global class.
 *
 * `disabled` is the native attribute, passed straight through. Both primaries
 * already carry a `:disabled` rule (`opacity-60 cursor-not-allowed`), so the
 * state needs no prop and no extra class.
 *
 * Deliberately absent: no `loading` prop and no spinner, because the codebase
 * expresses loading purely as a label swap plus `disabled` today, and no
 * `danger` variant, because no destructive button style exists. Adding either
 * would invent a visual state.
 *
 * Known inconsistency, mirrored rather than fixed: `.btn-ghost` has no
 * `:disabled` rule, so a disabled ghost button renders at full opacity with a
 * normal cursor. That matches today's behaviour exactly.
 */
export type ButtonVariant = "primary" | "merchant" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  merchant: "btn-primary-merchant",
  ghost: "btn-ghost",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "merchant", className, ...props }, ref) {
    // `type` is intentionally not defaulted. Leaving it unset preserves the
    // native default, which is what an untyped <button> does today; defaulting
    // it to "button" would silently stop submitting the forms that rely on it.
    return (
      <button
        ref={ref}
        className={cn(VARIANT_CLASS[variant], className)}
        {...props}
      />
    );
  },
);
