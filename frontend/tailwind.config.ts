import type { Config } from "tailwindcss";

// Bliss brand palette. Role-keyed tokens — utility classes elsewhere should
// reference these by role (brand-navy, brand-purple, brand-lavender, etc.)
// rather than introducing new hex values.
//
// Exported, and not inlined into `theme.extend`, because two consumers cannot
// take a utility class and must read the values as JavaScript: the Stripe
// Elements iframe (see lib/stripeElementColors.ts) and the rgba() shadows
// below. Every hex in the palette is written down exactly once, here, so a
// palette swap is a single-file edit and a hex search finds every definition.
export const palette = {
  brand: {
    // Primary type. Was a navy; the amethyst set has no navy, so both steps
    // collapse onto `ink` and the token names are now historical.
    navy: "#17131C",
    "navy-dark": "#17131C",
    // Borders and secondary surfaces. Was a dusty blue, now the hairline.
    dusty: "#E9E5E1",
    // Secondary type. Was a muted purple, now the neutral muted tone.
    purple: "#6E6878",
    "purple-dark": "#5B21B6",
    // The action colour. NOTE: amethyst is far lighter than the violet it
    // replaces — 4.23:1 on white where the old value was 9.30:1. That is
    // AA for large text only, and it no longer clears AA for body copy.
    // Treat as a fill and a large-text accent, not a body-text colour.
    violet: "#8B5CF6",
    // Deep amethyst: text ON tint40 (the sidebar avatar, 5.78:1) and link
    // hover. A text tone, not a hover fill for `violet`.
    "violet-deep": "#5B21B6",
    // Amethyst wash: active nav pill, selected option cards. Fill only —
    // `violet` sits on it at 3.72:1, large text only.
    "violet-tint": "#F3EEFE",
    // tint40. Fill-only highlight: active-state fills, badges, selected
    // pills, progress fills. Never use as text on a light background, and
    // never put white text on it — see the balance_due pill.
    lavender: "#D6C8FB",
    // Hover fill for `lavender` CTAs, and only that. Derived one step down
    // from tint40 at the same hue: L 88.4% -> 84.3%, matching the step the
    // old lavender/hover pair used.
    "lavender-hover": "#C8B4FA",
    // Recessed layer. Was a warm cream, now the sunken neutral.
    cream: "#F6F4F1",
    // Neutral dividers and secondary background.
    neutral: "#E9E5E1",
  },
  // Neutral ramp. 50-300 come straight from the amethyst set. 400-600 are
  // derived: they descend from `hairline` toward `muted` and are deliberately
  // COOL (B>R>G, hue ~265deg) rather than the old warm sand, so they sit next
  // to amethyst instead of fighting it. 400 carries the unpaid state in the
  // payment timeline, which is why it stays as light as it does — see the
  // contrast note on `brand.violet`.
  sand: {
    50: "#FDFCFB", // bone — sidebar, raised panel
    100: "#F6F4F1", // sunken — recessed panel
    200: "#E9E5E1", // hairline — default border, the workhorse
    300: "#E9E5E1", // inactive timeline rail
    400: "#E2DEE6", // future timeline node — L 74.1%, 3.19:1 vs amethyst
    500: "#CBC6D2", // secondary-button border — L 57.7%
    600: "#A9A3B4", // stronger divider — L 37.9%
    // Two neutrals that sit off the numeric ramp — `track` falls between 50
    // and 100, `badge` between 200 and 300 — so they are keyed by role
    // rather than wedged in as half-steps. Both belong to the bookings tab
    // control: the pill-group track, and the count badge on an inactive tab.
    track: "#F6F4F1",
    badge: "#E9E5E1",
  },
  ink: {
    DEFAULT: "#17131C",
    muted: "#6E6878",
    // Numeric text ramp. DEFAULT/900 and muted/700/600/500 collapse onto the
    // two type tones the amethyst set defines; 400 and 300 are derived
    // lighter steps above `muted`, holding its hue (~263deg) and stepping
    // lightness the way the old ramp did.
    900: "#17131C", // primary text
    700: "#6E6878", // secondary
    600: "#6E6878", // nav resting
    500: "#6E6878", // body muted
    400: "#898294", // micro-labels — 3.69:1 on white, large text only
    300: "#A39EAC", // faintest — 2.61:1 on white, decorative only
  },
  // Invalid-input red. Tailwind's stock red-700, which is what the ~30
  // form-error sites already reach for as `text-red-700`; naming it here
  // is for the one consumer that cannot use a class, the Stripe Elements
  // iframe. Left at the stock value deliberately — it is a state colour,
  // not a brand colour, and a palette swap should not drag it along.
  danger: "#b91c1c",
};

