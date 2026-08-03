import { SectionHeading } from "@/components/ui/primitives";

/**
 * Static mock of the guest plan detail, shown beside the signup form at large
 * widths. Hand-built markup with invented figures: it is NOT the real portal
 * component and is wired to no data, deliberately, so nothing on an unauthed
 * page depends on plan state.
 *
 * The treatment is copied from components/portal/PlanPortal.tsx rather than
 * imported from it, so the two can drift only if someone changes one and not
 * the other. Values taken from there verbatim:
 *   balance band  border-y sand-300, 13px REMAINING label, 64px figure,
 *                 17px "Paid to date" line with the paid figure in ink-900
 *   node          12px disc; violet filled when paid, 3.5px violet ring on
 *                 white for the next payment, sand-400 when scheduled
 *   rail          1.5px, lavender behind the position and sand-300 in front,
 *                 hung under each node and omitted on the last row
 *   next row      violet 2px left border, 13px violet "Next payment ·
 *                 scheduled" kicker, 20px title, 16px ink-600 automatic line
 *
 * Everything is drawn at preview scale, not portal scale: this is a thumbnail of
 * the guest screen sitting beside a form, so the balance figure, row titles,
 * labels, amounts and row spacing are all reduced from the values above, and the
 * node and rail shrink with them. Colour, hierarchy and the three timeline
 * states are unchanged, which is what has to stay recognisable.
 *
 * Rows keep the portal's three-column arrangement (title, date, amount) at
 * preview widths: 150px and 90px rather than the portal's 200px and 110px, which
 * are sized for a full-width page. Holding the columns fixed is what stops the
 * title and the amount drifting to opposite edges as the panel widens, and it
 * puts the date back on the title's line, which is where the portal has it.
 */

type Row = {
  label: string;
  state: "paid" | "next" | "scheduled";
  status: string;
  date: string;
  amount: string;
};

// Invented, plausible for a boutique hotel stay: $2,400 total, an $800 deposit
// already taken and two $800 monthly installments on the 16th anchor. August 16
// 2026 is a Sunday, so that one rolls forward to Monday the 17th, which is what
// the shipped schedule rule does.
//
// Three rows, not four: one per timeline state is all the mock has to prove, and
// a fourth pushed the card's lower edge past a laptop viewport.
const ROWS: Row[] = [
  {
    label: "Deposit",
    state: "paid",
    status: "Paid",
    date: "July 16, 2026",
    amount: "$800.00",
  },
  {
    label: "Installment 1 of 2",
    state: "next",
    status: "Next payment · scheduled",
    date: "August 17, 2026",
    amount: "$800.00",
  },
  {
    label: "Installment 2 of 2",
    state: "scheduled",
    status: "Scheduled",
    date: "September 16, 2026",
    amount: "$800.00",
  },
];

export function SignupPlanPreview() {
  return (
    <div className="flex w-full max-w-[620px] flex-col">
      {/* PLACEHOLDER COPY — Brad to replace. */}
      <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] text-ink-900">
        Give guests the payment option they expect
      </h2>
      <p className="mt-2 text-[15px] leading-[1.5] text-ink-500">
        They pay over time before arrival. You are paid in full by check-in.
      </p>
      {/* END PLACEHOLDER COPY */}

      <div
        aria-hidden="true"
        className="mt-6 flex flex-col rounded-panel border border-sand-200 bg-white px-6 pb-6 pt-5"
      >
        {/* Balance band */}
        <div className="mb-6 flex flex-col gap-2.5 border-y border-sand-300 pb-4 pt-4">
          <SectionHeading>Remaining</SectionHeading>
          <div className="text-[34px] font-medium leading-none tracking-[-0.03em] text-ink-900">
            $1,600.00
          </div>
          <div className="text-sm text-ink-500">
            Paid to date <span className="font-medium text-ink-900">$800.00</span>{" "}
            of $2,400.00
          </div>
        </div>

        <SectionHeading className="mb-4">Schedule</SectionHeading>
        <ol>
          {ROWS.map((row, i) => {
            const isLast = i === ROWS.length - 1;
            return (
              <li key={row.label} className="flex gap-x-[14px]">
                <div className="flex w-[18px] flex-none flex-col items-center pt-1.5">
                  <Node state={row.state} />
                  {isLast ? null : (
                    <div
                      className={`min-h-5 w-[1.5px] flex-1 ${
                        row.state === "paid" ? "bg-brand-lavender" : "bg-sand-300"
                      }`}
                    />
                  )}
                </div>

                {row.state === "next" ? (
                  <div className="min-w-0 flex-1 pb-4">
                    <div className="-ml-[12px] flex flex-col gap-1 border-l-2 border-brand-violet pb-[3px] pl-3 pt-px">
                      <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-brand-violet">
                        {row.status}
                      </div>
                      <div className="grid grid-cols-[150px_minmax(0,1fr)_90px] items-baseline gap-x-4">
                        <div className="text-[15px] font-medium tracking-[-0.01em] text-ink-900">
                          {row.label}
                        </div>
                        <div className="text-[13px] text-ink-600">
                          Automatic on {row.date}
                        </div>
                        <div />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`grid min-w-0 flex-1 grid-cols-[150px_minmax(0,1fr)_90px] items-baseline gap-x-4 ${
                      isLast ? "" : "pb-4"
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div
                        className={`text-[11px] uppercase tracking-[0.06em] ${
                          row.state === "paid"
                            ? "font-medium text-brand-violet"
                            : "text-ink-400"
                        }`}
                      >
                        {row.status}
                      </div>
                      <div
                        className={`text-[15px] font-medium tracking-[-0.01em] ${
                          row.state === "paid" ? "text-ink-900" : "text-ink-700"
                        }`}
                      >
                        {row.label}
                      </div>
                    </div>
                    <div className="text-[13px] text-ink-400">Due {row.date}</div>
                    <div
                      className={`text-right text-[15px] ${
                        row.state === "scheduled" ? "text-ink-700" : "text-ink-400"
                      }`}
                    >
                      {row.amount}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** The portal's timeline node, at preview scale: 10px rather than 12px. */
function Node({ state }: { state: Row["state"] }) {
  if (state === "next") {
    return (
      <div className="h-2.5 w-2.5 flex-none rounded-full border-[3px] border-brand-violet bg-white" />
    );
  }
  return (
    <div
      className={`h-2.5 w-2.5 flex-none rounded-full ${
        state === "paid" ? "bg-brand-violet" : "bg-sand-400"
      }`}
    />
  );
}
