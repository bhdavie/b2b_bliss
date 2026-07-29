import { Caveat, Playfair_Display } from "next/font/google";

// Playfair Display (free high-contrast Didone, a Canela lookalike) for the
// Marbrook House hotel chrome serif headings. Scoped here on the route layout
// so `--font-playfair` is only defined for the Marbrook funnel: the tailwind
// `font-serif` token resolves to Playfair inside this subtree and falls back
// to the default serif stack everywhere else (e.g. the Hawthorn demo).
//
// This does not touch the Bliss wordmark (Georgia bold, set inline in
// BlissWordmark) or the Bliss heading/body faces (font-display / font-body).
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

// Caveat (handwriting) for the Marbrook House logo monogram only. Scoped on the
// same wrapper as Playfair so `--font-caveat` is in scope for the funnel.
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-caveat",
  display: "swap",
});

export default function MarbrookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${playfair.variable} ${caveat.variable}`}>{children}</div>
  );
}
