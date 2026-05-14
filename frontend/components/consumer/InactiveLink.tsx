export function InactiveLink({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="mt-12 rounded-md border border-surface-border bg-white p-6 text-center">
      <h2 className="text-[16px] font-medium text-ink">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{body}</p>
    </section>
  );
}
