/**
 * Route-group loading fallback for every merchant screen.
 *
 * One file at the group level rather than nine per-route ones: the sidebar and
 * the page frame come from the layout and stay put, so all this ever replaces is
 * the content column, and every screen in the group now opens the same way —
 * straight into a panel. A per-route skeleton would only differ below the fold,
 * where it is on screen too briefly to be worth nine files that can drift.
 *
 * Deliberately static. An animated pulse on a 60-100ms warm navigation reads as
 * a flash rather than as progress, so the bars just sit there; the point is that
 * the screen changes the instant a nav item is clicked, not that it entertains.
 *
 * Geometry mirrors Panel's filled variant (20px radius, white fill, sand-200
 * border) so the real page lands on the same marks the skeleton was holding.
 * The fill tracks the card colour, which is white since the surfaces were
 * flipped; sand-50 here would flash a recessed card.
 */
export default function MerchantLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col"
    >
      {/* The 44px title bar and 18px subtitle bar that used to open this
          skeleton are gone with the page headers themselves. Left in, they
          drew a header the real page no longer has, so every merchant
          navigation flashed a phantom head and then jumped the content up by
          about 110px when the route resolved. */}
      <div className="flex flex-col gap-3 rounded-card border border-sand-200 bg-white p-5">
        <div className="h-[15px] w-[180px] rounded-md bg-sand-100" />
        <div className="h-px w-full bg-sand-100" />
        <div className="h-[15px] w-[320px] max-w-full rounded-md bg-sand-100" />
        <div className="h-[15px] w-[240px] max-w-full rounded-md bg-sand-100" />
        <div className="h-[15px] w-[280px] max-w-full rounded-md bg-sand-100" />
      </div>
    </div>
  );
}
