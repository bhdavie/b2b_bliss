"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard might be unavailable (insecure context); fall back to selecting
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="ghost" className="text-xs" onClick={handleCopy}>
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
