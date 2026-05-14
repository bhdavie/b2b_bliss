import { CheckoutFlow, type CheckoutCart } from "@/components/consumer/CheckoutFlow";
import { InactiveLink } from "@/components/consumer/InactiveLink";
import { PageChrome } from "@/components/consumer/PageChrome";
import { fetchPublicMerchant } from "@/lib/publicApi";

type Params = { slug: string };
type SearchParams = Record<string, string | string[] | undefined>;

export default async function CheckoutPage(props: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ slug }, raw] = await Promise.all([props.params, props.searchParams]);
  const merchant = await fetchPublicMerchant(slug);

  if (!merchant) {
    return (
      <PageChrome>
        <InactiveLink
          title="We can't find that merchant"
          body="The checkout link you followed points to a merchant we don't recognize. Contact the merchant for a fresh link."
        />
      </PageChrome>
    );
  }

  const parsed = parseCart(raw);
  if (parsed.kind === "missing") {
    return (
      <PageChrome>
        <InactiveLink
          title="This checkout link is missing required details"
          body={`The link is missing the ${parsed.missing.join(" and ")} parameter${
            parsed.missing.length === 1 ? "" : "s"
          }. Contact ${merchant.merchant.businessName} for a fresh link.`}
        />
      </PageChrome>
    );
  }
  if (parsed.kind === "invalid") {
    return (
      <PageChrome>
        <InactiveLink
          title="This checkout link is malformed"
          body={`${parsed.reason}. Contact ${merchant.merchant.businessName} for a fresh link.`}
        />
      </PageChrome>
    );
  }

  return (
    <PageChrome>
      <CheckoutFlow merchant={merchant} cart={parsed.cart} />
    </PageChrome>
  );
}

type Parsed =
  | { kind: "ok"; cart: CheckoutCart }
  | { kind: "missing"; missing: string[] }
  | { kind: "invalid"; reason: string };

function parseCart(p: SearchParams): Parsed {
  const total = firstOf(p.total);
  const checkin = firstOf(p.checkin);
  const missing: string[] = [];
  if (!total) missing.push("total");
  if (!checkin) missing.push("checkin");
  if (missing.length > 0) return { kind: "missing", missing };

  const totalCents = Number.parseInt(total!, 10);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    return { kind: "invalid", reason: "total must be a positive integer (cents)" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin!)) {
    return { kind: "invalid", reason: "checkin must be yyyy-MM-dd" };
  }
  const checkout = firstOf(p.checkout);
  if (checkout && !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    return { kind: "invalid", reason: "checkout must be yyyy-MM-dd" };
  }

  return {
    kind: "ok",
    cart: {
      totalCents,
      checkin: checkin!,
      checkout: checkout ?? null,
      description: firstOf(p.description) ?? null,
      name: firstOf(p.name) ?? null,
      email: firstOf(p.email) ?? null,
      phone: firstOf(p.phone) ?? null,
    },
  };
}

function firstOf(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}
