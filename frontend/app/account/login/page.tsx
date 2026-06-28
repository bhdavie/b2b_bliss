import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/account/LoginForm";
import { BlissWordmark } from "@/components/BlissWordmark";

export default async function AccountLoginPage() {
  const cookieStore = await cookies();
  if (cookieStore.get("bliss_customer_session")?.value) {
    redirect("/account");
  }
  return (
    <div className="min-h-screen bg-white text-ink font-body">
      <header className="border-b border-brand-neutral">
        <div className="mx-auto max-w-md px-6 py-6 text-center">
          <BlissWordmark className="text-2xl text-brand-purple" />
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Sign in to see your payment plans across every Bliss merchant.
        </p>
        <section className="mt-6 rounded-none border border-brand-neutral bg-white p-6">
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
