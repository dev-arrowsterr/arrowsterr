import type { Region } from "./config.ts";

// Pacific, Mountain, Alaska and Hawaii states count as West Coast.
// Every other state (Central and Eastern time) goes to East Coast.
const US_WEST = new Set([
  "WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "CO", "AZ", "NM", "AK", "HI",
]);

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

// Western Canada follows the US West Coast; the rest of Canada goes East.
const CA_WEST = new Set(["BC", "AB", "YT", "NT", "british columbia", "alberta", "yukon"]);

const APAC = [
  "singapore", "malaysia", "indonesia", "thailand", "vietnam", "philippines", "brunei",
  "cambodia", "myanmar", "laos", "australia", "new zealand", "japan", "south korea", "korea",
  "china", "hong kong", "taiwan", "macau", "india", "sri lanka", "bangladesh", "pakistan",
  "nepal", "maldives", "mongolia", "fiji", "papua new guinea",
];

const EMEA = [
  "united kingdom", "uk", "england", "scotland", "wales", "ireland", "france", "germany",
  "spain", "portugal", "italy", "netherlands", "belgium", "luxembourg", "switzerland",
  "austria", "denmark", "sweden", "norway", "finland", "iceland", "poland", "czechia",
  "czech republic", "slovakia", "hungary", "romania", "bulgaria", "greece", "croatia",
  "slovenia", "serbia", "estonia", "latvia", "lithuania", "ukraine", "cyprus", "malta",
  "turkey", "türkiye", "united arab emirates", "uae", "saudi arabia", "ksa", "qatar",
  "kuwait", "bahrain", "oman", "jordan", "lebanon", "israel", "egypt", "morocco",
  "south africa", "nigeria", "kenya", "ghana", "tunisia", "algeria",
];

const US_NAMES = ["united states", "united states of america", "usa", "us", "u.s.", "u.s.a.", "america"];
const CA_NAMES = ["canada", "ca"];

function norm(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function usStateCode(state: string | undefined): string | undefined {
  const s = norm(state);
  if (!s) return undefined;
  if (s.length === 2) return s.toUpperCase();
  return US_STATE_NAMES[s];
}

// Best guess from form fields alone. Returns "unknown" when the form doesn't say.
export function regionFromLocation(country?: string, state?: string): Region {
  const c = norm(country);
  if (US_NAMES.includes(c) || (!c && usStateCode(state) && US_STATE_NAMES[norm(state)])) {
    const code = usStateCode(state);
    if (!code) return "unknown";
    return US_WEST.has(code) ? "us_west" : "us_east";
  }
  if (CA_NAMES.includes(c)) {
    const s = norm(state);
    if (!s) return "unknown";
    return CA_WEST.has(s) || CA_WEST.has(s.toUpperCase()) ? "us_west" : "us_east";
  }
  if (APAC.includes(c)) return "apac";
  if (EMEA.includes(c)) return "emea";
  return "unknown";
}
