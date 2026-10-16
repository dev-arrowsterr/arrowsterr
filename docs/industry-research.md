# Industry Research

The Audience tab of Competitive Analysis (Organic Research). It shows the websites, YouTube channels, podcasts, press, social accounts and subreddits that people who visit the brand's site use, from SparkToro, in that order. Every row except subreddits can be added to an outreach list. Websites, press and subreddits also show how many AI answers in the period cite them. Those are the places to get mentioned first.

## How it works
- An editor clicks Research my audience. `/api/industry` saves a `running` row in `industry_research` and queues an `industry` job.
- The job asks SparkToro for a report on "People who visit {domain}", then reads the 6 sections as they become ready. It checks back every minute and gives up after 45 minutes.
- A refresh is allowed once every 30 days per brand. It's part of the plan, so it never costs tasks.
- Every call's cost goes to `cost_ledger` as "industry research", at `SPARKTORO_CREDIT_USD` a credit ($0.10 by default).
- Settings: `SPARKTORO_API_KEY` (required), `SPARKTORO_API_URL` (default `https://api.sparktoro.com`).

## Not yet checked against the live API
SparkToro's pages list two path styles (`/v3/websites` and `/v3/search/websites`). The job tries the first and falls back to the second on a 404. Their reply format isn't public in detail, so `normalizeSection` reads the common field names and drops rows without a name. Test with the 200 free credits before turning it on for customers, and confirm with SparkToro that showing their data in Arrowsterr is allowed.

## Running cost a month

One refresh is 20 credits: the report (10), websites, press, Reddit and social (2 each), YouTube and podcasts (1 each).

| | Beta (50 teams, ~75 brands) | Growth (500 teams, ~750 brands) |
|---|---|---|
| Credits, one refresh per brand | ~1,500 | ~15,000 |
| SparkToro at $0.06 to $0.10 a credit (check) | ~$90 to $150 | ~$900 to $1,500 |
| Servers | $0 (runs on the current worker) | $0 |
| **Total** | **~$90 to $150** | **~$900 to $1,500** |
