import Link from "next/link";
import { redirect } from "next/navigation";
import { NewBookingForm } from "@/components/merchant/NewBookingForm";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { fetchOnboardingServer, fetchPlanRulesServer } from "@/lib/auth";

export default async function NewBookingPage() {
  const [onboarding, planRules] = await Promise.all([
    fetchOnboardingServer(),
    fetchPlanRulesServer(),
  ]);
  // Same swap as the bookings list: the reachability of this form follows the
  // PMS connection, not a Stripe Connect account the property can no longer
  // obtain. Mirrors the canCreate gate that renders the link.
  const pmsConnected =
    onboarding?.steps.find((s) => s.key === "pms_connected")?.done ?? false;

  if (!pmsConnected) {
    redirect("/bookings");
  }

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/bookings"
            className="text-xs text-ink-muted hover:underline"
          >
            ← Back to bookings
          </Link>
          <h1 className="mt-2 text-3xl font-bold">New booking</h1>
          <p className="mt-1 text-ink-muted">
            Set the service, total, and date. We will derive the plan options
            automatically based on how far out the appointment is.
          </p>
        </div>
      </header>

      <NewBookingForm planRules={planRules ?? DEFAULT_PLAN_RULES} />
    </>
  );
}
