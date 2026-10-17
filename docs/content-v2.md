# Content v2: Opportunities, Calendar and Content

Arrowsterr researches and writes 10 articles a month for each brand. People pick topics and dates; the AI does the research and the full draft. Every draft lands in Content, where people edit it by hand and publish it to the brand's site.

## Done (17 Oct)

- Content Plan list: only **Export CSV** stays above the sheet. Import, Add keyword, Plan dates, Shortcuts, + Column and Columns are gone.
- The intro shows only before the first plan.
- The sheet fills the screen (`calc(100vh - 210px)`) with sticky headers, row numbers and keyword column.
- Keyword difficulty is its number in green (under 30), amber (30–49) or red (50+). The word sits in the tooltip.
- The Website section (Traffic, Visitors) is removed. Old links open Prompts.

## The sidebar

| Group | Items |
|---|---|
| AI Visibility | Prompts, Competitors, Sources |
| Organic Research | Keyword Research, Domain Research, Competitive Analysis |
| Content | **Opportunities**, **Calendar**, **Content** |
| Reports | Reports |

Removed from the sidebar: Zippie, Content Intelligence. Content Intelligence forwards to Opportunities. Brand Voice lives in Settings and opens on first use of Content.

**Ask Zippie** becomes a floating button in the bottom-right corner of every page. It opens a chat panel over the page and knows which brand and page you're on. `/zippie` opens the panel on Prompts.

## Screens

### Opportunities (today's Content Plan)

- The full-screen sheet from 17 Oct: keyword, stage, volume, difficulty color, theme, status, date.
- One action per row: **Write now** (uses one of the month's articles). Bulk: pick rows → Write now, Delete.
- Toolbar: Export CSV only. Monthly refresh stays in the header.

### Calendar (its own page, like ClickUp)

- Views: **Month**, **Week**, **List** (by date) and **Board** (columns by status: Idea, Scheduled, Researching, Drafting, Ready, Published).
- **Right sidebar:** every unscheduled opportunity, with filters for stage, volume, difficulty and theme, and a search box. Drag a topic onto a day to schedule it.
- **Auto-schedule** moves here (posts per week, start date), from the old Plan dates button.
- A scheduled topic is researched and drafted 3 days before its date, so it's Ready on the day.

### Content (the article library)

- A table of articles: title, keyword, status, words, date, sources used.
- Every finished draft lands here with status Ready.
- Opening an article shows a plain editor: headings, text, lists, links, images, tables and interactive module blocks. It saves as you type. No AI inside the editor.
- A right panel shows the research: Google's top 10, the AI answers and the sources they cited, and the brief.
- Actions: **Regenerate** (with a one-line note, for example "shorter intro"; uses no extra article and replaces the draft after a confirm), **Export** (HTML, Markdown, Google Doc) and **Publish**.
- **Publish:** pick one of the brand's connected sites (WordPress through `wp-plugin`, Webflow, Shopify, HubSpot, Ghost from `src/lib/cms.ts`), as a draft or live, now or on the calendar date. The article keeps the published link and its status turns Published.
- Removed: the AI bar (`AiBar.tsx`), the AI parts of `DocsEditor.tsx`, comments (`CommentRail.tsx`) and agentic edits. The plain editing in `DocsEditor.tsx` stays.

### Brand Voice (required before the first article)

- Paste 3 to 5 URLs of the brand's best writing, or paste text.
- Arrowsterr distills: tone, sentence length, words to use and avoid, how the brand names itself and its product, and the reader it writes for.
- The person checks it and saves. Every article is written from it. It reuses `src/lib/brandKit.ts` where it fits.

## How one article is made

A `write_article` job on the Fly worker, step by step. Each step saves its output, so a retry starts where it stopped and never pays twice.

| Step | What happens | Tool |
|---|---|---|
| 1. Search results | Google's top 10, People Also Ask and AI Overview for the keyword | DataForSEO (`src/lib/dataforseo.ts`) |
| 2. Read the pages | Playwright opens each of the top 10 in Chromium, waits for the page to render, and keeps headings, body text, tables, word count and the date | Playwright on the worker (already there for PDFs) |
| 3. AI sources | Asks the AI engines Arrowsterr tracks the keyword as a question, keeps their answers and cited links, and reads those pages with Playwright too | `src/lib/engines.ts`, `aiSources.ts` |
| 4. Brief | Outline, what the top pages miss, entities to cover, word target, internal links from the brand's sitemap, and whether an interactive module fits | Claude Sonnet 5.5 |
| 5. Draft | Section by section in the Brand Voice, citing the sources it used | Claude Sonnet 5.5 |
| 6. Check | Every claim checked against the saved sources; unsupported claims are cut. Links checked. One rewrite pass if the check fails. | Claude Sonnet 5.5 |
| 7. Interactive module | When the brief asks for one, a self-contained HTML block (see below) | Claude Sonnet 5.5 |
| 8. Ready | Status Ready, and a Slack or email note if set | — |

**Playwright rules:** 20 seconds a page, no logins, robots.txt respected, private network addresses refused (`src/lib/netCheck.ts`), and a page that fails is skipped. An article needs at least 5 pages read, or it waits and retries.

**Monthly 10:** on the 1st, the job picks the top unscheduled opportunities (BOFU first, then volume) and fills any free slots up to 10. Picks already scheduled count first.

## Per brand and per workspace

Today Search Console (`gsc_connections`, by site) and Google Analytics (`ga4_connections`, by brand) are per brand. CMS connections (`cms_connections`) and Slack (`integrations`) are per workspace, so every brand in a workspace publishes to the same sites.

| Per brand (Settings › Brand) | Per workspace (Settings › Workspace) |
|---|---|
| Publishing sites: WordPress, Webflow, Shopify, HubSpot, Ghost | Members and roles |
| Search Console, Google Analytics | Plan, billing, tasks |
| Brand Voice | API keys, MCP, OAuth apps |
| Slack channel for this brand's alerts | Slack connection (the workspace's Slack) |
| Alert thresholds | Default alert thresholds |

