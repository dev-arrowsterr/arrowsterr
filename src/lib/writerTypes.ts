// Shared by the server and the browser: the brand guideline and the writing assistant's messages.

export type BrandGuideline = {
  summary: string;
  audience: string;
  voice: { tone: string[]; do: string[]; dont: string[]; sample: string };
  vocabulary: { use: string[]; avoid: string[] };
  writing: string[];
  ctas: string[];
  colors: { name: string; hex: string; use: string }[];
  typography: { headings: string; body: string; notes: string };
  ui: { buttons: string; corners: string; spacing: string; imagery: string };
  css: string;
  logo: string | null;
  at: string;
};

export type ChatMessage = { role: "user" | "assistant"; text: string };
