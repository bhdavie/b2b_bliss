import type { PublicBooking } from "@/lib/publicApi";

type MerchantContext = PublicBooking["merchant"];

/**
 * The property's name for use in a sentence ("Return to …", "contact …").
 * The backend already falls back to a Mews property's enterprise name, so
 * this only covers a property with no name at all.
 */
export function hostName(merchant: MerchantContext): string {
  return merchant.businessName?.trim() || "the property";
}

/**
 * Who the guest is booking with, at the top of every checkout step. The
 * property's logo when it has one, otherwise its initials on the wash. With
 * no name at all (a property that has not finished its profile) it shows a
 * neutral mark and plain wording rather than a "?" and "your host".
 */
export function MerchantBlock({ merchant }: { merchant: MerchantContext }) {
  const name = merchant.businessName?.trim() || null;

  return (
    <section className="flex items-center gap-3">
      <Mark name={name} logoUrl={merchant.logoUrl} />
      <div className="min-w-0">
        {name ? (
          <>
            <div className="text-[12px] text-ink-500">Reserving with</div>
            <div className="truncate text-[15px] font-medium text-ink-900">{name}</div>
          </>
        ) : (
          <div className="text-[15px] font-medium text-ink-900">Secure checkout for your stay</div>
        )}
      </div>
    </section>
  );
}

function Mark({ name, logoUrl }: { name: string | null; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- property-hosted image, any origin
      <img
        src={logoUrl}
        alt=""
        className="h-10 w-10 flex-none rounded-card border border-sand-200 bg-white object-contain p-1"
      />
    );
  }
  if (name) {
    return (
      <div
        className="flex h-10 w-10 flex-none items-center justify-center rounded-card bg-brand-violet-tint text-[14px] font-semibold text-brand-violet-deep"
        aria-hidden="true"
      >
        {initials(name)}
      </div>
    );
  }
  return (
    <div
      className="flex h-10 w-10 flex-none items-center justify-center rounded-card bg-sand-100 text-ink-500"
      aria-hidden="true"
    >
      <BuildingIcon />
    </div>
  );
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? "") + (words[words.length - 1]?.[0] ?? "")).toUpperCase();
}

function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11" />
      <path d="M3 21h18" />
      <path d="M8 8h3M8 12h3M8 16h3" />
    </svg>
  );
}
