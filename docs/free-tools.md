# Free tools

Eleven free tools on arrowsterr.com. Each one answers a real question in under a minute and ends with a button that starts the Free plan with the result already loaded. They all follow the AI Snapshot pattern that already works (`src/app/api/snapshot/route.ts`, `pages/snapshot` in the site repo).

## Status

| Built | What |
|---|---|
| Yes | Shared parts: `src/lib/freeTools.ts` (guard), `src/lib/freeLimits.ts` (limit rules, tested), `/api/free/[tool]`, `supabase/044_free_tools.sql` |
| Yes | 5 Free Keyword Tool, at arrowsterr.com/free-tools/keyword-tool/ and the hub at /free-tools/ |
| No | The other ten tools |

**Setup:**
- Run `supabase/044_free_tools.sql` in Supabase.
- Optional server settings: `FREE_CAP_KEYWORD` (default 500 runs a day), `FREE_PER_TOOL` (5), `FREE_PER_VISITOR` (15), `FREE_SPEND_DAY` (15 dollars), `FREE_ALERT_EMAIL` (who hears when the spend alarm trips).
- Bot check: set `TURNSTILE_SECRET` on the app and `AW_TURNSTILE_SITEKEY` in the site's wp-config.php together, or neither.

**How the limits work, in order:**
1. A saved result for the same keyword and country (30 days) comes back free and counts toward no limit.
2. A visitor gets 5 new runs a tool and 15 across tools in 24 hours, then is asked to sign up.
3. The tool stops at its daily cap, and all paid runs stop when the day's spend passes `FREE_SPEND_DAY` (one email a day). Both reset at midnight UTC.
4. A run counts from the moment it starts, so many at once can't slip past. A failed run gives the visitor's run back.
5. Free tool spend is logged per run in `free_runs.cost`, since the cost ledger needs a workspace.

## Shared parts (build once)

**App: one public route for every tool.** `src/app/api/free/[tool]/route.ts` holds a handler for each tool, plus one guard in `src/lib/freeTools.ts` that every tool goes through:
- **CORS:** only arrowsterr.com may call it, like the snapshot route.
- **Input:** checked and cleaned per tool, such as a domain, a keyword or a brand.
- **Saved results:** in `free_runs`, keyed by tool and input. A repeat run within the tool's save time is free and doesn't count toward any limit.
- **Limits:**
  - Per visitor: a hashed IP, 5 runs a day per tool and 15 across all tools.
  - Per tool a day: `FREE_CAP_<TOOL>` caps the total, so a burst can't run up the bill.
- **Bot check:** Cloudflare Turnstile when `TURNSTILE_SECRET` is set. It's free.
- **Cost tracking:** every paid call goes to `cost_ledger` as "free tool: {name}" through `charge()`.

**Database:** `supabase/044_free_tools.sql` adds the `free_runs` table:
- Columns: `id`, `tool`, `key`, `ip_hash`, `result jsonb`, `cost`, `created_at`.
- Indexes on (tool, key, created_at) and (ip_hash, created_at).
- Row-level security is on with no policies, so only the server reads and writes it.

**Site:**
- One template, `inc/free-tool.php`: hero, form, result, how it works, FAQ, CTA.
- One script, `assets/free-tools.js`, that draws each tool's result as text only, never HTML from the API.
- A hub page at `/free-tools/` links all of them. The header and footer get a "Free tools" link.
- Each tool links to two related tools and to the matching blog posts.

**Hand-off to the app:**
- "Track this daily" opens `app.arrowsterr.com/?from={tool}&q={input}`.
- Onboarding reads it, so the brand, prompts or keyword are already filled in when the Free plan starts.

**Tracking:** each run and each CTA click is an Umami event, so we can see which tool brings sign-ups.

## The tools

