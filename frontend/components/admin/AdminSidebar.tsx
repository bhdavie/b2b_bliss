"use client";

import { BlissWordmark } from "@/components/BlissWordmark";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminSignOutButton } from "./AdminSignOutButton";

type NavItem = { href: string; label: string };

// One item for now. Every authenticated admin route sits under /admin so the
// prefix cannot collide with a merchant or guest route.
const NAV: NavItem[] = [{ href: "/admin", label: "Properties" }];

export function AdminSidebar({ email, name }: { email: string; name?: string | null }) {
  const pathname = usePathname();
  const initial = (name?.trim()?.[0] ?? email.trim()[0] ?? "?").toUpperCase();

  return (
    <aside className="flex flex-col justify-between border-sand-200 bg-sand-50 py-[34px] md:fixed md:inset-y-0 md:left-0 md:w-[264px] md:border-r">
      <div className="flex flex-col">
        <div className="flex flex-col gap-[5px] px-7 pb-10">
          <BlissWordmark className="text-[22px] tracking-[-0.005em] text-brand-violet" />
          <div className="text-sm text-ink-400">Bliss internal</div>
        </div>

        <nav className="flex flex-col gap-0.5 px-4">
          {NAV.map((item) => {
            // Exact match for /admin, prefix match for anything beneath it, so
            // Properties stays lit on /admin/properties/{id}.
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center rounded-md px-3 py-[13px] text-base no-underline transition-colors ${
                  active
                    ? "bg-brand-violet-tint font-medium text-brand-violet"
                    : "text-ink-600 hover:bg-brand-violet-tint/60"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="hidden px-5 md:block">
        <div className="mx-2 mb-5 h-px bg-sand-200" />
        <div className="flex items-center gap-3 px-2 py-2.5">
          <div className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-brand-lavender text-sm font-semibold text-brand-violet-deep">
            {initial}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="truncate text-sm font-medium text-ink-900" title={email}>
              {email}
            </div>
            <AdminSignOutButton />
          </div>
        </div>
      </div>
    </aside>
  );
}
