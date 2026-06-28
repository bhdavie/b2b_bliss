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
          // Fill-only highlight: active-state fills, badges, selected pills,
          // progress fills. Never use as text on a light background.
          lavender: "#C9AFFA",
          // Warm page/card background.
          cream: "#E0DACD",
          // Neutral dividers and secondary background.
          neutral: "#D9D9D9",
        },
        ink: {
          DEFAULT: "#111111",
          muted: "#6B6B6B",
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
        // Bliss body face (Inter, via next/font). Opt-in on Bliss wrappers.
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
      },
      boxShadow: {
        card: "0 1px 2px rgba(81, 87, 106, 0.06), 0 1px 1px rgba(81, 87, 106, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
