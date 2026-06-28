import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { PlansList } from "@/components/account/PlansList";

export default async function AccountPage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("bliss_customer_session");
  if (!sessionCookie?.value) {
    redirect("/account/login");
  }
  // Forward the cookie header so the backend's CookieParam picks it up.
  const cookieHeader = (await headers()).get("cookie") ?? null;
  const data = await fetchAccountPlans(cookieHeader);

  if (!data) {
    // Backend rejected the session — clear and bounce to login.
    redirect("/account/login");
  }

  return (
    <div className="min-h-screen bg-white text-ink font-body">
      <header className="border-b border-brand-neutral bg-gradient-to-b from-white to-brand-lavender/15">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-ink-muted">
                Your Bliss account
              </p>
              <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-navy">
                Your payment plans
              </h1>
              <p className="mt-1 text-sm text-ink-muted">
                Signed in as {data.email}
              </p>
            </div>
            <SignOutForm />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <PlansList plans={data.plans} />
      </main>
    </div>
  );
}

function SignOutForm() {
  async function signOut() {
    "use server";
    const { cookies: serverCookies } = await import("next/headers");
    const store = await serverCookies();
    store.delete("bliss_customer_session");
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"}/api/v1/public/account/logout`,
        { method: "POST" },
      );
    } catch {
      // ignore — local cookie already cleared above
    }
    const { redirect: r } = await import("next/navigation");
    r("/account/login");
  }
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-xs font-medium uppercase tracking-[0.18em] text-ink-muted underline-offset-2 hover:underline"
      >
        Sign out
      </button>
    </form>
  );
}
