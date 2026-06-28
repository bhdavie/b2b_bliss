import { Suspense } from "react";
import { BlissWordmark } from "@/components/BlissWordmark";
import { VerifyClient } from "./VerifyClient";

export default function VerifyPage() {
  return (
    <Suspense fallback={<VerifyFallback />}>
      <VerifyClient />
    </Suspense>
  );
}

function VerifyFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 font-body">
      <div className="w-full max-w-sm text-center">
        <BlissWordmark className="text-xl tracking-tight text-brand-navy" />
        <p className="mt-6 text-ink-muted">Signing you in</p>
      </div>
    </main>
  );
}
