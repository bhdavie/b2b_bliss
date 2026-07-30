import Link from "next/link";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type Ref,
} from "react";
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
 *
 * With `href`, it renders a next/link `Link` instead, carrying the identical
 * class string. That exists because several primary actions in the app are
 * navigations, not form actions, and rendering them as `<button>` would drop the
 * href along with middle-click, open-in-new-tab and prefetch. No `asChild` and
 * no `cloneElement`: the two element types are known ahead of time, so a plain
 * branch is enough and keeps the typing legible.
 *
 * A link cannot be natively disabled. The union below therefore rejects
 * `disabled` and `type` alongside `href`, so a caller cannot write a prop that
 * would silently do nothing on an anchor. Callers that need a disabled-looking
 * link express it the way the app already does, with `aria-disabled` plus
 * `pointer-events-none`.
 */
export type ButtonVariant = "primary" | "merchant" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  merchant: "btn-primary-merchant",
  ghost: "btn-ghost",
};

type NextLinkProps = ComponentPropsWithoutRef<typeof Link>;

/**
 * `href?: never` is the discriminant. It is what lets the implementation narrow
 * on `props.href !== undefined`, and it is also what stops a caller passing an
 * href while expecting button semantics.
 */
export type ButtonAsButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  href?: never;
};

export type ButtonAsLinkProps = NextLinkProps & {
  variant?: ButtonVariant;
  // Button-only attributes, closed off. `disabled` has no meaning on an anchor;
  // `type` exists in AnchorHTMLAttributes as a MIME hint and is not the button
  // `type`, so accepting it here would read as the wrong thing.
  disabled?: never;
  type?: never;
};

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

export const Button = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(function Button(props, ref) {
  const classes = cn(VARIANT_CLASS[props.variant ?? "merchant"], props.className);

  if (props.href !== undefined) {
    const { variant: _variant, className: _className, ...linkProps } = props;
    return (
      <Link
        ref={ref as Ref<HTMLAnchorElement>}
        className={classes}
        {...linkProps}
      />
    );
  }

  // `type` is intentionally not defaulted. Leaving it unset preserves the
  // native default, which is what an untyped <button> does today; defaulting
  // it to "button" would silently stop submitting the forms that rely on it.
  const {
    variant: _variant,
    className: _className,
    href: _href,
    ...buttonProps
  } = props;
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      className={classes}
      {...buttonProps}
    />
  );
});
