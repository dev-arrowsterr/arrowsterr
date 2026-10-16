# Reports: plan

Goal: the most flexible client reporting in AI search and SEO. An agency should be able to build any report it wants from blocks, brand it as its own, and have it land in a client's inbox every month without touching it. A brand team should get a clear monthly report in two clicks.

Bar to beat: Semrush My Reports (200+ widgets, templates, white label, scheduling, PDF). Where we win: AI visibility data nobody else has, live links, AI-written commentary that only cites real numbers, and one template rolled out to every client at once.

## 1. What we have today

From a read of the code (October 2026):

- **One "Client report" page** (`src/components/reports/ReportsPage.tsx`) with 4 kinds: Client, AI Visibility (`PromptsDoc`), Competitors (`CompetitorsDoc`), Content Intelligence (`IntelDoc`).
- **The client report** (`ReportDoc.tsx`) has a fixed order of 10 blocks: cover, 4 KPIs, AI summary, wins and watch list, visibility by AI, competitor table, traffic, visitors, content, footer. Users can only switch 5 sections on or off.
- **Styling is strong already:** 8 theme templates (`reportTheme.ts`), 8 colors, 3 fonts, cover and card styles, radius, an agent that designs a theme, and agency brand learning. Saved per workspace in `report_styles`.
- **Share links** (`shared_reports`, `/r/[token]`) are frozen snapshots. They have no expiry, no password, no revoke screen and no view count. The pricing page promises "live report links".
- **PDF** is the browser's print dialog.
- **Nothing is saved as a report.** Chosen sections and the AI summary live in sessionStorage and vanish.
- **Date range** is the app-wide 7/30/60/90 days only.
- **No scheduled emails,** although Resend (`src/lib/email.ts`) and the jobs queue (`supabase/016_queue.sql`) are ready.
- **Plan gating is not enforced.** `plans.ts` defines `reports: basic | templates | whitelabel`, but no screen or API checks it. White label is a checkbox anyone can tick.
- **Data with no report block yet:** keywords, domain research, keyword gap, sources, social listening, Zippie changes. Search Console has a table but no code.

## 2. What we build

### 2.1 Report library (the Reports home)

The first screen under **Reports**. It replaces "Client report" in the nav.

- **Template gallery** across the top, with tabs: All, AI Visibility, SEO, Content, Website, Agency.
  - The first tile is **Start from scratch**.
  - Every tile shows a real thumbnail of the template on the user's own brand data.
- **Report list** below. Columns: name, brand, last updated, schedule, last sent (with status), owner.
  - Tabs: Reports, Templates.
  - Filters: All / Mine / Shared with me, brand, schedule state, search.
  - Status tags (square, brand v5): Draft, Scheduled, Sent, Failed, Paused.
  - Row actions: open, duplicate, share, schedule, rename, move to another brand, delete. Delete uses the app's dialog helper, never `window.confirm`.
  - Bulk actions (Agency): apply a template to many brands, schedule many, delete many.
- **No locked reports.** Semrush locks reports when a plan lapses. We keep every report readable on every plan. Plan limits stop new reports and schedules, never old ones.

### 2.2 The builder

A three-pane editor, the core of the feature.

**Top bar**
- Report name (inline edit), brand picker, date range, compare-to.
- Theme, Preview, Share, Schedule, Export.
- Autosave state ("Saved 2s ago") and version history.

**Left: widget library**
- Search box plus groups by source (see 2.3). Each widget shows a small live preview on hover.
- Drag a widget onto the page, or click to add it below the selected block.
- A second tab, **Outline**, lists pages and blocks so long reports are easy to reorder.

**Center: canvas**
- Pages on a 12-column grid. Blocks snap to columns and rows, and resize from their edges.
- Two layouts: **Paged** (A4 or US Letter, for PDF) and **Web** (one long page, for links). The same report switches between them without re-building.
- Structure blocks: cover page, section header, table of contents (auto), page break, divider, spacer, two-column row.
- Multi-select, copy and paste between reports, undo and redo, keyboard nudging, align and distribute.
- Empty-data rule: each block can be set to "hide when there's no data", so a client never sees a blank chart.

