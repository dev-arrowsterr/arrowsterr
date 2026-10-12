import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// The product UI: a console feel, the same type as the landing pages.
const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Long reading: the document editor and client-facing shared reports.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// Numbers, prompts and URLs inside product screens.
const mono = JetBrains_Mono({
  variable: "--font-mono-jb",
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
      className={`${plex.variable} ${inter.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full">
        <div className="aw flex min-h-screen flex-col">{children}</div>
      </body>
    </html>
  );
}
