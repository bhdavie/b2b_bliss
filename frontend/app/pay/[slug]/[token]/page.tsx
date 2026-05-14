type Params = {
  slug: string;
  token: string;
};

export default async function HostedPaymentPlanPage(props: {
  params: Promise<Params>;
}) {
  const { slug, token } = await props.params;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 360, textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.5px" }}>
          bliss
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 500, marginTop: 24 }}>
          Payment plan page
        </h1>
        <p style={{ color: "var(--color-text-secondary)", marginTop: 8 }}>
          Built out in Phase 4 per docs/hosted-page-spec.md.
        </p>
        <pre
          style={{
            marginTop: 16,
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            background: "var(--color-background-secondary)",
            padding: 12,
            borderRadius: "var(--border-radius-md)",
            textAlign: "left",
            overflow: "auto",
          }}
        >
          {JSON.stringify({ slug, token }, null, 2)}
        </pre>
      </div>
    </main>
  );
}
