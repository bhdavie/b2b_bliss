import type { PublicBooking } from "@/lib/publicApi";

export function MerchantBlock({
  merchant,
}: {
  merchant: PublicBooking["merchant"];
}) {
  const name = merchant.businessName?.trim() || FALLBACK_NAME;
  const initials = computeInitials(merchant.businessName);

  return (
    <section className="flex items-center gap-3">
      <div
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-none bg-brand-lavender text-[13px] font-medium text-white"
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-brand-navy/60">Reserving with</div>
        <div className="truncate text-[14px] font-medium text-brand-navy">
          {name}
        </div>
      </div>
    </section>
  );
}

// merchants.business_name is nullable and stays null until a property fills in
// its profile, so a freshly created account reaches here with no name even
// though the API types it as a string.
const FALLBACK_NAME = "your host";

function computeInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const first = words[0] ?? "";
    return first.slice(0, 2).toUpperCase();
  }
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}
