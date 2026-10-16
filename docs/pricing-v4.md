# Pricing v4, free tools and social listening

Plan, not built yet. Costs come from `cost_ledger` (Oct 9 to 15, 2026) unless marked estimate. Prices marked "check" weren't confirmed on the vendor's own page.

## What things cost us

| Unit | Cost | Source |
|---|---|---|
| One AI answer (ChatGPT, Gemini, AI Overviews, AI Mode via DataForSEO, plus Haiku parsing) | $0.0017 | measured, 1,267 checks |
| One Claude answer with web search | ~$0.025 | estimate, `meter.ts` prices |
| One Perplexity answer | ~$0.006 | estimate, `engines.ts` prices |
| One tracked prompt for a month (4 AIs daily, 2 weekly) | ~$0.35 | from the rows above |
| One task | ~$0.005 | `plans.ts` |
| Keyword report / keyword gap / AI Snapshot | $0.054 / $0.065 / $0.10 | measured / measured / `snapshot/route.ts` |

## Plans

| Plan | Monthly (yearly) | Prompts | Tasks/mo | Seats | Social keywords | Adds | Our cost: full use / typical |
|---|---|---|---|---|---|---|---|
| Free | $0 | 10, weekly, ChatGPT + AI Overviews | 200 | 1 | 0 | Traffic with AI visits (10k), Zippie audit only | $1.15 / $0.40 |
| Starter | $49 ($42) | 50 daily | 3,000 | 3 | 3 | Both toolsets, briefs, Zippie fixes | $36 / $24 |
| Pro | $149 ($127) | 150 daily | 8,000 | 5 | 10 | Agentic Writer, Slack, API, MCP | $107 / $76 |
| Agency | $399 ($339) | 400 daily | 25,000 | 15 | 30 | White-label, client reports | $306 / $220 |
| Enterprise | from $1,500 | 1,000+ | 150,000 | Unlimited | Custom | SSO, custom limits | $1,100+ / $700+ |

- Trial: 7 days of Pro, no card. When it ends the workspace drops to Free, not read-only.
- Starter opens both toolsets. The one-toolset pick (`TRACKS`, `STARTER` in `plans.ts`) goes away.
- Add-ons: +50 prompts $29/mo. Daily Claude and Perplexity +$1 per prompt a month (costs ~$0.80). X for social listening +$19 per keyword a month (cap 1,500 posts). Task packs stay.
- Current subscribers keep their price through the `arrowsterr_v3_*` Stripe keys. New prices use `arrowsterr_v4_*`.
- To change: `src/lib/plans.ts`, `scripts/stripe-setup.mjs`, the pricing page, and the Arrowsterr prices in the 4 blog posts on arrowsterr.com.

## Free tools (arrowsterr.com, no signup, full result by email)

| Tool | Reuses | Cost per run |
|---|---|---|
| AI Visibility Snapshot | live now | $0.10 |
| AI Crawler Checker (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) | Zippie audit | $0 |
| llms.txt Generator | `sitemap.ts` + Haiku | ~$0.01 |
| AI Traffic Checker (Google sign-in, visits from ChatGPT, Perplexity, Gemini) | `ga4.ts` | $0 |
| Free Keyword Research (5 a day) | keyword report | $0.054 |
| Competitor Keyword Gap (1 a day) | keyword gap | $0.065 |
| Meta Title and Description Generator | Zippie skill | ~$0.002 |
| FAQ Schema Generator | Zippie skill | ~$0.005 |
| Reddit Mention Finder (last 30 days for a brand) | social listening | ~$0.01 |

Limits: Cloudflare Turnstile, 3 runs a day per IP without an email, results cached per domain for 7 days, a $20 daily spend cap read from `cost_ledger` that turns the paid tools off.

## Social listening

Mentions of your brand, competitors and keywords across social sites and the web, with sentiment, alerts and replies drafted by Zippie.

### Parts
- **Mentions feed:** every post or comment that names a tracked keyword, newest first, with source, author, link, sentiment and topic. Filter by source, brand or competitor.
- **Share of voice:** your mentions against each competitor's, by week and by source.
- **Threads AI cites:** mentions that ChatGPT, Perplexity or Google AI also cite in answers (joined with `aiSources.ts`). These are the threads worth answering first.
- **Reply drafts:** Zippie's existing "community replies" skill drafts a reply in the brand voice. A person posts it. Nothing is posted for them.
- **Alerts:** Slack and email for new mentions, a spike in negative sentiment, or a mention in a thread AI cites. Weekly digest by email.

### Sources

| Source | How | Cost | Notes |
|---|---|---|---|
| Reddit | Data API, search every hour | $0.24 per 1,000 calls (check) | Commercial use needs Reddit's approval, 2 to 4 weeks (check). Apply first. |
| Hacker News | Algolia HN Search API | $0 | |
| YouTube | Data API v3 (titles, descriptions, comments) | $0 within the daily quota | |
| Bluesky | Public search API | $0 | |
| Web, news, blogs, forums | DataForSEO Content Analysis, daily | ~$0.02 a task + $0.00003 a row (check) | |
| X | Pay-per-use API | $0.005 per post read (check) | Add-on only. Cost grows with volume. |
| LinkedIn | none | | No public search API. Left out. |

Every new mention is tagged by Haiku for sentiment and topic, about $0.0002 each. Tagging goes through the step cache, so a mention is tagged once.

### Cost per tracked keyword a month (without X)
- Reddit hourly: 720 calls, ~$0.17
- Web and news daily: 30 tasks, ~$0.75
- Tagging 300 mentions: ~$0.06
- **Total: ~$1** (X adds up to $7.50 at the 1,500-post cap)

### Build
- Tables: `listen_keywords` (workspace, brand, keyword, sources), `mentions` (source, url unique, author, text, at, sentiment, topic, cited_by_ai).
- Jobs: a `listen` job kind in the queue, one per keyword per source, on the schedule above. Dedupe by url.
- Screens: Mentions, Share of voice, Settings (keywords and sources). Alerts reuse `notify.ts`.
- MCP: `get_mentions` tool.

## Running cost of the new parts a month

| | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Free tool runs (3,000 / 30,000) | ~$120 | ~$1,200 |
| Free plan workspaces (500 / 5,000) | ~$200 | ~$2,000 |
| Social listening (8 keywords per team avg) | ~$400 | ~$4,000 |
| Reddit commercial access | ~$0 to $1,000 (check) | ~$1,000 (check) |
| Turnstile | $0 | $0 (check) |
| **Total** | **~$720 to $1,720** | **~$8,200** |

Revenue at a $149 average: about $7,450 a month at Beta and $74,500 at Growth.
