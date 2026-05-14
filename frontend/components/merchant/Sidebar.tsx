"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/bookings", label: "Bookings" },
  { href: "/payouts", label: "Payouts" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-r md:border-surface-border md:bg-white flex flex-col">
      <div className="px-5 py-5 flex items-center justify-between md:block">
        <div className="text-lg font-medium tracking-tight">bliss</div>
        <div className="text-xs text-ink-soft mt-0.5 hidden md:block">
          Merchant dashboard
        </div>
      </div>

      <nav className="px-2 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-lavender-100 text-lavender-700 font-medium"
                  : "text-ink-muted hover:bg-surface-subtle hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-4 py-4 border-t border-surface-border hidden md:block">
        <div className="text-xs text-ink-soft truncate" title={email}>
          {email}
        </div>
        <div className="mt-2">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
