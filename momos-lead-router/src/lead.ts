import { createHmac, timingSafeEqual } from "node:crypto";

export type Lead = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  jobTitle?: string;
  country?: string;
  state?: string;
  city?: string;
  locations?: string;
  message?: string;
  // Every field exactly as the form sent it, so Claude sees things we don't map.
  raw: Record<string, unknown>;
};

// Form field names change often, so we match on loose aliases.
const ALIASES: Record<Exclude<keyof Lead, "raw">, string[]> = {
  firstName: ["firstname", "first", "fname", "givenname"],
  lastName: ["lastname", "last", "lname", "surname", "familyname"],
  email: ["email", "workemail", "businessemail", "emailaddress"],
  phone: ["phone", "phonenumber", "mobile", "tel", "telephone"],
  company: ["company", "companyname", "brand", "brandname", "organization", "organisation", "restaurant", "business", "businessname"],
  website: ["website", "companywebsite", "url", "site", "domain"],
  jobTitle: ["jobtitle", "title", "role", "position"],
  country: ["country", "countryregion", "region", "market"],
  state: ["state", "province", "stateprovince", "county"],
  city: ["city", "town"],
  locations: ["locations", "numberoflocations", "nooflocations", "locationcount", "outlets", "numberofoutlets", "stores", "numberofstores", "howmanylocations"],
  message: ["message", "comments", "notes", "anythingelse", "howcanwehelp", "details"],
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalizeLead(body: Record<string, unknown>): Lead {
  const lead: Lead = { raw: body };
  const byKey = new Map(Object.entries(body).map(([k, v]) => [key(k), v]));
  for (const [field, aliases] of Object.entries(ALIASES) as [Exclude<keyof Lead, "raw">, string[]][]) {
    for (const alias of aliases) {
      const v = byKey.get(alias);
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        lead[field] = String(v).trim();
        break;
      }
    }
  }
  if (!lead.firstName && !lead.lastName) {
    const full = byKey.get("name") ?? byKey.get("fullname") ?? byKey.get("yourname");
    if (full) {
      const [first, ...rest] = String(full).trim().split(/\s+/);
      lead.firstName = first;
      if (rest.length) lead.lastName = rest.join(" ");
    }
  }
  return lead;
}

// Framer signs each webhook: header `Framer-Signature: sha256=<hex>`, where hex is
// HMAC-SHA256(secret, rawBody + submissionId) and submissionId is the
// `Framer-Webhook-Submission-Id` header.
export function verifyFramerSignature(
  rawBody: string,
  signature: string | undefined,
  submissionId: string | undefined,
  secret: string,
): boolean {
  if (!signature || !submissionId) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody + submissionId).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
