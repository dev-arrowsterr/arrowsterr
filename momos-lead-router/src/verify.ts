import { resolveMx } from "node:dns/promises";
import type { Lead } from "./lead.ts";

export type Checks = {
  emailValid: boolean;
  emailDomain?: string;
  freeEmail: boolean;
  disposableEmail: boolean;
  domainAcceptsMail: boolean | null; // null = lookup timed out
  websiteMatchesEmail: boolean | null; // null = no website given
  phoneLooksReal: boolean | null; // null = no phone given
  looksLikeTest: boolean;
};

const FREE = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com", "zoho.com", "yandex.com",
  "qq.com", "163.com", "126.com", "naver.com", "hanmail.net", "rediffmail.com",
]);

const DISPOSABLE = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "fakeinbox.com", "throwawaymail.com", "mintemail.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const TEST_RE = /\b(test|testing|asdf|qwerty|lorem|ipsum|fake|sample|xxx)\b/i;

function rootDomain(host: string): string {
  return host.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
}

async function hasMx(domain: string, timeoutMs = 1500): Promise<boolean | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  // Only a clear "no such domain / no mail records" counts as false. Network trouble is null.
  const lookup = resolveMx(domain).then(
    (mx) => mx.length > 0,
    (err: NodeJS.ErrnoException) => (err.code === "ENOTFOUND" || err.code === "ENODATA" ? false : null),
  );
  return Promise.race([lookup, timeout]);
}

export async function runChecks(lead: Lead): Promise<Checks> {
  const email = lead.email ?? "";
  const emailValid = EMAIL_RE.test(email);
  const emailDomain = emailValid ? email.split("@")[1].toLowerCase() : undefined;
  const freeEmail = !!emailDomain && FREE.has(emailDomain);
  const disposableEmail = !!emailDomain && DISPOSABLE.has(emailDomain);
  const domainAcceptsMail = emailDomain ? await hasMx(emailDomain) : false;

  let websiteMatchesEmail: boolean | null = null;
  if (lead.website && emailDomain) {
    const site = rootDomain(lead.website);
    websiteMatchesEmail = site === emailDomain || site.endsWith("." + emailDomain) || emailDomain.endsWith("." + site);
  }

  let phoneLooksReal: boolean | null = null;
  if (lead.phone) {
    const digits = lead.phone.replace(/\D/g, "");
    phoneLooksReal = digits.length >= 7 && digits.length <= 15 && !/^(\d)\1+$/.test(digits);
  }

  const text = [lead.firstName, lead.lastName, lead.company, email].join(" ");
  return {
    emailValid,
    emailDomain,
    freeEmail,
    disposableEmail,
    domainAcceptsMail,
    websiteMatchesEmail,
    phoneLooksReal,
    looksLikeTest: TEST_RE.test(text),
  };
}
