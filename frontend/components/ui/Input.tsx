import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Wrapper over `.input` from app/globals.css. It adds no styling of its own:
 * border, radius, padding, text size, placeholder colour and the focus ring all
 * still come from the global class.
 *
 * No padding prop. The only spacing callers append today is `mt-1.5`, at 19 of
 * 27 sites, and that is the gap between a label and its input rather than a
 * property of the input itself. It belongs in a Field wrapper, which is the
 * next primitive to build and is deliberately not built here.
 */
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn("input", className)} {...props} />;
});