**Right: inspector** (for the selected block)
- **Data:** brand (defaults to the report's), metric or metrics, filters (AI model, topic, prompt set, country, device, page path), date range override, compare period, top N, sort.
- **Display:** chart type (each widget allows the types that make sense), columns to show, labels, number format, goal line, show change.
- **Style:** title, subtitle, notes, colors from the theme or an override, background, border, padding.
- **Text:** rich text with live variables like `{{visibility}}`, `{{visibility_change}}`, `{{top_competitor}}`, `{{period}}`.

### 2.3 Widget catalog

Every widget is one entry in a typed registry (see 4.2). That way, adding a widget is one file, not a refactor. We start with about 70 and grow past 150.

Widget shapes: KPI, KPI row, line or area trend, bar, stacked share, donut, gauge, table, heat grid, quadrant, ranked list, quote (a real AI answer), text, image or logo, AI commentary.

**AI Visibility** (from `metrics.ts`, `daily_metrics`)
- Visibility, sentiment, average position, rank: KPI and trend.
- Visibility by AI model; by topic; topic × model heat grid.
- Share of voice against competitors.
- Prompt table, with columns to choose from.
- Prompt deep dive: the real answer text, with your brand highlighted.
- Gaps: prompts where rivals are named and you are not.
- Wins and drops.
- Answer stability.

**Competitors**
- Quadrant.
- Battle card, you against one rival.
- Competitor table.
- Rank over time.

**Sources** (`sources.ts`, `metrics.ts`)
- Top cited domains and top cited URLs.
- Source type shares (owned, third party, reviews).
- Your owned pages AI cites.
- Sites that cite rivals but not you.

**Organic research** (`keywords.ts`, `kwReport.ts`, `gap.ts`)
- Tracked keyword list with volume, KD, intent.
- Domain overview: traffic, keywords, top pages.
- Rival domains.
- Keyword gap: missing, weak, strong.

**Content** (`calendar_items`, `intel.ts`)
- Content Plan status counts.
- Published this period.
- Pages table.
- Content Intelligence buckets.
- "Update these next".

**Website** (GA4, Umami)
- Visits, AI visits, AI share.
- Visits by AI assistant.
- Top landing pages.
- Visitors and leads (Hot/Warm/Cold).

**Search Console** (new; needs the GSC build, see phase 5)
- Clicks, impressions, CTR, position.
- Top queries; top pages.
- Queries that also show up as AI prompts.

**Social listening** (`social.ts`)
- Mentions, sentiment, share of voice.
- Threads AI cites.

**Zippie** (`change_sets`, `site_audits`)
- Fixes shipped.
- Audit score over time.
- Pending approvals.

**Narrative**
- AI executive summary.
- AI commentary for one section.
- "What we did / what's next" (manual or AI draft).
- Text.
- Image.
- Agency contact card.

### 2.4 Date ranges

- **Presets:** Last 7/30/90 days, Last full week, Last full month, Last quarter, Year to date, plus a custom range on a calendar.
- **Compare to:** previous period, same period last year, or none.
- **Relative ranges** ("last full month") are what schedules use, so a monthly send always reports the month that just ended.
- **History cap:** ranges are capped by the plan's `historyDays`. The picker shows the cap and does not let users pick past it.

### 2.5 Themes and white label

- **Theme manager:** the 8 templates in `reportTheme.ts`, plus themes the agent designs, plus themes saved by the workspace. Agency gets unlimited saved themes, so each client can have one.
- **Theme settings:**
  - Colors, fonts (Google Fonts list), cover style, card style, radius.
  - Chart palette, so "you" always gets the theme's accent.
  - Page size, margins, header and footer, page numbers.
- **Logos:** the agency logo plus the client logo (fixes the unused `clientLogo`), each with its own placement on the cover and in the header.
- **White label (Agency and Enterprise, enforced on the server):**
  - Remove "Made with Arrowsterr".
  - Custom share domain, e.g. `reports.agency.com`. We use Cloudflare for SaaS custom hostnames, and SSL is automatic.
  - Custom sender: emails come from `reports@agency.com` after a Resend domain check, or from "Agency name via Arrowsterr" until then.
  - Branded client portal (2.7).

### 2.6 Outputs

| Output | How | Notes |
|---|---|---|
| Live link | `/r/[token]` renders the saved report with fresh data on open | Cached 1 hour; a "Data as of" line on the cover |
| Frozen link | The same, from a stored snapshot | Every scheduled send freezes one, so the email always matches the link |
| PDF | Server render: Playwright prints a `/r/print/[token]` page on the Fly worker | Pixel-matched to the preview, selectable text, page numbers, clickable table of contents |
| HTML | The existing self-contained download | Kept |
| CSV / XLSX | Per table widget, or every table in the report as sheets | |
| PNG | Per chart, for slides | |
| Email | A short branded summary (top KPIs, AI summary, link) plus the PDF attached | Email-safe HTML, tested in Gmail and Outlook |

Later: Google Slides export, and a Looker Studio connector for agencies that live there.

### 2.7 Sharing and the client portal

- **Links:**
  - Each link chooses Live or Frozen.
  - Optional expiry date and optional password.
  - Revoke at any time.
  - View count and last opened, shown in the report list.
- **Client portal (Agency):** a branded page listing every report shared with one client, so the client bookmarks one URL. Clients sign in with an email code. They never see the Arrowsterr app and use no seats.
- **Embeds:** an iframe code for one report or one widget, for client dashboards and Notion.
- `shared_reports` moves into the new `report_links` table, and old tokens keep working.

### 2.8 Scheduling and delivery

- **Repeat:** weekly, every 2 weeks, monthly (day of month or "first Monday"), or quarterly, at a time in the workspace timezone.
- **Recipients:** To and CC, with a saved recipient list per brand.
- **Email content:** subject and body templates with variables, attach the PDF, include a link, and choose Live or Frozen.
- **Controls:** pause, resume, send now, and send a test to myself.
- **Send history:** every send with status (sent, opened, bounced, failed), the frozen copy, and a resend button.
- **Reliability:**
  - Each send is a job (`report_send`) in the existing queue.
  - The send key is (schedule, period). A retry can never email a client twice; this reuses the `email_log` claim pattern.
  - A failed send retries 3 times, then alerts the owner by email and Slack.
  - Sends wait for that day's data run (`rollup`) to finish, so a report never goes out half empty.

### 2.9 AI in reports

- **Draft a report:** describe the goal ("monthly report for a SaaS client, focus on AI visibility and content wins"). The agent picks a template and widgets, sets ranges, and writes first commentary. The user edits from there.
- **Grounded commentary:**
  - The model gets the exact numbers of the blocks it comments on and returns structured output: text plus the list of figures it used.
  - Before we show anything, code checks every number in the text against the data. If one doesn't match, we retry once, then fall back to a plain template sentence.
  - A wrong number in a client report costs more than a missing sentence.
- **Settings per report:** tone (plain, formal, upbeat), length, language (all languages we track), reading level.
- **Model:** Claude Sonnet 5.5 for anything a client reads. Scheduled sends run through the Batch API at half price, since they are not urgent.
- **Cost to the user:** each summary or commentary costs tasks (`TASK_COST.ai`). Commentary on scheduled sends is included in the plan's task budget.

### 2.10 Templates and agency scale

- **Built-in templates** (each is a saved report doc, so they are easy to add):
  - Monthly client report.
  - AI visibility deep dive.
  - Competitor battle report.
  - Content performance.
  - Website and AI traffic.
  - Executive one-pager.
  - Quarterly business review.
  - New client audit (pitch deck style).
  - Keyword opportunity report.
  - Search Console report.
  - Social listening report.
  - Zippie work log.
- **Save as template:** any report becomes a workspace template. Agency templates can be locked, so clients and junior staff can't change the layout.
- **Apply to brands:** pick a template and choose 1 to 200 brands. That creates one report per brand, each with its own data and logo, and optionally one schedule each. A single later edit to the template can be pushed to every report made from it, with a preview of what changes.
- **Versions:** autosave every change, named versions, restore, and "who changed what".

## 3. Plans

Uses the existing `reports` entitlement in `src/lib/plans.ts`, now enforced in the API.

| | Free | Starter | Pro | Agency | Enterprise |
|---|---|---|---|---|---|
| Saved reports | 1 | 10 | 50 | Unlimited | Unlimited |
| Builder and all widgets | Template only | Yes | Yes | Yes | Yes |
| Templates | 3 basic | All | All | All, plus locked agency templates | All |
| Live and frozen links | Frozen only | Yes | Yes, with password and expiry | Yes | Yes |
| PDF, CSV, PNG | PDF | Yes | Yes | Yes | Yes |
| Schedules | – | 2 | 20 | Unlimited | Unlimited |
| White label | – | – | – | Yes | Yes |
| Custom domain and sender | – | – | – | Yes | Yes |
| Client portal | – | – | – | Yes | Yes |
| Apply template to many brands | – | – | – | Yes | Yes |
| AI commentary | Tasks | Tasks | Tasks | Tasks | Tasks |

Starter's single toolset still applies. A Starter workspace on AI Visibility sees AI widgets; one on Organic Research sees SEO widgets.

## 4. How we build it

### 4.1 Data model (new migration)

```
reports            id, workspace_id, brand_id, name, doc jsonb (pages, blocks, settings),
                   theme_id, layout (paged|web), range jsonb, compare, template_id,
                   created_by, updated_by, updated_at, archived_at
report_versions    id, report_id, doc jsonb, name, created_by, created_at
report_templates   id, workspace_id (null = built-in), name, category, doc jsonb, locked, thumb_url
report_themes      id, workspace_id, name, theme jsonb           (report_styles moves here)
report_links       id, report_id, token, mode (live|frozen), snapshot jsonb, password_hash,
                   expires_at, revoked_at, views, last_viewed_at  (shared_reports moves here)
report_schedules   id, report_id, cadence jsonb, tz, recipients jsonb, subject, body,
                   attach_pdf, link_mode, paused, next_run_at
report_sends       id, schedule_id, period, status, link_id, pdf_path, error, sent_at
                   unique (schedule_id, period)
report_cache       spec_hash, workspace_id, range_key, data jsonb, computed_at
client_portals     id, workspace_id, brand_id, slug, domain, settings jsonb
```

All tables get RLS: viewers read, editors write. Public reads go through the token route only.

### 4.2 Widget registry

One file per widget under `src/lib/reports/widgets/`, each exporting:

- `id`, `source`, `title`, `shapes` (allowed chart types), `plan` (minimum plan), `toolset`.
- `config`: a zod schema, so the inspector form is generated from it and saved docs are checked.
- `resolve(spec, ctx)`: server-only. Reads `daily_metrics`, runs and the research tables, and returns plain JSON. Results are cached in `report_cache` by spec hash and range.
- `render(data, spec, theme)`: one React component used in the editor, the live link, the PDF and the PNG export, so they always match.

A single `/api/reports/data` route resolves every block of a report in one call. It checks the plan and toolset, and reuses `meteredRoute` for anything that spends tasks.

### 4.3 Rendering

- The report renderer is the current `ReportDoc` approach split into blocks. It uses scoped `.rp` theme CSS, so exports never pick up app styles.
- Charts stay hand-built SVG. We extend `TrendChart`, `Donut` and `Quadrant` with theme colors and print sizes. SVG keeps the PDF sharp, and we skip a chart library.
- **PDF:**
  - The Fly worker runs Playwright with Chromium.
  - A job `report_pdf` opens `/r/print/[token]`, waits for a `data-ready` flag, and saves to Supabase Storage.
  - Downloads stream from Storage with a signed URL.
- **Builder:** we use `dnd-kit` for drag and drop and a 12-column grid layout, with no browser `<select>`, `prompt` or `confirm` (brand rule).
- **UI:** the builder follows brand v5 (`docs/brand.md`, `src/app/brand-v5.css`):
  - Underline tabs.
  - Target ticks on the selected block.
  - The Notch on the main action.
  - Square tags, hairline frames.

### 4.4 Tests

Tests to add:
- Every widget resolver against fixture data.
- Doc schema checks.
- Plan gating on every report API route.
- The send key (no double emails) on a forced retry.
- The commentary number check, with a case where the model gets a number wrong.
- Snapshot tests of the PDF page for 3 templates.

## 5. Phases

| Phase | Scope | Size |
|---|---|---|
| 1. Foundation | Saved reports and versions, report library with templates, date ranges and compare, plan gating, `report_links` (live/frozen, expiry, password, revoke, views), server PDF on the worker | 2–3 weeks |
| 2. Builder | Canvas, widget library, inspector, outline, copy/paste, undo; first 40 widgets (AI Visibility, Competitors, Sources, Content, Website); theme manager | 3–4 weeks |
| 3. Delivery and AI | Schedules, email template, send history, retries and alerts; grounded AI commentary and "Draft a report"; CSV/XLSX/PNG exports | 2–3 weeks |
| 4. Agency | White label enforced, custom domains, custom sender, client portal, locked templates, apply template to many brands and push updates | 2–3 weeks |
| 5. More data | Search Console connection and widgets, Organic research and gap widgets, social listening, Zippie log; report endpoints in the API and MCP; Looker Studio connector | 3–4 weeks |

Phase 1 alone fixes the current gaps: the "live links" promise, unsaved work, white label not enforced, and print-only PDF.

## 6. Running cost

Assumptions:
- Each team makes about 20 reports a month, and half of them go out on a schedule.
- Each report gets one AI summary and up to 8 commentary blocks in a single call: about 10K tokens in and 2K tokens out on Claude Sonnet 5.5 ($2 / $10 per million tokens). That is about $0.04 a report, or $0.02 through the Batch API.

| Item | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Claude tokens, AI commentary (1,000 / 10,000 reports a month, half batched) | $30 | $300 |
| PDF rendering: larger Fly worker for Chromium (2 GB, then 2 machines) | $10 (check) | $25 (check) |
| Email: Resend (≈2,500 / 25,000 report emails a month) | $0 on the free tier (check) | $20, Pro plan (check) |
| Storage: PDFs and snapshots in Supabase Storage (≈1 GB / 10 GB a month, kept 90 days) | $0, inside the current plan (check) | $0–5 (check) |
| Custom domains: Cloudflare for SaaS hostnames (first 100 free) | $0 (check) | $0 (check) |
| Google Search Console API | $0 | $0 |
| **Monthly total** | **≈ $40** | **≈ $350** |

The AI commentary is paid for by tasks (`TASK_COST.ai`), so the token cost scales with what teams already pay for.
