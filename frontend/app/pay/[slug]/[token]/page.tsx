import { HostedPlanFlow } from "@/components/consumer/HostedPlanFlow";
import { InactiveLink } from "@/components/consumer/InactiveLink";
import { MerchantBlock } from "@/components/consumer/MerchantBlock";
import { PageChrome } from "@/components/consumer/PageChrome";
import { ServiceCard } from "@/components/consumer/ServiceCard";
import { TooClose } from "@/components/consumer/TooClose";
import { fetchPublicBooking } from "@/lib/publicApi";
import { fetchFeeRate } from "@/lib/blissFee";

type Params = { slug: string; token: string };

export default async function HostedPaymentPlanPage(props: {
  params: Promise<Params>;
}) {
  const { slug, token } = await props.params;
  // The property's processing-fee rate, resolved here where the slug lives and
  // passed down. Never throws: a failed lookup resolves to the same fallback
  // the backend uses, so the page still renders a fee.
  const [booking, feeRate] = await Promise.all([
    fetchPublicBooking(slug, token),
    fetchFeeRate(slug),
  ]);

  if (!booking) {
    return (
      <PageChrome>
        <InactiveLink
          title="This link is no longer active"
          body="The link you followed has expired or was already used. Reach out to the property for a fresh one."
        />
      </PageChrome>
    );
  }

  if (booking.status === "canceled") {
    return (
      <PageChrome>
        <MerchantBlock merchant={booking.merchant} />
        <InactiveLink
          title={`${booking.merchant.businessName} canceled this booking`}
          body="Contact the property directly with any questions."
        />
      </PageChrome>
    );
  }

  if (
    booking.status === "accepted" ||
    booking.status === "in_progress" ||
    booking.status === "completed"
  ) {
    return (
      <PageChrome>
        <MerchantBlock merchant={booking.merchant} />
        <InactiveLink
          title="This booking has already been accepted"
          body="Sign in to manage your plan, or contact the property if you have questions."
        />
      </PageChrome>
    );
  }

  if (!booking.eligibility.eligible) {
    return (
      <PageChrome>
        <MerchantBlock merchant={booking.merchant} />
        <ServiceCard service={booking.service} feeRate={feeRate} />
        <TooClose booking={booking} />
      </PageChrome>
    );
  }

  return (
    <PageChrome>
      <HostedPlanFlow booking={booking} feeRate={feeRate} />
    </PageChrome>
  );
}
