"use client";

import { useRouter } from "next/navigation";
import { UpdateCardSection } from "./UpdateCardSection";

// Client wrapper so Settings (a server component) can mount the existing
// UpdateCardSection and refresh after a card swap. Built to the settled design
// (turn 6b): brand chip, 22px card line, rule, then a full-width outline pill.
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
    <>
      {card ? (
        <div className="mb-[26px] flex items-center gap-4">
          <div className="h-8 w-12 flex-none rounded-sm bg-ink-900" />
          <div className="flex flex-col gap-[5px]">
            <div className="text-[22px] font-medium tracking-[-0.015em] text-ink-900">
              {brandLabel(card.brand)} ···· {card.lastFour}
            </div>
            <div className="text-base text-ink-400">
              Expires {String(card.expMonth).padStart(2, "0")}/
              {String(card.expYear).slice(-2)}
            </div>
          </div>
        </div>
      ) : (
        // Not drawn in the export; kept on the same rhythm as the populated row.
        <p className="mb-[26px] text-[17px] text-ink-500">No card on file.</p>
      )}
      <div className="mb-[26px] h-px bg-sand-200" />
      <UpdateCardSection
        token={token}
        stripeConfigured={stripeConfigured}
        stripePublishableKey={stripePublishableKey}
        onReplaced={() => router.refresh()}
        variant="block"
      />
    </>
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