| # | Tool and page | Someone enters | They get | Built from | Cost a run | Saved for |
|---|---|---|---|---|---|---|
| 1 | AI Crawler Checker `/free-tools/ai-crawler-checker` | A domain | Each AI bot (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent) shown as allowed or blocked, with the robots.txt line that decides it. It also checks for a firewall block, by loading the homepage as GPTBot and comparing the answer. Includes the fix to paste. | `AI_BOTS` and robots reading in `audit.ts` | $0 | 1 day |
| 2 | llms.txt Generator `/free-tools/llms-txt-generator` | A domain | A ready llms.txt: the site summary, then its key pages in sections. Copy or download. | `findPages()` in `sitemap.ts`, `fetchSite()`, Haiku | ~$0.01 | 7 days |
| 3 | ChatGPT Rank Checker `/free-tools/chatgpt-rank-checker` | A brand or domain and one buyer question | Whether ChatGPT names the brand, in what spot, which brands it names instead, and the pages it cites | `answerChat()` with the ChatGPT engine | ~$0.005 to $0.02 (check) | 7 days per question |
| 4 | AI Overview Checker `/free-tools/ai-overview-checker` | A keyword and a country | Whether Google shows an AI Overview, the links it cites, and the top 10 below it | `serp()` in `kwReport.ts` (already saved 7 days) | ~$0.002 to $0.004 (check) | 7 days |
| 5 | Free Keyword Tool `/free-tools/keyword-tool` | A keyword and a country | Volume, KD, CPC, intent, 12-month trend, 10 variations and 5 questions. "See all with broad, phrase and exact match" leads to the app. | `keywordReport()` pieces (saved 30 days, shared) | ~$0.02, often $0 | 30 days |
| 6 | AI Prompt Generator `/free-tools/ai-prompt-generator` | A website or a category | 20 questions buyers ask AI, in 4 groups: learning, comparing, choosing and asking about the brand. "Track these" leads to the app. | The snapshot's prompt step, made longer | ~$0.003 | 30 days |
| 7 | AI Sources Finder `/free-tools/ai-sources-finder` | A topic or keyword | The sites ChatGPT, AI Overviews and AI Mode cite most for it, ranked, with the cited pages | Three answers through `answerChat()`, plus `cleanSources()` | ~$0.01 to $0.02 (check) | 7 days |
| 8 | AI Share of Voice `/free-tools/ai-share-of-voice` | A domain and up to 3 competitors | Who AI names most across 5 buyer questions on ChatGPT and AI Mode, as a share bar | The snapshot pipeline with competitors added | ~$0.05 to $0.10 | 7 days |
| 10 | AI Schema Generator `/free-tools/schema-generator` | Organization details and FAQs, or a domain to fill them in | Organization, FAQPage and Product JSON-LD to paste in, checked against schema.org types | Templates in the browser; Haiku only for "Fill from my site" | $0 to ~$0.003 | 30 days |
| 11 | AI Readiness Audit `/free-tools/ai-readiness-audit` | A domain | A score from 0 to 100 and the top fixes: bots blocked, text only visible with JavaScript, missing headings and schema, no llms.txt, slow pages | `audit.ts` limited to 5 pages, plus Google PageSpeed Insights (free API key) | $0 | 1 day |
| 12 | Domain Snapshot `/free-tools/domain-overview` | A domain and a country | Google traffic, keyword count, top 10 keywords and top 5 pages | `domainOverview()`, `rankedFor()` and `relevantPages()` | ~$0.03 (check) | 30 days |

The current AI Snapshot stays as it is. Tools 3, 7 and 8 link to it as "check your whole brand".

### Rules for every tool
- Results come back in under 60 seconds, with a progress bar like the snapshot's.
- The first view shows the full answer. No email wall, so pages can rank and be shared.
- Results are plain text. The site never inserts HTML that came from the API.
- Each tool page targets one search ("ai crawler checker", "llms.txt generator", "chatgpt rank checker" and so on) with its own title, FAQ and schema.

## Build order

| Phase | Tools | Why first |
|---|---|---|
| 1 | Shared parts, then 1, 4, 5 | Cost almost nothing and reuse finished code. Each one leads to a paid toolset: AI Visibility (1, 4), Organic Research (5). |
| 2 | 3, 6, 2, 10 | Quick to build. Tools 3 and 6 hand prompts straight to the Free plan. |
| 3 | 7, 8, 11, 12, the hub page and links from the blog | Use more paid calls, or need parts split out of the audit job. |

## Running cost a month

Assumes about half of all runs come back from saved results, and Share of Voice is about 7% of runs.

| | Beta (~3,000 runs) | Growth (~30,000 runs) |
|---|---|---|
| DataForSEO and Haiku for the 11 cheap tools | ~$25 | ~$250 |
| AI Share of Voice | ~$15 | ~$150 |
| Turnstile, PageSpeed Insights | $0 | $0 |
| Servers (current Render web and Fly worker; one more Render instance at Growth, check) | $0 | ~$25 |
| **Total** | **~$40** | **~$425** |

The caps per tool (`FREE_CAP_<TOOL>`) set the worst case. With the default caps below, every tool maxed out with no saved results costs about $50 a day:

| Tool | Default cap a day | Most it can cost a day |
|---|---|---|
| 1 AI Crawler Checker, 11 AI Readiness Audit | 1,000 each | $0 |
| 2 llms.txt Generator | 300 | ~$3 |
| 3 ChatGPT Rank Checker | 300 | ~$6 |
| 4 AI Overview Checker | 1,000 | ~$4 |
| 5 Free Keyword Tool | 500 | ~$10 |
| 6 AI Prompt Generator, 10 AI Schema Generator | 1,000 each | ~$3 each |
| 7 AI Sources Finder | 200 | ~$4 |
| 8 AI Share of Voice | 100 | ~$10 |
| 12 Domain Snapshot | 200 | ~$6 |
