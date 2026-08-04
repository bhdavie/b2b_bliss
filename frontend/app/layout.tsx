import type { Metadata } from "next";
import {
  Archivo,
  DM_Serif_Display,
  Fraunces,
  Instrument_Sans,
  Inter,
} from "next/font/google";
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

// Inter, under `--font-inter`. Declared here rather than on a component so the
// variable is in scope document-wide and any surface can opt in with
// `font-inter`. Like the others it only registers a variable — it sets no
// family on its own, so nothing changes font by this being loaded.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Archivo, under `--font-archivo`. Same deal as Inter above: registers a
// variable document-wide and sets no family itself, so surfaces opt in with
// `font-archivo`.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
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
      className={`${dmSerif.variable} ${fraunces.variable} ${instrumentSans.variable} ${inter.variable} ${archivo.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
