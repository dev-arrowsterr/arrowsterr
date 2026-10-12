# Momos Lead Router

Takes a demo request from the Framer form on momos.com, checks it, asks Claude if it fits the ICP, and sends the visitor straight to the right AE's calendar.

| Region | AE | Booking link (test) |
|---|---|---|
| West Coast (US Pacific + Mountain, western Canada) | James | https://calendar.app.google/LxFWWodxZMcd957n6 |
| East Coast (all other US states, rest of Canada) | Jill | https://www.momos.com/book-a-demo-us |
| Middle East / Europe / Africa | Jill | same as above |
| APAC | James | same as James above |
| Anywhere else (e.g. LATAM) | Jill | change in `src/config.ts` |

## How a lead flows

1. Visitor submits the form.
2. Fast checks (about 100 ms): email format, disposable domain, the domain has a mail server, website matches email, phone looks real, test words.
   Junk stops here and never costs a Claude call.
3. Claude reads the whole submission plus the checks and returns: a short summary, ICP fit (`fit` / `maybe` / `not_fit`), legit or spam, region and red flags.
4. Region comes from the form's country and state first. Claude only fills it in when the form doesn't say (it uses phone code, email domain, or the company's HQ).
5. `fit` and `maybe` go to the AE's calendar. `not_fit` and spam go to `NOT_A_FIT_URL`.
6. A Slack alert goes to the team with the summary (optional).

If Claude is slow or down, the lead is still routed on the form fields and the alert says so. No lead is lost.

## Two ways to hook up Framer

**A. Instant redirect (recommended).** Use the code component in `framer/LeadRouterForm.tsx`.
In Framer: Assets > Code > New file, paste it in, drop `LeadRouterForm` on the page, set **Router URL** to `https://<your-host>/api/route`.
The visitor lands on their AE's calendar a few seconds after they click submit.

**B. Keep the native Framer form.** Form > Send to > Webhook, URL `https://<your-host>/webhooks/framer`, copy the secret into `FRAMER_WEBHOOK_SECRET`.
Framer can only redirect to one fixed page, so with this option the routing shows up in Slack and the AE reaches out.

You can run both. A lead seen by both paths within 10 minutes is decided once and alerted once.

## Run it

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY, SLACK_WEBHOOK_URL, etc.
npm install
node --env-file=.env src/server.ts
npm test
```

Needs Node 22.18 or newer (runs TypeScript directly, no build step).

## Deploy on Render

- Root directory: `momos-lead-router`
- Build command: `npm ci`
- Start command: `npm start`
- Health check path: `/health`
- Add the variables from `.env.example`.

## Settings you will want to change

- `src/config.ts`: AEs, region-to-AE map, ICP text Claude reads, model, timeout.
- `src/regions.ts`: which states and countries belong to which region.
- `VERIFY_WITH_WEB=true` lets Claude look the company up on the web. Better accuracy, adds a few seconds.
