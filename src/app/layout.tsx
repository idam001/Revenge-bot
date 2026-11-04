import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "REVENGE GPT — Built by Idam Emmanuel",
  description:
    "A Claude-style AI workspace with free keyless models, live Artifacts, extended thinking, and a universal API key vault. Built by Idam Emmanuel.",
  applicationName: "REVENGE GPT",
  appleWebApp: {
    capable: true,
    title: "REVENGE GPT",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#262624",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="claude-dark">
      <body className="antialiased selection:bg-[#d97757]/30">{children}</body>
    </html>
  );
}
