import { Panel, SectionHeading } from "@/components/ui/primitives";

/**
 * Static mock of the guest plan detail, shown beside the signup form at large
 * widths. Hand-built markup with invented figures: it is NOT the real portal
 * component and is wired to no data, deliberately, so nothing on an unauthed
 * page depends on plan state.
 *
 * The treatment is copied from components/portal/PlanPortal.tsx rather than
 * imported from it, so the two can drift only if someone changes one and not
 * the other. It is a 1:1 copy, NOT a scaled-down thumbnail: every size, weight,
 * colour and spacing value below is the portal's own, so a drift check is a
 * straight diff against that file. Do not "shrink to fit" — if the card is too
 * tall for a viewport, drop a row rather than reducing the scale.
 *
 * What is copied, and from where:
 *   progress   PlanPortal's plan-progress block — 8px sand-200 track with a
 *              violet fill, then a Paid to date / Remaining row at 15px ink-400
 *              labels over 17px medium ink-900 figures
 *   panel      Panel's filled variant (sand-50 on a sand-200 hairline, 20px
 *              radius, no shadow) at the portal's px-7 py-[30px]
 *   row        two stacked lines — label and amount share line one on a common
 *              baseline via justify-between, both at 17px; line two is the 13px
 *              ink-400 meta string
 *   meta       composed the way ScheduleTimeline composes it: "Due {date} ·
 *              {status}", or "Automatic on {date} · Next payment · {status}"
 *              for the next payment
 *   node       12px disc; violet filled when paid, 3.5px violet ring on white
 *              for the next payment, sand-400 when scheduled
 *   rail       1.5px, lavender behind the position and sand-300 in front, hung
 *              under each node and omitted on the last row
 *
 * The portal also renders a "canceled" state (label and amount both drop to
 * ink-400). The mock's rows are fixed and never hit it, so that branch is left
 * out rather than carried as dead code.
 *
 * Three rows, not four: one per timeline state is all the mock has to prove,
 * and a fourth pushed the card's lower edge past a laptop viewport.
 */

type RowState = "paid" | "next" | "scheduled";

type Row = {
  label: string;
  state: RowState;
  date: string;
  amount: string;
};

// Invented, plausible for a boutique hotel stay: $2,400 total, an $800 deposit
// already taken and two $800 monthly installments on the 16th anchor. August 16
// 2026 is a Sunday, so that one rolls forward to Monday the 17th, which is what
// the shipped schedule rule does.
const ROWS: Row[] = [
  {
    label: "Deposit",
    state: "paid",
    date: "July 16, 2026",
    amount: "$800.00",
  },
  {
    label: "Installment 1 of 2",
    state: "next",
    date: "August 17, 2026",
    amount: "$800.00",
  },
  {
    label: "Installment 2 of 2",
    state: "scheduled",
    date: "September 16, 2026",
    amount: "$800.00",
  },
];

// $800 paid of $2,400 due.
const PAID_PERCENT = 33.33;

export function SignupPlanPreview() {
  return (
    <div className="flex w-full max-w-[620px] flex-col">
      {/* PLACEHOLDER COPY — Brad to replace. */}
      <h2 className="font-display text-[22px] font-medium leading-[1.15] tracking-[-0.02em] text-ink-900">
        Give guests the payment option they expect
      </h2>
      <p className="mt-2 text-[15px] leading-[1.5] text-ink-500">
        They pay over time before arrival. You are paid in full by check-in.
      </p>
      {/* END PLACEHOLDER COPY */}

      {/* aria-hidden sits on this wrapper, not on Panel: Panel takes only
          children/className/variant and has no rest spread, so an aria-* prop
          passed to it is silently dropped (TypeScript does not flag hyphenated
          JSX attributes as excess props, so nothing catches it at build time).
          The mock is decorative and must stay out of the accessibility tree. */}
      <div aria-hidden="true" className="mt-6">
      {/* White, not the filled variant: the right panel it sits on is already
          sand-50, so a sand-50 card would vanish into it. Outlined keeps the
          sand-200 hairline and the 20px radius. */}
      <Panel variant="outlined" className="bg-white px-7 py-[30px]">
        {/* Plan progress. Decorative in the portal too: the two figures the bar
            encodes are printed underneath it. */}
        <div className="mb-9 flex flex-col gap-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-sand-200">
            <div
              className="h-full rounded-full bg-brand-violet"
              style={{ width: `${PAID_PERCENT}%` }}
            />
          </div>
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-[7px]">
              <div className="text-[15px] text-ink-400">Paid to date</div>
              <div className="text-[17px] font-medium text-ink-900">$800.00</div>
            </div>
            <div className="flex flex-col items-end gap-[7px]">
              <div className="text-[15px] text-ink-400">Remaining</div>
              <div className="text-[17px] font-medium text-ink-900">
                $1,600.00
              </div>
            </div>
          </div>
        </div>

        <SectionHeading className="mb-5">Schedule</SectionHeading>
        <ol>
          {ROWS.map((row, i) => {
            const isLast = i === ROWS.length - 1;
            const statusWord = row.state === "paid" ? "Paid" : "Scheduled";
            const meta =
              row.state === "next"
                ? `Automatic on ${row.date} · Next payment · ${statusWord}`
                : `Due ${row.date} · ${statusWord}`;

            return (
              <li key={row.label} className="flex gap-x-[26px]">
                <div className="flex w-[26px] flex-none flex-col items-center pt-1.5">
                  <TimelineNode state={row.state} />
                  {isLast ? null : (
                    <div
                      className={`min-h-4 w-[1.5px] flex-1 ${
                        row.state === "paid"
                          ? "bg-brand-lavender"
                          : "bg-sand-300"
                      }`}
                    />
                  )}
                </div>

                <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-4"}`}>
                  {/* Line one: label left, amount right, both at body size. */}
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0 text-[17px] font-medium tracking-[-0.01em] text-ink-900">
                      {row.label}
                    </div>
                    <div className="flex-none text-right text-[17px] text-ink-700">
                      {row.amount}
                    </div>
                  </div>

                  {/* Line two: date and status together, muted and smaller. */}
                  <div className="mt-1 text-[13px] text-ink-400">{meta}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
      </div>
    </div>
  );
}

/** The portal's timeline node, at the portal's own 12px scale. */
function TimelineNode({ state }: { state: RowState }) {
  if (state === "next") {
    return (
      <div className="h-3 w-3 flex-none rounded-full border-[3.5px] border-brand-violet bg-white" />
    );
  }
  return (
    <div
      className={`h-3 w-3 flex-none rounded-full ${
        state === "paid" ? "bg-brand-violet" : "bg-sand-400"
      }`}
    />
  );
}
