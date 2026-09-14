"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { referralStatusLabel } from "@/components/admin/ReferralStatusPill";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { patchAdminReferral, type AdminReferralStatus } from "@/lib/api";

export type LinkableMerchant = { id: string; name: string; slug: string };

/** How many matches the picker lists at once. The rest are one keystroke away. */
const MAX_MATCHES = 8;

/**
 * Moves a referral along its ladder, modeled on FeeRateForm.
 *
 * The options come from the backend's allowedNextStatuses; this component does
 * not know the ladder. The merchant picker is optional except when moving to
 * live, where a referral without the property it became is a dead end for the
 * credit later. A referral that is already linked counts as having one.
 *
 * `merchants` arrives already stripped of demo accounts by the page. The
 * backend refuses a demo merchant regardless.
 */
export function ReferralStatusForm({
  referralId,
  allowedNextStatuses,
  currentMerchantId,
  merchants,
}: {
  referralId: string;
  allowedNextStatuses: AdminReferralStatus[];
  currentMerchantId: string | null;
  merchants: LinkableMerchant[];
}) {
  const router = useRouter();
  const [next, setNext] = useState<AdminReferralStatus | "">(
    allowedNextStatuses[0] ?? "",
  );
  const [merchantId, setMerchantId] = useState<string | null>(currentMerchantId);
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = merchants.find((m) => m.id === merchantId) ?? null;
  const merchantRequired = next === "live";

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return merchants
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q),
      )
      .slice(0, MAX_MATCHES);
  }, [merchants, search]);

  if (allowedNextStatuses.length === 0) {
    return (
      <p className="text-[14px] text-ink-500">
        This referral is final. There are no further moves.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!next) {
      setError("Pick a status to move to.");
      return;
    }
    if (merchantRequired && !merchantId) {
      setError("Pick the property this hotel became before marking it live.");
      return;
    }
    setSubmitting(true);
    try {
      await patchAdminReferral(referralId, {
        status: next,
        // Only send a link that changes something. The backend keeps an
        // existing link when merchantId is absent.
        merchantId: merchantId && merchantId !== currentMerchantId ? merchantId : null,
      });
      setSearch("");
      // Re-fetch the server components so the status, the allowed moves and
      // the linked property all reflect the write.
      router.refresh();
    } catch (err) {
      setError(messageFor(err instanceof Error ? err.message : "unknown"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 sm:max-w-[320px]">
        <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
          Move to
        </span>
        <select
          value={next}
          onChange={(e) => setNext(e.target.value as AdminReferralStatus)}
          className="rounded-xl border border-sand-500 bg-white px-[18px] py-4 text-[14px] text-ink-900 focus:border-brand-violet focus:outline-none focus:shadow-focus-ring"
        >
          {allowedNextStatuses.map((s) => (
            <option key={s} value={s}>
              {referralStatusLabel(s)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
          Property {merchantRequired ? "(required for live)" : "(optional)"}
        </span>

        <p className="text-[14px] text-ink-900">
          {selected ? (
            <>
              {selected.name}{" "}
              <span className="text-[13px] text-ink-500">{selected.slug}</span>
              {selected.id !== currentMerchantId ? (
                <button
                  type="button"
                  onClick={() => setMerchantId(currentMerchantId)}
                  className="ml-3 text-[13px] text-brand-violet hover:underline"
                >
                  Clear
                </button>
              ) : null}
            </>
          ) : (
            <span className="text-ink-500">No property linked.</span>
          )}
        </p>

        <div className="sm:max-w-[480px]">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search properties by name"
            aria-label="Search properties by name"
          />
        </div>

        {search.trim() ? (
          matches.length === 0 ? (
            <p className="text-[13px] text-ink-500">No properties match.</p>
          ) : (
            <ul className="flex flex-col sm:max-w-[480px]">
              {matches.map((m) => {
                const isSelected = m.id === merchantId;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setMerchantId(m.id);
                        setSearch("");
                      }}
                      aria-pressed={isSelected}
                      className={`flex w-full items-baseline justify-between gap-4 border-b border-sand-100 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-sand-50 ${
                        isSelected ? "bg-brand-violet-tint" : ""
                      }`}
                    >
                      <span className="truncate text-[14px] text-ink-900">
                        {m.name}
                      </span>
                      <span className="truncate text-[13px] text-ink-500">
                        {m.slug}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>

      {error ? (
        <p className="text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Saving" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The backend's error keys in plain words. Anything unrecognised shows the key
 * itself, as FeeRateForm does, so an unmapped case is diagnosable from the
 * screen.
 */
function messageFor(key: string): string {
  switch (key) {
    case "invalid_transition":
      return "That move is not allowed from this status. Refresh to see where it stands now.";
    case "invalid_merchant":
      return "That property cannot be linked. It may be a demo account or no longer exist.";
    case "invalid_status":
    case "status_required":
      return "Pick a status to move to.";
    case "referral_not_found":
      return "This referral no longer exists.";
    default:
      return `Could not save (${key}).`;
  }
}
