import Link from "next/link";
import { BlissWordmark } from "@/components/BlissWordmark";
import { API_BASE_URL } from "@/lib/api";

// Left-sidebar shell for the customer portal, built to the settled design: a
// 264px sand rail, Georgia-violet wordmark, violet-tint active nav pill, and an
// avatar + email + Sign out pinned to the bottom. Server component: the
// sign-out server action clears the customer session cookie and bounces to
// login. The Bliss wordmark is the only serif.

// "Plans" folded into "Home": /account now renders the plan (single) or the
// plan list (several), so the two entries pointed at the same route.
type Section = "home" | "history" | "settings";

const TABS: { key: Section; href: string; label: string }[] = [
  { key: "home", href: "/account", label: "Home" },
  { key: "history", href: "/account/history", label: "History" },
  { key: "settings", href: "/account/settings", label: "Settings" },
];

async function signOut() {
  "use server";
  const { cookies } = await import("next/headers");
  const store = await cookies();
  store.delete("bliss_customer_session");
  try {
    await fetch(`${API_BASE_URL}/api/v1/public/account/logout`, { method: "POST" });
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
    <div className="min-h-screen bg-white font-body text-ink-900">
      <aside className="flex flex-col justify-between border-sand-200 bg-sand-50 py-[34px] md:fixed md:inset-y-0 md:left-0 md:w-[264px] md:border-r">
        <div className="flex flex-col">
          <div className="flex flex-col gap-[5px] px-7 pb-10">
            <Link href="/account" className="no-underline">
              <BlissWordmark className="text-[22px] tracking-[-0.005em] text-brand-violet" />
            </Link>
            <div className="text-sm text-ink-400">Guest account</div>
          </div>

          <nav className="flex flex-col gap-0.5 px-4">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className={`flex items-center rounded-md px-3 py-[13px] text-base no-underline transition-colors ${
                  active === t.key
                    ? "bg-brand-violet-tint font-medium text-brand-violet"
                    : "text-ink-600 hover:bg-brand-violet-tint/60"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden px-5 md:block">
          <div className="mx-2 mb-5 h-px bg-sand-200" />
          <div className="flex items-center gap-3 px-2 py-2.5">
            <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-brand-lavender text-sm font-semibold text-brand-violet-deep">
              {(email?.trim()?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              {email ? (
                <div
                  className="truncate text-sm font-medium tracking-[-0.005em] text-ink-900"
                  title={email}
                >
                  {email}
                </div>
              ) : null}
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-sm text-ink-400 transition-colors hover:text-ink-900"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <main className="md:pl-[264px]">
        <div className="mx-auto max-w-[1136px] px-6 pt-14 xl:px-16">
          {children}
        </div>
      </main>
    </div>
  );
}
