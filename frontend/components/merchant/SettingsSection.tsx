// Settings-page section: a two-column row (title + helper on the left, content
// on the right) separated from the previous section by a hairline divider. No
// card boxes — hierarchy comes from the divider, whitespace, and type. Shared by
// Account settings and Payment settings so the merchant area reads as one
// designed surface.
export function SettingsSection({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-x-12 gap-y-5 border-t border-brand-neutral py-10 md:grid-cols-[minmax(0,240px)_1fr]">
      <div>
        <h2 className="text-lg font-semibold text-brand-navy">{title}</h2>
        {helper ? (
          <p className="mt-1.5 text-sm leading-relaxed text-brand-navy/55">{helper}</p>
        ) : null}
      </div>
      <div className="max-w-xl">{children}</div>
    </section>
  );
}