/**
 * "#51576A" -> "81, 87, 106".
 *
 * Shadow colours have to be written as rgba() so they can carry an alpha, and
 * a channel triplet typed out by hand is a second copy of the value that a hex
 * search will never turn up. Deriving it keeps `palette` the only place the
 * colour is spelled out.
 */
function channels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const navyChannels = channels(palette.brand.navy);
const violetChannels = channels(palette.brand.violet);

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: palette,
      fontFamily: {
        // UNCHANGED — system stack. Hawthorn body uses this; do not repoint.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Bliss body face (Instrument Sans, via next/font). Opt-in on Bliss
        // wrappers. app/inn/ never opts in, so repointing this leaves the
        // Marbrook and Hawthorn funnels on the system stack, unchanged.
        body: [
          "var(--font-body)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Inter. `--font-inter` is registered document-wide by app/layout.tsx,
        // so this is opt-in per surface — currently the sign-in shell only.
        inter: [
          "var(--font-inter)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Archivo. Same arrangement as `inter`: `--font-archivo` is registered
        // document-wide by app/layout.tsx and surfaces opt in per wrapper.
        archivo: [
          "var(--font-archivo)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Bliss heading face (DM Serif Display).
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        // Bliss editorial accent (Fraunces italic 600). Pair with `italic`.
        editorial: ["var(--font-editorial)", "ui-serif", "Georgia", "serif"],
        // Hotel-chrome serif. Resolves to Playfair Display ONLY where
        // `--font-playfair` is in scope (the Marbrook funnel sets it on its
        // route layout). Everywhere else the variable is undefined, so the
        // var() fallback keeps the prior default serif stack — Hawthorn stays
        // visually unchanged. Single-element array so the comma-bearing
        // fallback survives Tailwind's join.
        serif: [
          'var(--font-playfair, ui-serif, Georgia, Cambria, "Times New Roman", Times, serif)',
        ],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        // Large panels. Named `panel` rather than `xl` so Tailwind's stock
        // rounded-xl is not shadowed. Buttons use the stock rounded-full,
        // which renders identically to the design's 100px at these heights.
        panel: "20px",
      },
      // All four are brand colours at an alpha. They read from `palette` via
      // `channels()` rather than repeating a triplet, so `brand.navy` and
      // `brand.violet` stay the single definition of their own value.
      boxShadow: {
        card: `0 1px 2px rgba(${navyChannels}, 0.06), 0 1px 1px rgba(${navyChannels}, 0.04)`,
        // Real card elevation, navy-tinted to match the brand shadow color.
        elevated: `0 1px 3px rgba(${navyChannels}, 0.10), 0 8px 24px -6px rgba(${navyChannels}, 0.10)`,
        "elevated-lg": `0 2px 4px rgba(${navyChannels}, 0.10), 0 16px 36px -8px rgba(${navyChannels}, 0.14)`,
        // Violet halo on focused inputs. Lives here rather than as an
        // arbitrary shadow on .input so the violet is a token reference and
        // not an rgba() that a hex search walks straight past.
        "focus-ring": `0 0 0 4px rgba(${violetChannels}, 0.10)`,
      },
    },
  },
  plugins: [],
};

export default config;
