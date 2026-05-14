import type { Config } from "tailwindcss";

// Bliss design tokens. Hex values mirror docs/hosted-page-spec.md so the
// hosted consumer page and the merchant dashboard stay visually coherent.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Lavender ramp: primary brand.
        lavender: {
          50: "#f6f5fd",
          100: "#eeedfe",
          200: "#dedcfc",
          300: "#bcb8f7",
          400: "#8d86ec",
          500: "#534ab7",
          600: "#4640a3",
          700: "#3c3489",
          800: "#312a6e",
          900: "#26215c",
        },
        navy: {
          DEFAULT: "#26215c",
          dark: "#1a1745",
        },
        cream: {
          DEFAULT: "#fbf8f3",
          dark: "#f3ede1",
        },
        "dusty-blue": {
          DEFAULT: "#b9c8db",
          dark: "#8aa1bd",
        },
        ink: {
          DEFAULT: "#111111",
          muted: "#555555",
          soft: "#888888",
        },
        surface: {
          DEFAULT: "#ffffff",
          subtle: "#f6f6f9",
          border: "#e3e3ec",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(38, 33, 92, 0.04), 0 1px 1px rgba(38, 33, 92, 0.03)",
      },
    },
  },
  plugins: [],
};

export default config;
