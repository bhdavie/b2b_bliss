import Link from "next/link";
import { redirect } from "next/navigation";
import { NewBookingForm } from "@/components/merchant/NewBookingForm";
import { DEFAULT_PLAN_RULES } from "@/lib/api";
import { SectionHeading } from "@/components/ui/primitives";
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
    <NewBookingForm
      planRules={planRules ?? DEFAULT_PLAN_RULES}
      head={
        // Back link, title and helper, all inside the form's card. They were
        // the last loose head in the merchant app: a violet back link, a 44px
        // display-serif title and an 18px subtitle, stacked on the sand ground
        // above the card they describe.
        //
        // The title dropped from PageHeader to the app's one in-card heading
        // treatment. No route behind the sidebar carries a 44px title any more
        // — /plan/[token] was the last and has since given its up too, so this
        // head is not a compromise between two styles, it is the style.
        // Nothing is lost: the sidebar's Bookings tab plus "New booking" at the
        // top of the form say where you are, which is all the old title said.
        <div className="mb-6 flex flex-col border-b border-sand-100 pb-5">
          <Link
            href="/bookings"
            className="mb-4 self-start text-[15px] text-brand-violet no-underline hover:underline"
          >
            ← Back to bookings
          </Link>
          <SectionHeading className="mb-2.5">New booking</SectionHeading>
          <p className="text-[17px] leading-[1.55] text-ink-400">
            Set the service, total, and date. We will derive the plan options
            automatically based on how far out the appointment is.
          </p>
        </div>
      }
    />
  );
}
