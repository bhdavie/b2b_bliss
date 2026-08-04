import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { ClearStaleSession } from "@/components/account/ClearStaleSession";
import { LoginForm } from "@/components/account/LoginForm";
import { BlissWordmark } from "@/components/BlissWordmark";

export default async function AccountLoginPage() {
  const cookieStore = await cookies();
  const hasCookie = Boolean(cookieStore.get("bliss_customer_session")?.value);

  // Cookie presence used to be enough to bounce to /account, which loops: the
  // cookie outlives the JWT it carries, so /account verifies the session,
  // fails, and redirects straight back here, which bounces again. Verify the
  // session the same way /account does and only leave when it resolves.
  let verified = false;
  if (hasCookie) {
    const cookieHeader = (await headers()).get("cookie") ?? null;
    try {
      verified = Boolean(await fetchAccountPlans(cookieHeader));
    } catch {
      // fetchAccountPlans returns null on 401 but throws on anything else. An
      // API that is down or erroring has not proven the session good, and the
      // sign-in form is the safe thing to show, so treat it as unverified
      // rather than failing the page.
      verified = false;
    }
  }

  // Kept outside the try: redirect() signals by throwing, so catching around
  // it would swallow the navigation.
  if (verified) {
    redirect("/account");
  }

  return (
    <div className="min-h-screen bg-white text-ink-900 font-body">
      {/* Present but unverifiable: drop it rather than leave a dead session in
          the browser for whatever remains of its Max-Age. */}
      {hasCookie ? <ClearStaleSession /> : null}
      <header className="border-b border-sand-200">
        <div className="mx-auto max-w-md px-6 py-6 text-center">
          <BlissWordmark className="text-2xl text-brand-violet" />
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="text-4xl font-bold tracking-tight text-ink-900">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Sign in to see your payment plans across every Bliss merchant.
        </p>
        <section className="mt-6 rounded-panel border border-sand-200 bg-white p-6">
          <LoginForm />
        </section>
        <p className="mt-6 text-center text-xs text-ink-400">
          Don&rsquo;t have an account yet? Your account is created automatically
          the first time a merchant sends you a payment-plan link.
        </p>
      </main>
    </div>
  );
}
