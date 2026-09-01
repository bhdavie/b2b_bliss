import { type AccountPlanCard } from "@/lib/publicApi";
import { Panel, SectionHeading } from "@/components/ui/primitives";
import { PlanRow, type PlanOrigin } from "./PlanCard";

/**
 * The guest's plans, as ONE card with a heading and hairline-separated rows.
 *
 * It used to be a loose heading ("Your plans" on /account, a PageLead on
 * /account/history) sitting on the sand ground above N separate plan cards.
 * Neither of the two obvious fixes worked on its own: the heading labels the
 * GROUP, so folding it into the first plan's card would have made it read as
 * that plan's own title, and wrapping the whole group in an outer card would
 * have nested cards inside a card.
 *
 * So the group became the card. There are two precedents for exactly this shape
 * in the same app — /home's "Recent bookings" panel and the /bookings table —
 * both of which are one card holding a heading and a list of rows. A list is
 * not a set of separate groups; it is one group with several entries, which is
 * what makes one card the right answer here and stacked cards the right answer
 * on a screen like /plan/[token].
 */
export function PlansList({
  plans,
  from,
  title,
  helper,
  emptyTitle = "No plans yet",
  emptyBody = "When a property sends you a payment-plan link, your plan will appear here automatically.",
}: {
  plans: AccountPlanCard[];
  /** Threaded through to each row so the plan screen knows the entry point. */
  from?: PlanOrigin;
  /** The card's heading. Labels the list, not any one plan in it. */
  title: string;
  /** Optional line under the heading, where a route's orienting copy lands. */
  helper?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  return (
    <Panel variant="filled" className="px-10 pb-2 pt-9">
      <div className={`flex flex-col gap-2 ${helper ? "mb-6" : "mb-5"}`}>
        <SectionHeading>{title}</SectionHeading>
        {helper ? <p className="text-[17px] text-ink-400">{helper}</p> : null}
      </div>

      {plans.length === 0 ? (
        // The export does not draw an empty state; styled to match the rows it
        // replaces — same card, quieter type, centred. It sits inside the card
        // now rather than being a card of its own, so an empty list still reads
        // as this list being empty rather than as a different screen.
        <div className="flex flex-col items-center px-4 pb-14 pt-8 text-center">
          <div className="text-[22px] font-medium tracking-[-0.015em] text-ink-900">
            {emptyTitle}
          </div>
          <p className="mt-2.5 max-w-[420px] text-[17px] text-ink-500">
            {emptyBody}
          </p>
        </div>
      ) : (
        plans.map((plan) => (
          <PlanRow key={plan.planId} plan={plan} from={from} />
        ))
      )}
    </Panel>
  );
}
