import { palette } from "@/tailwind.config";

/**
 * Colours for the Stripe Elements card iframe.
 *
 * Stripe renders the card field in a cross-origin iframe, so it cannot see our
 * stylesheet and cannot be styled with a utility class. It takes literal colour
 * strings in a JS options object instead. That used to mean four hex values sat
 * inline in StripeCardSection, invisible to any search of the token system and
 * easy to miss in a palette change.
 *
 * These read from `palette` in tailwind.config.ts, so the iframe and the rest
 * of the app move together and a swap has one file to edit.
 */
export const STRIPE_ELEMENT_COLORS = {
  /** Card number, expiry and CVC as typed. Matches body text. */
  text: palette.ink.DEFAULT,
  /** Placeholder text in the empty field. */
  placeholder: palette.ink.muted,
  /** The card-brand and error glyphs Stripe draws inside the field. */
  icon: palette.brand.navy,
  /** Text and icon once Stripe marks the input invalid. */
  invalid: palette.danger,
} as const;
