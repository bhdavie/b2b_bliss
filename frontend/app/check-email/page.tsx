import { BlissWordmark } from "@/components/BlissWordmark";
import { Card } from "@/components/ui/Card";

type SearchParams = { email?: string };

export default async function CheckEmailPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await props.searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 font-body">
      <div className="w-full max-w-sm text-center">
        <BlissWordmark className="text-xl tracking-tight text-brand-violet" />
        <h1 className="mt-6 text-lg font-medium">Check your email</h1>
        <p className="mt-2 text-ink-500">
          We sent a sign-in link to{" "}
          <span className="text-ink-900 font-medium">{email ?? "your inbox"}</span>.
          It expires in 15 minutes.
        </p>
        <Card variant="subtle" className="mt-6 text-left">
          <div className="label">Local dev tip</div>
          <p className="mt-1 text-xs text-ink-500">
            Magic links are written to the backend log. Look for a line tagged{" "}
            <span className="font-mono">[email→...]</span> in your{" "}
            <span className="font-mono">mvn exec:java</span> output.
          </p>
        </Card>
      </div>
    </main>
  );
}
