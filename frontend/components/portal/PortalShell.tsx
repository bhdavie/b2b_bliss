import Link from "next/link";
import { BlissWordmark } from "@/components/BlissWordmark";

// Left-sidebar shell for the customer portal, mirroring the merchant dashboard
// shell (white sidebar, Georgia-purple wordmark, navy nav with a lavender
// active state, email + Sign out pinned to the bottom). Server component: the
// sign-out server action clears the customer session cookie and bounces to
// login. The Bliss wordmark is the only serif; everything else is Inter.

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
  email,
  children,
}: {
  active: Section;
  email?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white font-body text-ink">
      <aside className="md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-r md:border-brand-neutral md:bg-white flex flex-col">
        <div className="px-5 py-5 flex items-center justify-between md:block">
          <Link href="/account" className="no-underline">
            <BlissWordmark className="text-lg tracking-tight text-brand-purple" />
          </Link>
          <div className="text-xs text-ink-muted mt-0.5 hidden md:block">
            Guest account
          </div>
        </div>

        <nav className="px-2 flex flex-col gap-0.5">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`flex items-center gap-2 rounded-none px-3 py-2 text-sm font-medium no-underline transition-colors ${
                active === t.key
                  ? "bg-brand-lavender/20 text-brand-purple"
                  : "text-brand-navy/60 hover:bg-brand-cream/50 hover:text-brand-navy"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto px-4 py-4 border-t border-brand-neutral hidden md:block">
          {email ? (
            <div className="text-xs text-ink-muted truncate" title={email}>
              {email}
            </div>
          ) : null}
          <form action={signOut} className="mt-2">
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="md:pl-60">
        <div className="max-w-4xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
