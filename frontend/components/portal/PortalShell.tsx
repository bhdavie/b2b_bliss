import Link from "next/link";
import { BlissWordmark } from "@/components/BlissWordmark";

// Persistent Bliss-styled nav shell for the customer portal. Server component:
// the sign-out server action clears the session cookie and bounces to login.
// The Bliss wordmark is the only serif (Georgia Bold purple); everything else
// is Inter, square corners.

type Section = "home" | "plans" | "history" | "settings";

const TABS: { key: Section; href: string; label: string }[] = [
  { key: "home", href: "/account", label: "Home" },
  { key: "plans", href: "/account/plans", label: "Plans" },
  { key: "history", href: "/account/history", label: "History" },
  { key: "settings", href: "/account/settings", label: "Settings" },
];

async function signOut() {
  "use server";
  const { cookies } = await import("next/headers");
  const store = await cookies();
  store.delete("bliss_customer_session");
  try {
    await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"}/api/v1/public/account/logout`,
      { method: "POST" },
    );
  } catch {
    // local cookie already cleared
  }
  const { redirect } = await import("next/navigation");
  redirect("/account/login");
}

export function PortalShell({
  active,
  children,
}: {
  active: Section;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-ink font-body">
      <header className="border-b border-brand-purple-dark bg-brand-purple">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/account" className="no-underline">
            <BlissWordmark className="text-4xl text-white" />
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="text-base font-medium text-white/80 transition-colors hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 px-4">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`border-b-2 px-3 py-3 text-base font-bold no-underline transition-colors ${
                active === t.key
                  ? "border-brand-lavender text-white"
                  : "border-transparent text-white/60 hover:text-white"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-10 sm:px-8">{children}</main>
    </div>
  );
}
