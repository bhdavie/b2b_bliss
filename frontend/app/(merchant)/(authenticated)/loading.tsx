/**
 * Route-group loading fallback for every merchant screen.
 *
 * One file at the group level rather than nine per-route ones: the sidebar and
 * the page frame come from the layout and stay put, so all this ever replaces is
 * the content column, and every screen in the group opens the same way — a 44px
 * title over an 18px subtitle, then panels. A skeleton of that shared head fits
 * all nine routes; a per-route skeleton would only differ below the fold, where
 * it is on screen too briefly to be worth nine files that can drift.
 *
 * Deliberately static. An animated pulse on a 60-100ms warm navigation reads as
 * a flash rather than as progress, so the bars just sit there; the point is that
 * the screen changes the instant a nav item is clicked, not that it entertains.
 *
 * Geometry mirrors PageHeader (44px title, 2.5 gap, 18px subtitle, mb-12) and
 * Panel's filled variant (20px radius, sand-50 fill, no border), so the real
 * page lands on the same marks the skeleton was holding.
 */
export default function MerchantLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex max-w-[980px] flex-col"
    >
      {/* Page head: title bar over subtitle bar, at PageHeader's metrics. */}
      <div className="mb-12 flex flex-col gap-2.5">
        <div className="h-11 w-[260px] rounded-md bg-sand-100" />
        <div className="h-[18px] w-[420px] max-w-full rounded-md bg-sand-100" />
      </div>

      {/* Section kicker, then the first panel. */}
      <div className="mb-5 h-[13px] w-[120px] rounded-md bg-sand-100" />
      <div className="flex flex-col gap-5 rounded-panel bg-sand-50 px-7 py-[30px]">
        <div className="h-[15px] w-[180px] rounded-md bg-sand-100" />
        <div className="h-px w-full bg-sand-100" />
        <div className="h-[15px] w-[320px] max-w-full rounded-md bg-sand-100" />
        <div className="h-[15px] w-[240px] max-w-full rounded-md bg-sand-100" />
        <div className="h-[15px] w-[280px] max-w-full rounded-md bg-sand-100" />
      </div>
    </div>
  );
}
