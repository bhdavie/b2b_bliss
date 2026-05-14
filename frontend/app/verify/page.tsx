import { Suspense } from "react";
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
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="text-xl font-medium tracking-tight">bliss</div>
        <p className="mt-6 text-ink-muted">Signing you in</p>
      </div>
    </main>
  );
}
