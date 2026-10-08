"use client";

import { BrandLogo } from "./BrandLogo";

export const ENGINE_LOGOS: Record<string, string> = {
  ChatGPT: "https://arrowsterr.com/wp-content/uploads/2026/10/ChatGPT-Logo.jpg",
  Claude: "https://arrowsterr.com/wp-content/uploads/2026/10/Claude-Logo.webp",
  Gemini: "https://arrowsterr.com/wp-content/uploads/2026/10/Gemini-Logo.webp",
  Perplexity: "https://www.google.com/s2/favicons?domain=perplexity.ai&sz=128",
  "AI Overview": "https://www.google.com/s2/favicons?domain=google.com&sz=128",
  "AI Mode": "https://www.google.com/s2/favicons?domain=google.com&sz=128",
};

export function EngineName({ engine, size = 18 }: { engine: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <BrandLogo src={ENGINE_LOGOS[engine] ?? ""} name={engine} size={size} />
      {engine}
    </span>
  );
}

