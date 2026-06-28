import { BlissWordmark } from "@/components/BlissWordmark";

type SearchParams = { email?: string };

export default async function CheckEmailPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await props.searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 font-body">
      <div className="w-full max-w-sm text-center">
        <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
        <h1 className="mt-6 text-lg font-medium">Check your email</h1>
        <p className="mt-2 text-ink-muted">
          We sent a sign-in link to{" "}
          <span className="text-ink font-medium">{email ?? "your inbox"}</span>.
          It expires in 15 minutes.
        </p>
        <div className="mt-6 card-subtle text-left">
          <div className="text-xs text-ink-muted">Local dev tip</div>
          <p className="mt-1 text-xs text-ink-muted">
            Magic links are written to the backend log. Look for a line tagged{" "}
            <span className="font-mono">[email→...]</span> in your{" "}
            <span className="font-mono">mvn exec:java</span> output.
          </p>
        </div>
      </div>
    </main>
  );
}
