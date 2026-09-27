export function InactiveLink({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="mt-12 rounded-md border border-sand-200 bg-white p-6 text-center">
      <h2 className="font-display text-[26px] font-normal leading-tight text-ink-900">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{body}</p>
    </section>
  );
}
