import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { fetchAccountPlans } from "@/lib/publicApi";
import { ClearStaleSession } from "@/components/account/ClearStaleSession";
import { LoginForm } from "@/components/account/LoginForm";
import { AuthShell } from "@/components/auth/AuthShell";

// Stays an async server component: the session check below has to run before
// anything renders. AuthShell carries no "use client", so it renders here on
// the server with the client <LoginForm/> slotted in as children — the same
// shell the merchant sign-in renders inside a fully client page.
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
    <>
      {/* Present but unverifiable: drop it rather than leave a dead session in
          the browser for whatever remains of its Max-Age. */}
      {hasCookie ? <ClearStaleSession /> : null}
      <AuthShell
        heading="Welcome back"
        subhead="Sign in to see your payment plans across every Bliss merchant."
        footer={
          <>
            Don&rsquo;t have an account yet? Your account is created
            automatically the first time a merchant sends you a payment-plan
            link.
          </>
        }
      >
        <LoginForm />
      </AuthShell>
    </>
  );
}
