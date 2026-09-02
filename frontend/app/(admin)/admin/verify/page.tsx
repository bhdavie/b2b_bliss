import { Suspense } from "react";
import { BlissWordmark } from "@/components/BlissWordmark";
import { AdminVerifyClient } from "./AdminVerifyClient";

/**
 * Landing page for an admin magic link. Mirrors app/verify for the merchant
 * side: a Suspense boundary because the client half reads searchParams.
 *
 * The path matters — AdminAuthService builds its link as
 * {merchantBaseUrl}/admin/verify?token=..., so this file is what that URL
 * resolves to.
 */
export default function AdminVerifyPage() {
  return (
    <Suspense fallback={<AdminVerifyFallback />}>
      <AdminVerifyClient />
    </Suspense>
  );
}

function AdminVerifyFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 font-inter">
      <div className="w-full max-w-sm text-center">
        <BlissWordmark className="text-xl tracking-tight text-brand-violet" />
        <p className="mt-6 text-ink-500">Signing you in</p>
      </div>
    </main>
  );
}
