import type { PublicBooking } from "@/lib/publicApi";

export function MerchantBlock({
  merchant,
}: {
  merchant: PublicBooking["merchant"];
}) {
  const initials = computeInitials(merchant.businessName);

  return (
    <section className="flex items-center gap-3">
      <div
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-brand-lavender text-[13px] font-medium text-white"
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-ink-muted">Reserving with</div>
        <div className="truncate text-[14px] font-medium text-ink">
          {merchant.businessName}
        </div>
      </div>
    </section>
  );
}

function computeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) {
    const first = words[0] ?? "";
    return first.slice(0, 2).toUpperCase();
  }
  const first = words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}
