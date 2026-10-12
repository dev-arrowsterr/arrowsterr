// Everything a sales lead would want to change lives in this file.

export type Region = "us_west" | "us_east" | "emea" | "apac" | "unknown";

export type AE = { name: string; bookingUrl: string };

export const AES = {
  james: {
    name: "James",
    bookingUrl: process.env.JAMES_BOOKING_URL ?? "https://calendar.app.google/LxFWWodxZMcd957n6",
  },
  jill: {
    name: "Jill",
    bookingUrl: process.env.JILL_BOOKING_URL ?? "https://www.momos.com/book-a-demo-us",
  },
} satisfies Record<string, AE>;

// Region -> AE. "unknown" covers anywhere we can't place (e.g. Latin America).
export const ROUTES: Record<Region, AE> = {
  us_west: AES.james,
  us_east: AES.jill,
  emea: AES.jill,
  apac: AES.james,
  unknown: AES.jill,
};

export const NOT_A_FIT_URL = process.env.NOT_A_FIT_URL ?? "https://www.momos.com/thank-you";

// Claude reads this to decide ICP fit. Edit in plain English.
export const ICP = `
Momos sells a customer experience and reputation platform (reviews, social, messaging, AI agents) to restaurant and food & beverage brands.

A good fit (ICP) is:
- A restaurant, cafe, bar, QSR, bakery, F&B franchise, or hospitality group.
- Usually 5 or more locations, or a franchisor / brand HQ. 3-4 locations is a maybe if they are growing.
- The person works at that brand (owner, founder, marketing, ops, CX, digital, IT, franchise lead).

Not a fit:
- Single-location independents with no plans to grow.
- Agencies, vendors, partners pitching their own product, investors, job seekers, students, press.
- Personal email with no company we can identify, fake or test entries, spam.
- Non-F&B businesses (retail, clinics, salons) unless they clearly run food service at many sites.
`.trim();

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
export const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 12000);
export const VERIFY_WITH_WEB = process.env.VERIFY_WITH_WEB === "true";
