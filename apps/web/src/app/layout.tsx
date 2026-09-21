import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Proofwork — Trust the outcome, not the claim", template: "%s · Proofwork" },
  description: "Proofwork independently verifies whether an AI employee completed an authorized business action, then recovers confirmed incomplete work within explicitly granted permissions.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#f3f5f6", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${plexMono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-float">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
