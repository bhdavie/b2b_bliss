"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/api";
import { Button } from "@/components/ui/Button";

export function SignOutButton({
  variant = "pill",
}: {
  /**
   * "pill" is the original ghost button. "plain" is the settled design's
   * 14px text link, sitting under the email in the sidebar footer.
   */
  variant?: "pill" | "plain";
} = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (variant === "plain") {
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

  return (
    <Button onClick={handleClick} disabled={busy} variant="ghost">
      {busy ? "Signing out" : "Sign out"}
    </Button>
  );
}
