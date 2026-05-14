import {
  formatDollarsCompact,
  formatScheduleDateLong,
  type PublicBooking,
} from "@/lib/publicApi";

export function ServiceCard({
  service,
}: {
  service: PublicBooking["service"];
}) {
  return (
    <section className="mt-5 rounded-md bg-cream-dark p-4">
      <div className="text-[14px] font-medium text-ink">{service.name}</div>
      <div className="mt-0.5 text-[12px] text-ink-muted">
        {formatScheduleDateLong(service.appointmentDate)}
      </div>
      <div className="mt-5 flex items-baseline justify-between">
        <div className="text-[12px] text-ink-muted">Total</div>
        <div className="text-[24px] font-medium leading-none text-ink">
          {formatDollarsCompact(service.totalAmountCents)}
        </div>
      </div>
    </section>
  );
}
