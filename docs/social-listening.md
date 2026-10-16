# Social listening

A Social tab on the Competitors page. It finds posts about your brand and the competitors AI names most, shows who gets talked about, how warmly and where, flags the threads AI also cites, and drafts replies.

## Who gets tracked
- **You**, always.
- **Your competitors from AI Visibility:** the brands AI names most next to you in the last 30 days (`daily_metrics`), with the domain AI linked for each (latest runs). The plan sets how many: Trial 3, Starter 3, Pro 5, Agency 10, Enterprise 25.
- An editor can swap the automatic list for their own picks from the same AI list (`brands.listen.picks`). Picks past the plan's limit are skipped, never deleted.
- Social listening is part of the AI Visibility toolset. A Starter on Organic Research doesn't get it.

## Sources (v1)

| Source | How | Cost |
|---|---|---|
| Reddit | Google search through DataForSEO, `"Name" site:reddit.com`, past week | ~$0.002 a search (check) |
| X, LinkedIn, YouTube, Quora, Medium, Product Hunt, TikTok | one Google search with the sites joined by OR, past week | ~$0.002 (check) |
| News | Google News through DataForSEO, past week, your own site left out | ~$0.002 (check) |
| Hacker News | Algolia HN Search API, stories and comments | $0 |

- The first run for a name looks back a month. After that, a week, every day. Repeats are dropped by URL.
- Google results for the same name on the same day are cached and shared across workspaces, like AI answers, so a popular competitor is searched once a day in total.
- Later: Reddit's own API for comments and hourly checks (needs Reddit's approval), X's API as a paid add-on, custom keywords.

## Accuracy
A wrong mention costs more than a missing one.
- A result must name the brand (or its domain) as a whole word in its title or snippet. Others are dropped before any AI call.
- Haiku reads each new result with the brand's domain and category and answers whether it is really about that company. Anything it isn't sure about is dropped. It also scores sentiment (0 to 100, toward that brand) and the kind of post: question, complaint, praise, comparison, news or other.
- Tagging is cached per name, domain and day, so a retried job never pays twice.

## Pipeline
- `schedule` (every 10 minutes) starts each brand's listening once a day, in the brand's own time slot, and queues one `listen` job per tracked name. Keys `listen:<brand>:<name>:<day>` stop repeats. A failure here never blocks the daily AI checks.
- `listen` runs the searches, filters, tags and saves new rows to `mentions`. It retries on its own like every other job, and its cost goes to `cost_ledger` as "social listening".
- An editor's Start button queues today's jobs right away.

## Screen
- Before any data: a short intro and Start (the `ToolIntro` pattern).
- Share of voice: each name's mentions in the period, the change from the period before, share of all mentions, positive and negative share, top source and threads AI cites.
- Mentions: newest first, filtered by name, source, sentiment and "AI cites". Each shows the source, title, snippet, name, sentiment, kind and date, with Draft reply.
- **Threads AI cites:** a mention whose page (or Reddit thread) is also a source in your AI answers for the period. These are the threads worth answering first.
- **Draft reply** (editors, 3 tasks): Zippie's community-replies rules and the workspace's AI settings. The person posts it. Nothing is posted for them.
- Tracking: which names are tracked, with the plan's limit.

## Database
`supabase/038_social.sql`: `brands.listen` (settings), `brands.listened_on` (last day started), and `mentions` (one row per brand, name and URL; members read, the server writes).

## Running cost a month

| | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Tracked names (1.5 brands a team, you + 5) | 450 | 4,500 |
| Google searches, 3 a name a day at ~$0.002 (check), before sharing | ~$81 | ~$810 |
| Haiku tagging, ~$0.0007 a name a day | ~$9 | ~$95 |
| Reply drafts, ~$0.007 each, 200 / 2,000 | ~$1.40 | ~$14 |
| Hacker News | $0 | $0 |
| Servers | $0 (runs on the current worker) | $0 |
| **Total** | **~$92** | **~$920** |

Sharing across workspaces lowers the search line, since many teams track the same big competitors.

## Later
- Slack and email alerts for a spike in mentions or in negative sentiment, and a line in the weekly email.
- An MCP tool, `get_mentions`.
- The plan limits move to pricing v4 (`docs/pricing-v4.md`).
