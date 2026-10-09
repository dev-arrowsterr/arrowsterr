// The content brief and the Google results analysis behind it. Shared by the server and the browser.

export type SerpPage = {
  rank: number;
  url: string;
  domain: string;
  title: string;
  description: string;
  read: boolean;
  words: number;
  headings: string[];
  schema: string[];
  tables: number;
  images: number;
  videos: number;
  lists: number;
  updated: string | null;
};
export type Serp = { pages: SerpPage[]; questions: string[]; related: string[]; features: string[]; aiOverview: { shown: boolean; text: string; cites: { domain: string; url: string }[] } };
export type Analysis = {
  intent: string;
  format: string;
  formatWhy: string;
  wordRange: string;
  mustCover: string[];
  gaps: string[];
  aiOverview: string;
  actions: string[];
  pages: { url: string; format: string; strength: string; weakness: string }[];
};
export type BriefDoc = {
  titles: string[];
  metaDescription: string;
  slug: string;
  h1: string;
  wordCount: string;
  outline: { h2: string; h3: string[]; notes: string }[];
  questions: string[];
  terms: string[];
  internalLinks: { url: string; anchor: string }[];
  sources: string[];
  makeItYours: string[];
  aiTips: string[];
};
/** The parts of the brief that follow the agency template: positioning, goals, LEMA answers and a guided outline. */
export type BriefTemplate = {
  positioning: { who: string; whereTo: string; howTo: string; whySo: string };
  goals: string[];
  lema: { knows: string[]; wants: string[]; shouldKnow: string[]; action: string };
  outline: { section: string; guide: string }[];
};
export type Brief = {
  serp: Serp;
  analysis: Analysis;
  brief: BriefDoc;
  template?: BriefTemplate;
  doc?: string; // the brief document as edited in Arrowsterr, as HTML
  docAt?: string;
  at: string;
  cost: number;
};

