import type { Config } from "tailwindcss";

// Bliss brand palette. Role-keyed tokens — utility classes elsewhere should
// reference these by role (brand-navy, brand-purple, brand-lavender, etc.)
// rather than introducing new hex values.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          // Primary: headers, primary buttons, nav, primary UI chrome.
          navy: "#51576A",
          "navy-dark": "#3F4453",
          // Secondary surfaces, borders, hover states, data fills.
          dusty: "#97ACC8",
          // Interactive text on light backgrounds: links, accents.
          purple: "#6A629E",
          "purple-dark": "#564E89",
          // High-emphasis accent. A distinct hue from `purple` (265deg vs
          // 248deg) at roughly three times the saturation, not a shade of it —
          // do not use it as a hover state for `purple`. Clears AAA on white
          // (9.3:1), so unlike `lavender` it is safe as text.
          violet: "#5A1BB5",
          // Deep violet: text ON lavender (the sidebar avatar, 6.75:1) and
          // link hover. A text tone, not a hover fill for `violet`.
          "violet-deep": "#3F0F87",
          // Violet wash: active nav pill, selected option cards. Fill only —
          // `violet` sits on it at 8.25:1.
          "violet-tint": "#F4EFFF",
          // Fill-only highlight: active-state fills, badges, selected pills,
          // progress fills. Never use as text on a light background.
          lavender: "#C9AFFA",
          // Warm page/card background.
          cream: "#E0DACD",
          // Neutral dividers and secondary background.
          neutral: "#D9D9D9",
        },
        // Warm neutral ramp from the design export. Additive: `brand.neutral`
        // and `brand.cream` stay defined for surfaces not yet migrated. The
        // steps are genuinely close together (200-500 span 14 units); that is
        // the design's own granularity, not padding.
        sand: {
          50: "#FAF9F7", // sidebar, raised panel
          100: "#F0EDE9", // warm sunk panel
          200: "#EAE7E2", // default border — the workhorse
          300: "#E8E5E0", // inactive timeline rail
          400: "#E2DED8", // future timeline node
          500: "#DCD8D2", // secondary-button border
          600: "#C9C6C1", // stronger divider
        },
        ink: {
          DEFAULT: "#111111",
          muted: "#6B6B6B",
          // Numeric text ramp from the design. DEFAULT and muted are left
          // untouched so the 235 existing text-ink / text-ink-muted sites do
          // not move; components opt into these as they are restyled.
          900: "#111112", // primary text
          700: "#3A3A3F", // secondary
          600: "#5C5C62", // nav resting
          500: "#6D6D73", // body muted
          400: "#8A8A8F", // micro-labels — most-used colour in the design
          300: "#A5A5AA", // faintest
        },
      },
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
      boxShadow: {
        card: "0 1px 2px rgba(81, 87, 106, 0.06), 0 1px 1px rgba(81, 87, 106, 0.04)",
        // Real card elevation, navy-tinted to match the brand shadow color.
        elevated:
          "0 1px 3px rgba(81, 87, 106, 0.10), 0 8px 24px -6px rgba(81, 87, 106, 0.10)",
        "elevated-lg":
          "0 2px 4px rgba(81, 87, 106, 0.10), 0 16px 36px -8px rgba(81, 87, 106, 0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
