"use client";

import { BlissWordmark } from "@/components/BlissWordmark";

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
    <aside className="md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-r md:border-brand-neutral md:bg-white flex flex-col">
      <div className="px-5 py-5 flex items-center justify-between md:block">
        <BlissWordmark className="text-lg tracking-tight text-brand-navy" />
        <div className="text-xs text-ink-muted mt-0.5 hidden md:block">
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
                  ? "bg-brand-lavender text-white font-medium"
                  : "text-ink-muted hover:bg-brand-cream/60 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-4 py-4 border-t border-brand-neutral hidden md:block">
        <div className="text-xs text-ink-muted truncate" title={email}>
          {email}
        </div>
        <div className="mt-2">
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
