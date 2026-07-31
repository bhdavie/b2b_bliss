import type { Metadata } from "next";
import { DM_Serif_Display, Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "600",
  style: "italic",
  variable: "--font-editorial",
  display: "swap",
});

// Bliss body face. Replaces Inter under the same `--font-body` variable, so
// every `font-body` opt-in switches together. app/inn/ never opts in and keeps
// the system stack.
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bliss",
  description: "Save-first payment plans for the booking economy.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${dmSerif.variable} ${fraunces.variable} ${instrumentSans.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
