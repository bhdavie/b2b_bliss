import {
  formatDollarsCompact,
  formatScheduleDateLong,
} from "@/lib/publicApi";

/**
 * Read-only booking summary card on the customer-initiated checkout
 * page. Same visual pattern as the merchant-link flow's ServiceCard but
 * surfaces multi-day stays (checkin + checkout) and the optional free-
 * text description from the merchant's checkout URL.
 */
export function CheckoutSummaryCard({
  cart,
}: {
  cart: {
    totalCents: number;
    checkin: string;
    checkout: string | null;
    description: string | null;
    name: string | null;
  };
}) {
  return (
    <section className="mt-5 rounded-md bg-cream-dark p-4">
      <div className="text-[14px] font-medium text-ink">
        {cart.description ?? "Your booking"}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-muted">
        {cart.checkout
          ? `${formatScheduleDateLong(cart.checkin)} → ${formatScheduleDateLong(cart.checkout)}`
          : formatScheduleDateLong(cart.checkin)}
      </div>
      {cart.name ? (
        <div className="mt-2 text-[12px] text-ink-muted">For {cart.name}</div>
      ) : null}
      <div className="mt-5 flex items-baseline justify-between">
        <div className="text-[12px] text-ink-muted">Total</div>
        <div className="text-[24px] font-medium leading-none text-ink">
          {formatDollarsCompact(cart.totalCents)}
        </div>
      </div>
    </section>
  );
}
