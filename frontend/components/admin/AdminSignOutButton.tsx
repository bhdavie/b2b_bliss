"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminSignOut } from "@/lib/api";

/**
 * Mirrors the merchant SignOutButton's "plain" variant. Its own component
 * rather than a prop on that one: it clears a different cookie and lands on a
 * different sign-in, and a shared button taking the endpoint as an argument
 * would make it possible to wire the wrong pair together.
 */
export function AdminSignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await adminSignOut();
      router.push("/admin/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="text-left text-sm text-ink-400 transition-colors hover:text-ink-900 disabled:opacity-60"
    >
      {busy ? "Signing out" : "Sign out"}
    </button>
  );
}
