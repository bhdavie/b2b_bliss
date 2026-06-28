import type { ReactNode } from "react";
import { BlissWordmark } from "@/components/BlissWordmark";

export function PageChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-ink font-body">
      <Header />
      <main className="mx-auto w-full max-w-[480px] px-5 pb-16 pt-4 sm:pt-6">
        {children}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-brand-neutral bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex max-w-[480px] items-center justify-between px-5 py-3">
        <BlissWordmark className="text-[20px] leading-none tracking-[-0.5px] text-brand-navy" />
        <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <LockIcon />
          <span>Secure checkout</span>
        </div>
      </div>
    </header>
  );
}

function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
