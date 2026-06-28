import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/account/LoginForm";

export default async function AccountLoginPage() {
  const cookieStore = await cookies();
  if (cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account");
  }
  return (
    <div className="min-h-screen bg-white text-ink font-body">
      <header className="border-b border-brand-neutral bg-gradient-to-b from-white to-brand-lavender/15">
        <div className="mx-auto max-w-md px-6 py-12 text-center">
          <p className="text-[11px] uppercase tracking-[0.25em] text-ink-muted">
            Bliss account
          </p>
          <h1 className="mt-2 font-editorial italic text-3xl tracking-[0.02em] text-brand-navy">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Sign in to see your payment plans across every Bliss merchant.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-10">
        <section className="rounded-lg border border-brand-neutral bg-white/70 p-6 shadow-sm backdrop-blur-sm">
          <LoginForm />
        </section>
        <p className="mt-6 text-center text-xs text-ink-muted">
          Don&rsquo;t have an account yet? Your account is created automatically
          the first time a merchant sends you a payment-plan link.
        </p>
      </main>
    </div>
  );
}
