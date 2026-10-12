# Momos Lead Routing

```
Framer form ──► Cloudflare Worker ──► { url } back to the form in ms ──► visitor lands on AE calendar
                      │
                      └─ in the background ─► Claude verifies the lead (web search)
                                              ──► structured JSON ──► Zapier ──► Salesforce + Slack
```

- `framer/LeadForm.tsx`: the Book a Demo form (Framer code component).
- `worker/`: the Cloudflare Worker.

## Routing

| Form | Region | AE |
|---|---|---|
| US / Canada / Mexico, Pacific or Mountain time zone | West Coast | James |
| US / Canada / Mexico, any other time zone | East Coast | Jill |
| UK, Europe, Turkey, UAE, Saudi, Qatar, Kuwait | Middle East / Europe | Jill |
| Australia, NZ, Southeast Asia, Japan, Korea, HK, India | APAC | James |
| "Other" | guessed from time zone | |

The form has no State field, so West vs East comes from the visitor's browser time zone.

The instant check turns away spam: a filled honeypot, a form filled in under 2 seconds, a bad email, or a throwaway email. Spam goes to `NOT_FIT_URL`. Every other lead gets a calendar right away. To send small brands away too, add `"1-5"` to `NOT_FIT_BUCKETS` in `worker/src/route.ts`.

## Claude verification

After the Worker answers the form, Claude Opus 5.5 checks the lead with up to 3 web searches: is the company real, is it F&B, how many locations it really has, does the person work there, and where is it based. It returns this JSON, which goes to Zapier:

```json
{
  "lead": { "first_name": "", "last_name": "", "email": "", "company": "", "job_title": "", "country": "", "locations": "" },
  "routing": { "status": "routed", "reason": "ok", "ae": "James", "region": "us_west", "redirect_url": "", "region_mismatch": false },
  "verification": {
    "verdict": "verified | suspicious | spam",
    "icp_fit": "fit | maybe | not_fit",
    "confidence": 0.92,
    "company_name": "", "company_website": "", "industry": "",
    "locations_claimed": "6-49", "locations_found": "18",
    "hq_country": "", "region": "us_west",
    "person_matches_company": true,
    "red_flags": [],
    "summary": "Two lines for the AE.",
    "sources": []
  },
  "utm": { "utm_source": "", "utm_medium": "", "utm_campaign": "", "utm_term": "", "utm_content": "", "utm_channel": "", "gclid_c": "" },
  "meta": { "timezone": "", "page_url": "", "referrer": "", "elapsed_ms": 0, "submitted_at": "" }
}
```

If Claude fails or takes over 25 seconds, the lead still goes to Zapier with `"verification": { "verdict": "unavailable" }`. Spam skips Claude but still goes to Zapier.

## Deploy the Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ZAPIER_HOOK_URL
npm run deploy
```

Booking links, the not-fit page and allowed origins are in `worker/wrangler.toml`.

## Framer

Paste `framer/LeadForm.tsx` into a Framer code file and set `ENDPOINT` to the Worker URL from the deploy step.

## Zapier

1. Trigger: **Webhooks by Zapier > Catch Hook** (not Raw). Copy its URL into the `ZAPIER_HOOK_URL` secret.
2. Delete the **AI by Zapier** step. Claude already sends clean fields.
3. **Salesforce Create Lead**: map `lead__*` and `utm__*` fields. You can put `verification__summary` in the description.
4. Optional **Filter**: only continue if `verification__verdict` is not `spam`.
5. **Slack** message:

```
{{routing__ae}} · {{routing__region}} · {{verification__verdict}} · ICP {{verification__icp_fit}}
{{lead__first_name}} {{lead__last_name}}, {{lead__job_title}} at {{verification__company_name}}
{{lead__email}} · {{lead__country}} · Locations: said {{lead__locations}}, found {{verification__locations_found}}
{{verification__summary}}
Red flags: {{verification__red_flags}}
```

## Test

```bash
cd worker
npm test        # routing, speed, and a full Worker run with Claude and Zapier faked
npm run typecheck
```
