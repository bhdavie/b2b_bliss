/**
 * Pins the document root font-size to 14px and the inherited font-weight to
 * 400 for the whole /inn/ subtree, so the demo funnels keep their current
 * metrics and colour of text when the app tokens move underneath them.
 *
 * Marbrook is a structural replica of the Mews Distributor and has to render
 * exactly as built. Both of Tailwind's rem-based scales matter here, not just
 * type: across the three routes there are ~1000 rem-based utility values, and
 * roughly 780 of them are spacing (p-*, m-*, gap-*), not text. A root move
 * would reflow all of it.
 *
 * This has to re-declare the ROOT. `rem` always resolves against <html>, and
 * there is no way to rescope it for a subtree, so a font-size on a wrapper
 * element would insulate nothing — it would only affect inherited sizing and
 * `em`, leaving every rem utility resolving against the new root.
 *
 * Both `html` and `body` are pinned, mirroring the `html, body` rule in
 * globals.css. Pinning only `html` would keep `rem` correct but let `body`
 * take the new value, which would shift every piece of text that has no
 * explicit size class and inherits from body instead.
 *
 * `font-weight:400` is here for the same reason. globals.css now sets
 * `body { font-weight: 500 }` as the app-wide default, which would otherwise
 * inherit into every text node in this subtree that carries no weight class.
 * The funnels were built against the browser default of 400.
 *
 * `html:root` scores (0,1,1) and `html:root body` (0,1,2), against globals.css
 * at (0,0,1), so both win on specificity rather than on source order.
 * Tailwind v3's `@layer base` is a build-time directive rather than a native
 * CSS cascade layer, so no layer precedence is involved either.
 *
 * CONSTRAINT: while an /inn/ route is mounted this is a DOCUMENT-level
 * override, not a subtree-scoped one. That is acceptable only because the /inn/
 * routes are standalone full pages that are never embedded inside another
 * surface. If an /inn/ view is ever rendered within a Bliss page, this pin
 * would shrink that host page's root as well — revisit the approach then.
 */
export default function InnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`html:root,html:root body{font-size:14px;font-weight:400}`}</style>
      {children}
    </>
  );
}
