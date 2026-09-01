import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyGuestClient } from "./VerifyGuestClient";

// useSearchParams needs a Suspense boundary, same shape as the merchant /verify.
export default function GuestVerifyPage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          heading="Signing you in"
          subhead="One moment while we open your account."
        />
      }
    >
      <VerifyGuestClient />
    </Suspense>
  );
}
