// The Bliss wordmark. Single source of truth for the logo treatment: ALWAYS
// Georgia, bold, everywhere the "Bliss" wordmark appears. Route every wordmark
// through this component so the treatment can't drift.
//
// Pass size / color / tracking via className. The font-family and weight are
// fixed here via inline style, so they win over any Tailwind font class and
// stay consistent no matter the surrounding context.
export function BlissWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={className}
      style={{ fontFamily: "Georgia, serif", fontWeight: 700 }}
    >
      Bliss
    </span>
  );
}
