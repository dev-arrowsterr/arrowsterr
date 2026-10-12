# Momos Lead Router

One script you paste into Framer. When someone submits the Book a Demo form it:

1. Reads the form and decides the AE right in the browser (about 0.6 ms in Chrome, 8 microseconds for the decision itself).
2. Sends the visitor straight to that AE's calendar.
3. Fires the lead plus the routing decision to your Zapier hook in the background (`sendBeacon`, so the redirect never waits on Zapier). Zapier then does Salesforce and Slack.

| Region | AE |
|---|---|
| West Coast (US Pacific + Mountain time, western Canada) | James |
| APAC | James |
| East Coast (all other US states, rest of Canada) | Jill |
| Middle East / Europe / Africa | Jill |
| Anywhere else | Jill |

Region comes from the form's Country and State. If State or Country is blank, the visitor's own time zone fills the gap.

ICP rule: fewer than `minLocations` (default 3) is not a fit and goes to `notFitUrl`. A blank locations answer still gets routed. Bad or throwaway emails and "test" entries are rejected.

## Install in Framer

1. Open `momos-router.html` and set `zapierHook` at the top to your Zapier Catch Hook URL.
2. Framer > Site Settings > General > Custom Code > **End of `<body>` tag** > paste the whole file. Publish.

The script only takes over forms that have both an email and a company field, so newsletter forms are left alone. It replaces the Framer form's own "Send to" and redirect for the demo form.

## Zapier

The script posts these fields (form-encoded):

`email, first_name, last_name, company, job_title, phone, country, state, locations, utm_source, utm_channel, utm_medium, utm_campaign, utm_term, utm_content, gclid_c, ae, region, icp, icp_reason, redirect_url, route_ms, timezone, page_url, referrer, submitted_at` plus every original form field by its Framer name.

To make the Zap faster:

1. Change step 1 from **Catch Raw Hook** to **Catch Hook**. Zapier then splits the fields for you.
2. Delete the **AI by Zapier** extract step. The fields already arrive clean.
3. Map the fields straight into **Salesforce Create Lead**.
4. Slack message example:

```
New lead for {{ae}} ({{region}}) - ICP: {{icp}} ({{icp_reason}})
{{first_name}} {{last_name}}, {{job_title}} at {{company}}
{{email}} · {{phone}} · {{country}} {{state}}
Locations: {{locations}} · Source: {{utm_source}} / {{utm_campaign}}
```

Add a Filter step before Slack on `icp` if you don't want rejected leads posted.

## Change settings

All at the top of `momos-router.html`: booking links, `notFitUrl`, `minLocations`, the region lists, and the `ROUTES` map.

## Test

```bash
node --test tests/*.test.mjs
```
