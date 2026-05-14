import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
