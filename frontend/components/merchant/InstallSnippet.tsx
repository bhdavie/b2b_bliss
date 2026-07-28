"use client";

import { useState } from "react";

/**
 * A ready-to-paste snippet with a copy control.
 *
 * Client component because clipboard access needs the browser; the page that
 * renders it stays a server component and composes the string there, so the
 * snippet is never assembled client-side from data the guest could tamper with.
 */
export function InstallSnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable in an insecure context. The snippet is still
      // visible and selectable, so this degrades to manual copy.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto border border-brand-neutral bg-brand-cream/30 p-4 text-xs leading-relaxed text-brand-navy">
        <code>{snippet}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center justify-center rounded-md bg-brand-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-purple-dark"
      >
        {copied ? "Copied" : "Copy snippet"}
      </button>
    </div>
  );
}