**Change (migration `047_brand_integrations.sql`):**
- `cms_connections` gets `brand_id`. Existing rows go to the workspace's first brand, and a workspace with several brands gets a one-time notice to move them.
- `integrations` keeps the Slack connection. A new `brand_settings` table holds each brand's Slack channel and alert thresholds, falling back to the workspace's.
- Settings splits into **Brand** (the left column above) and **Workspace** (the right).

## Interactive modules

- Types: calculator, comparison table with filters, checklist, quiz, ROI estimator, timeline.
- Each module is one HTML file with inline CSS and JS, no outside scripts, styled from the brand's colors and fonts.
- In Arrowsterr it runs in a sandboxed iframe. On export it's an embed snippet, and on WordPress a block from `wp-plugin`.
- Each module is tested on generation: it loads in Playwright with no console errors, and its inputs change its output. A module that fails is dropped from the article.

## Build order

| Week | Build | Done when |
|---|---|---|
| 1 | Sidebar, Opportunities page, Calendar page with Month, Week and List views and the right sidebar; Zippie as the floating widget; Content Intelligence out of the sidebar | A topic dragged from the sidebar lands on a day and shows in Opportunities with that date |
| 2 | Brand Voice; per-brand integrations and the Brand / Workspace split in Settings; Content library with the plain editor; Export | Two brands in one workspace publish to two different WordPress sites |
| 3 | Research steps 1–3 on the worker with Playwright | A keyword gets 10 search results, 5+ pages read and AI answers saved, and a retried job reuses them |
| 4 | Brief, draft and check (steps 4–6); the monthly 10; Regenerate | A scheduled topic becomes a Ready article 3 days before its date |
| 5 | Interactive modules; Publish to the brand's sites, now or on the date | A calculator module runs in the article and in a WordPress post |
| 6 | Board view, the AI editing features removed, tests | Every test below passes |

**Tests:**
- A job killed at any step and restarted finishes with one article and one charge.
- A page that times out or blocks the bot is skipped and the article still finishes.
- The 11th article in a month is refused; Regenerate is not counted.
- A module with a console error is dropped.
- A brand's article can only publish to that brand's sites.
- Regenerate never overwrites hand edits without the confirm.
- Every claim in a finished draft points to a saved source.

## Cost of one full article

Claude Sonnet 5.5 at $2 input and $10 output per million tokens.

| Step | Typical use | Cost |
|---|---|---|
| Search results | 1 SERP call with AI Overview | ~$0.01 (check) |
| Read the pages | ~15 pages in Playwright on the worker | ~$0 (worker time) |
| AI sources | 4 engine questions | ~$0.05 (check) |
| Brief | 40K tokens in, 4K out | ~$0.12 |
| Draft | 25K in, 15K out | ~$0.20 |
| Check and rewrite | 25K in, 6K out | ~$0.11 |
| Interactive module | 10K in, 8K out | ~$0.10 |
| **One article** | | **~$0.60** |

On Claude Opus 5.5 ($4 / $20) it's about $1.15. Prompt caching on the Brand Voice and sources cuts the input side.

## What it adds to the monthly bill

Each team gets 10 articles a month.

| Line | Beta (50 teams, 500 articles) | Growth (500 teams, 5,000 articles) |
|---|---|---|
| Claude for articles | ~$250 | ~$2,500 |
| DataForSEO and AI engine calls | ~$30 (check) | ~$300 (check) |
| Fly worker to 2 GB for Playwright | ~$10 (check) | ~$60 (check) |
| **Added** | **~$290** | **~$2,860** |

That is about $6 a team a month, inside the Pro plan's margin at $179.
