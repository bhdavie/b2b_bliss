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
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg bg-ink-900 px-7 py-[26px]">
        <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[15px] leading-[1.75] text-sand-100">
          <code>{snippet}</code>
        </pre>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="self-start rounded-full bg-brand-violet px-[30px] py-[15px] text-base font-medium tracking-[-0.01em] text-white transition-colors hover:bg-brand-violet-deep"
      >
        {copied ? "Copied" : "Copy snippet"}
      </button>
    </div>
  );
}
