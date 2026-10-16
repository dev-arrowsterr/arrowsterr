import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

// The Arro game's pixel-style text.
const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// The product UI, in the style of Twenty: Inter at 13px.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Long-form pages that still use Geist.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Page titles and big headings: a little personality.
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Numbers, prompts and URLs inside product screens.
const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});


export const metadata: Metadata = {
  title: "Arrowsterr",
  description: "See how AI engines talk about your brand.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plex.variable} ${inter.variable} ${geist.variable} ${display.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full">
        <div className="aw flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
