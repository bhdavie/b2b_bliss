import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ReferralStatusForm,
  type LinkableMerchant,
} from "@/components/admin/ReferralStatusForm";
import { ReferralStatusPill } from "@/components/admin/ReferralStatusPill";
import { Panel, RecordTitle, SectionHeading } from "@/components/ui/primitives";
import { fetchAdminMerchants, fetchAdminReferral } from "@/lib/auth";
import { formatDateTime, humanize, propertyName } from "@/lib/adminFormat";

export default async function AdminReferralDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, merchantRows] = await Promise.all([
    fetchAdminReferral(id),
    fetchAdminMerchants(),
  ]);
  if (!detail) notFound();

  const { referral, allowedNextStatuses } = detail;
  const allMerchants = merchantRows ?? [];

  // The linked property is looked up from the full list, demo or not, so a
  // link always has a name to show. Only the picker is restricted.
  const linked = referral.merchantId
    ? (allMerchants.find((m) => m.id === referral.merchantId) ?? null)
    : null;

  const linkable: LinkableMerchant[] = allMerchants
    .filter((m) => !m.isDemo)
    .map((m) => ({ id: m.id, name: propertyName(m), slug: m.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-3">
      {/* Card 1: the referral as submitted */}
      <Panel variant="filled" className="p-5">
        <Link
          href="/admin/referrals"
          className="mb-4 self-start text-[15px] text-brand-violet no-underline hover:underline"
        >
          ← Back to referrals
        </Link>
        <RecordTitle className="mb-1">{referral.hotelName}</RecordTitle>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-ink-500">{referral.hotelCity}</span>
          <ReferralStatusPill status={referral.status} />
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Guest name" value={referral.guestName} />
          <Field label="Guest email" value={referral.guestEmail} />
          <Field label="Hotel" value={referral.hotelName} />
          <Field label="City" value={referral.hotelCity} />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
              Linked property
            </span>
            {referral.merchantId ? (
              <Link
                href={`/admin/properties/${referral.merchantId}`}
                className="text-[14px] text-brand-violet no-underline hover:underline"
              >
                {linked ? propertyName(linked) : referral.merchantId}
              </Link>
            ) : (
              <span className="text-[14px] text-ink-900">–</span>
            )}
          </div>
          <Field label="Source" value={humanize(referral.source)} />
          <Field label="Source IP" value={referral.sourceIp} />
          <Field label="Submitted" value={formatDateTime(referral.createdAt)} />
          <Field label="Updated" value={formatDateTime(referral.updatedAt)} />
          <Field label="Note" value={referral.note} multiline />
          <Field label="Referral ID" value={referral.id} />
        </div>
      </Panel>

      {/* Card 2: moving it along */}
      <Panel variant="filled" className="p-5">
        <SectionHeading className="mb-4">Status</SectionHeading>
        <ReferralStatusForm
          // Keyed on status so a successful save, which refreshes the server
          // props, also resets the form's local selection to the new options.
          key={referral.status}
          referralId={referral.id}
          allowedNextStatuses={allowedNextStatuses}
          currentMerchantId={referral.merchantId}
          merchants={linkable}
        />
      </Panel>
    </div>
  );
}

function Field({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      <span
        className={`break-words text-[14px] text-ink-900 ${multiline ? "whitespace-pre-line" : ""}`}
      >
        {value && value.trim() ? value : "–"}
      </span>
    </div>
  );
}
