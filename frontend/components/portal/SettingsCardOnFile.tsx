"use client";

import { useRouter } from "next/navigation";
import { UpdateCardSection } from "./UpdateCardSection";

// Client wrapper so Settings (a server component) can mount the existing
// UpdateCardSection and refresh after a card swap.
export function SettingsCardOnFile({
  token,
  card,
  stripeConfigured,
  stripePublishableKey,
}: {
  token: string;
  card: { brand: string; lastFour: string; expMonth: number; expYear: number } | null;
  stripeConfigured: boolean;
  stripePublishableKey: string | null;
}) {
  const router = useRouter();
  return (
    <div>
      {card ? (
        <div className="text-sm">
          <div className="text-lg font-semibold text-brand-navy">
            {brandLabel(card.brand)} •••• {card.lastFour}
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            Expires {String(card.expMonth).padStart(2, "0")}/
            {String(card.expYear).slice(-2)}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">No card on file.</p>
      )}
      <div className="mt-4">
        <UpdateCardSection
          token={token}
          stripeConfigured={stripeConfigured}
          stripePublishableKey={stripePublishableKey}
          onReplaced={() => router.refresh()}
        />
      </div>
    </div>
  );
}

function brandLabel(brand: string): string {
  switch (brand.toLowerCase()) {
    case "visa":
      return "Visa";
    case "mastercard":
      return "Mastercard";
    case "amex":
    case "american_express":
      return "Amex";
    case "discover":
      return "Discover";
    default:
      return brand.charAt(0).toUpperCase() + brand.slice(1);
  }
}
