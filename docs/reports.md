# Reports: plan

Goal: the most flexible client reporting in AI search and SEO. An agency should be able to build any report it wants from blocks, brand it as its own, and have it land in each client's inbox every month without touching it. A brand team should get a clear monthly report in two clicks.

Bar to beat: Semrush My Reports (200+ widgets, templates, white label, scheduling, PDF). Where we win:
- AI visibility data nobody else has, down to the real answer text.
- Live links that stay current, so clients stop asking for "the latest numbers".
- AI-written commentary that only cites numbers it was given, checked by code.
- One template rolled out to every client brand at once, with later edits pushed to all of them.
- No locked reports. A report never disappears behind a paywall.

Contents
1. What we have today
2. Principles
3. Report library
4. Creating a report
5. The builder
6. Widget catalog
7. Shared widget settings
8. Text blocks and variables
9. Date ranges
10. Themes
11. White label
12. Outputs
13. Sharing and the client portal
14. Scheduling and delivery
15. AI in reports
16. Built-in templates
17. Agency features
18. "Add to report" from anywhere
19. Plans and limits
20. Data model
21. API routes
22. Widget registry
23. Rendering, caching and speed
24. API, MCP, webhooks and Zapier
25. Security and privacy
26. What we measure
27. Tests
28. Phases
29. Running cost
30. Open questions
31. Brand Kits, templates by purpose and the module builder

---

## 1. What we have today

From a read of the code (October 2026):

- **One "Client report" page** (`src/components/reports/ReportsPage.tsx`, nav item in `App.tsx:989`). It has 4 kinds: Client, AI Visibility (`PromptsDoc`), Competitors (`CompetitorsDoc`) and Content Intelligence (`IntelDoc`).
- **The client report** (`ReportDoc.tsx`) has a fixed order of 10 blocks: cover, 4 KPIs, AI summary, wins and watch list, visibility by AI, competitor table, traffic, visitors, content, footer. Users can only switch 5 sections on or off.
- **Styling is strong already.** There are 8 theme templates (`reportTheme.ts`), 8 colors, 3 fonts, cover and card styles, and a radius setting. An agent designs a theme (`/api/reports/style`) and agency brand learning exists (`/api/reports/brand`). Styles are saved per workspace in `report_styles`.
- **Share links** (`shared_reports`, `/r/[token]`) are frozen snapshots. They have no expiry, no password, no revoke screen and no view count. The pricing page promises "Live report links" (`PlanGrid.tsx:73`).
- **PDF** is the browser's print dialog (`window.print()`).
- **Nothing is saved as a report.** Chosen sections and the AI summary live in sessionStorage and are lost when the tab closes.
- **Date range** is the app-wide 7/30/60/90 days, always compared with the period before.
- **No scheduled report emails.** Resend (`src/lib/email.ts`), the jobs queue (`supabase/016_queue.sql`, `src/lib/jobs.ts`) and the send-once pattern (`email_log`, `notify.ts:68`) are ready to reuse.
- **Plan gating is not enforced.** `plans.ts` defines `reports: basic | templates | whitelabel`, but no screen or API checks it. White label is a checkbox anyone can tick.
- **Data with no report block yet:** keyword research, domain research, keyword gap, sources, social listening and Zippie changes. Search Console has a table (`gsc_connections`) but no code.
- **No tests** cover the report code.

## 2. Principles

1. **A wrong number costs more than a missing one.** Every figure in a report, including AI text, traces back to stored data. When data is missing, the block says so or hides itself.
2. **One renderer.** The editor, live link, PDF, PNG and email summary all draw from the same block components, so what you build is what the client sees.
3. **Nothing is lost.** Reports autosave, keep versions, and stay readable on every plan.
4. **Build once, send forever.** Any report can run on a schedule with no further clicks, and any template can feed many brands.
5. **Brand v5 in the app** (`docs/brand.md`): underline tabs, Target ticks on the selected block, the Notch on the main action, square tags, hairline frames. No browser `<select>`, `prompt`, `confirm` or `alert`.
6. **Minimal copy on working screens.** Labels, buttons and real errors only. Explaining happens once, on the library's first screen before any report exists.

---

## 3. Report library

The first screen under **Reports** in the nav. It replaces "Client report". Route: `/reports`.

### 3.1 Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Reports                                          [New report ▸]       │
├───────────────────────────────────────────────────────────────────────┤
│ Templates   All · AI Visibility · SEO · Content · Website · Agency    │
│ [+ Start from scratch] [tile] [tile] [tile] [tile] [tile]  ‹ ›        │
├───────────────────────────────────────────────────────────────────────┤
│ Reports  Templates          All · Mine · Shared with me               │
│ [Brand ▾] [Schedule ▾] [Search reports…]          [Select]            │
│ ☐ Name              Brand     Updated   Schedule      Last sent  ⋯    │
│ ☐ Monthly report    Acme      2h ago    Monthly · 1st Sent Oct 1 ⋯    │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.2 Template gallery

- **Tabs:** All, AI Visibility, SEO, Content, Website, Agency. Each tab shows its count.
- **First tile: "Start from scratch".** It opens the builder with one empty page and the brand's theme.
- **Template tiles** (240 × 300):
  - A live thumbnail of the template's first page, drawn on the user's own brand data. It is rendered once, cached and refreshed weekly.
  - Name, a one-line description, page count and a "Pro" or "Agency" tag when the plan is too low.
  - Hover shows "Preview" and "Use template".
- **Preview:** a side panel with every page at full width and a "Use template" button.
- **Order:** built-in templates first, then workspace templates (newest first). Agency templates show a lock icon when locked.
- **Plan gating:** a template above the plan still previews, but "Use template" opens the upgrade dialog.

### 3.3 Report list

**Columns**
| Column | Content | Sortable |
|---|---|---|
| ☐ | Row checkbox for bulk actions | – |
| Name | Report name. Under it in small text: page count and layout (Paged or Web) | Yes |
| Brand | Brand logo and name | Yes |
| Updated | Relative time, with exact date and editor name on hover | Yes (default, newest first) |
| Schedule | "Monthly · 1st at 9:00", "Weekly · Mon", "Paused" or "–" | Yes |
| Last sent | Status tag (Sent, Failed, Sending) and date | Yes |
| Views | Total views on live links in the last 30 days | Yes |
| ⋯ | Row menu | – |

**Tabs and filters**
- Tabs: Reports, Templates (the workspace's saved templates).
- Ownership tabs: All, Mine, Shared with me (reports where the user is a named editor).
- Brand: a multi-pick menu (the app's `Select`), with "All brands" as the default.
- Schedule: Any, Scheduled, Paused, Not scheduled, Failed last send.
- Search: matches name and brand, debounced by 200 ms.
- Filters persist per user in localStorage.

**Row menu actions**
| Action | Behavior |
|---|---|
| Open | Opens the builder |
| Preview | Opens the live view in a new tab |
| Duplicate | Copies the doc, names it "Name (copy)", opens it |
| Share | Opens the share dialog (section 13) |
| Schedule | Opens the schedule panel (section 14) |
| Download PDF | Queues a PDF and shows a toast with a download link when ready |
| Save as template | Section 16.3 |
| Move to brand | Pick a brand. Widgets switch to that brand's data |
| Rename | Inline edit |
| Archive | Hides it from the list and pauses its schedule. Restorable for 30 days from "Archived" |
| Delete | App dialog: "Delete Monthly report and its 3 links? Clients lose access." Links stop working at once |

**Bulk actions** (when rows are checked): Schedule, Pause schedules, Resume schedules, Download PDFs (zip), Move to brand, Archive, Delete.

### 3.4 States

- **First visit, no reports:** the one explaining screen (ToolIntro pattern) with eyebrow "Start here", title "Send clients a report they'll actually read", one lead line, and three ways in: Use a template, Start from scratch, Draft with AI.
- **Loading:** skeleton rows, never a spinner over the whole page.
- **Plan limit reached:** "New report" opens the upgrade dialog with the current count ("10 of 10 reports on Starter"). Existing reports stay fully usable.
- **Viewer role:** can open, preview and download. Edit, share, schedule and delete are hidden.

### 3.5 Done when
- A user can find any report in under 3 seconds with 500 reports in the list (server-side paging at 50 rows).
- Every row action works by keyboard, and delete never uses `window.confirm`.

---

## 4. Creating a report

Five ways in, all ending in the builder.

1. **From a template.** Pick a template, then a brand (defaults to the current brand), then a name (defaults to "Template name · Brand"). The report opens with real data.
2. **From scratch.** One empty paged page with a cover block, ready for widgets.
3. **Draft with AI.** Section 15.1.
4. **Duplicate.** From the list or the builder's menu.
5. **Add to report from any page.** Section 18.

Agency only: **apply a template to many brands** (section 17.2).

Every new report:
- Gets the workspace's default theme, or the brand's own theme if one is set.
- Uses the date range "Last 30 days" compared with the previous period, unless the template sets another.
- Is a Draft until it is shared or scheduled.

---

## 5. The builder

Route: `/reports/[id]`. Full screen, with the app sidebar collapsed.

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Monthly report ✎   [Acme ▾] [Last month ▾ vs Previous ▾]               │
│                      Saved · [History] [Theme] [Preview] [Share] [▸ Send]│
├──────────────┬───────────────────────────────────────────┬───────────────┤
│ Widgets      │                                           │ Inspector     │
│ Outline      │            page canvas (zoomable)         │ Data          │
│ Pages        │                                           │ Display       │
│ [Search]     │                                           │ Style         │
│ AI Visibility│                                           │               │
│  ▸ KPI …     │                                           │               │
└──────────────┴───────────────────────────────────────────┴───────────────┘
```

Left panel 280 px, inspector 320 px, both collapsible. Under 1100 px wide, the inspector becomes a drawer. The builder is desktop-first; on phones the report opens in preview mode with a note that editing needs a wider screen.

### 5.2 Top bar

| Item | Detail |
|---|---|
| Back | Returns to the library |
| Name | Inline edit, 120 characters max |
| Brand | The report's default brand. Changing it re-points every widget that follows the report brand |
| Date range | Section 9. Changing it re-runs every block that follows the report range |
| Saved state | "Saving…", "Saved", or "Offline, changes kept" |
| History | Version list (5.9) |
| Theme | Opens the theme panel (section 10) |
| Preview | Full-screen view exactly as the client sees it, with a Paged / Web switch |
| Share | Share dialog (section 13) |
| Send | Primary button with the Notch. Its menu has Send now, Schedule, Download PDF and Export |

### 5.3 Left panel

**Widgets tab**
- Search across names, sources and keywords ("sov" finds Share of voice).
- Groups by source (section 6), collapsed except the brand's main toolset.
- **Recently used** and **Favorites** (star a widget) at the top.
- Hover shows a 240 px live preview on the report's brand and range.
- A widget the plan or toolset doesn't allow shows a small lock and opens the upgrade dialog when clicked.
- Drag onto the canvas, or click to add below the selected block (or at the end of the current page).

**Outline tab**
- A tree of pages and blocks. Drag to reorder or move blocks between pages.
- Each block shows its title, an eye icon (hide) and an alert dot when it has a data error.

**Pages tab**
- Page thumbnails.
- Add page, duplicate page, delete page, page settings (size override, background, hide header or footer).

### 5.4 Canvas

**Grid**
- 12 columns with 16 px gutters. Row unit 8 px.
- Each block has a minimum width in columns (KPI 2, chart 4, table 6, cover 12) and a minimum height in rows.
- Blocks snap to columns and rows. Pink guides show alignment with nearby blocks.

**Layouts**
- **Paged:** A4 (210 × 297 mm) or US Letter (8.5 × 11 in), portrait or landscape, margins 12 / 16 / 20 mm. A dashed line shows page breaks. A block taller than one page continues on the next page (tables repeat their header row).
- **Web:** one 1120 px column that grows. On phones, blocks stack in reading order.
- Both layouts use the same blocks. Switching never loses anything.

**Selecting and editing**
- Click selects (Target ticks on the block). Shift-click adds to the selection. Drag on empty space draws a selection box.
- Double-click a text block to type in it.
- Drag the body to move. Drag an edge or corner handle to resize.
- With several blocks selected: align left, center or right, align top, distribute, match width, group into a row.

**Block toolbar** (above the selected block): duplicate, move up, move down, hide, lock position, comment, delete.

**Keyboard**
| Keys | Action |
|---|---|
| ⌘Z / ⇧⌘Z | Undo / redo (200 steps, kept per session) |
| ⌘C / ⌘V | Copy / paste, also between reports and brands |
| ⌘D | Duplicate |
| Delete | Delete the selection |
| Arrows | Move by one grid step. Shift + arrows: by 4 |
| ⌘G | Group into a row |
| / | Focus widget search |
| ⌘P | Preview |
| ⌘S | Save a named version |
| Esc | Clear the selection |

**Zoom:** 50% to 200%, plus Fit width. Hold space and drag to pan.

### 5.5 Inspector

Three tabs for the selected block. The fields come from the widget's schema (section 22), so every widget gets the same controls.

- **Data:** brand, metrics, filters, date range override, compare, top N, sort. Section 7.1.
- **Display:** chart type, columns, labels, number format, goal line, thresholds, annotations. Section 7.2.
- **Style:** title, subtitle, note, colors, background, border, padding, "hide when empty". Section 7.3.

With nothing selected, the inspector shows report settings: layout, page size, margins, header, footer, page numbers and table of contents.

### 5.6 Block states

Every block can be in one of these states, in the editor and in the output:

| State | Editor | Output |
|---|---|---|
| Loading | Skeleton of the block's shape | Never shown; PDF and sends wait for data |
| Ready | The block | The block |
| Empty | "No data for this range" plus the reason (e.g. "Search Console not connected") and a fix button | Hidden if "hide when empty" is on, else a quiet "No data for this period" |
| Error | Red alert dot, the real error and Retry | Hidden, and the send log records it |
| Locked by plan | Grey overlay with the plan needed | Hidden |

### 5.7 Saving

- Autosave 800 ms after the last change, and on blur.
- Saves send only the changed part of the doc (JSON patch). The server stores the full doc.
- Offline edits are kept in IndexedDB and sent when the connection returns.
- If two people edit at once, the second editor sees "Dana is editing" and opens read-only, with "Edit anyway". Full live co-editing is a later step.

### 5.8 Comments

- Pin a comment to any block. Threads, @mentions of workspace members, resolve.
- Comments never show in outputs.
- Email notifications for mentions use the existing notification preferences.

### 5.9 Versions

- An automatic version every 30 minutes of editing and before every scheduled send.
- Named versions with ⌘S.
- The history panel lists versions with editor and time. Restoring makes a new version, so nothing is lost.
- Versions are kept 180 days (Agency and Enterprise: 2 years).

### 5.10 Done when
- Adding, moving and resizing 50 blocks stays smooth (60 fps on a 2020 MacBook Air).
- Undo restores every change, including theme and range changes.
- A report with 120 blocks opens in under 2 seconds with warm cache.

---

## 6. Widget catalog

Every widget is one entry in the registry (section 22). We launch with about 70 and add more each month. "Shapes" lists the views a widget allows; the first is the default.

Shape names: KPI, KPI row, line, area, bar, stacked bar, donut, gauge, table, heat grid, quadrant, list, quote, text.

### 6.1 AI Visibility

Data: `daily_metrics`, `runs`, `answers`, `src/lib/metrics.ts`, `src/lib/visibility.ts`.

| Widget | Shapes | Key settings |
|---|---|---|
| Visibility | KPI, gauge, line | Model, topic, compare |
| Sentiment | KPI, gauge, line | Model, topic |
| Average position | KPI, line | Model, topic. Lower is better, so arrows invert |
| Rank among brands | KPI, line | Model, topic |
| AI scorecard | KPI row | Pick 2–6 of the four metrics above |
| Visibility trend | line, area, bar | Daily, weekly or monthly points; add rivals as lines |
| Visibility by AI model | bar, table, donut | Models to include, sort |
| Visibility by topic | bar, table | Topics, top N |
| Topic × model grid | heat grid | Metric (visibility, position, sentiment) |
| Share of voice | stacked bar, donut, table | Brands to include, "Others" bucket |
| Prompt table | table | Columns (visibility, position, sentiment, top rival, change), topic filter, top N, sort |
| Prompt deep dive | quote | Prompt, model, show brands named, highlight your brand |
| Gaps | table, list | Prompts where rivals are named and you are not; top N |
| Wins and drops | list, table | Threshold for a win or drop (e.g. 5 points) |
| Answer stability | KPI, table | Model |
| New brands appearing | list | Brands named this period that weren't before |

### 6.2 Competitors

Data: `metrics.ts` (`battle`, `rankOf`, `competitorDomains`), `CompetitorsPage` `Quadrant`.

| Widget | Shapes | Key settings |
|---|---|---|
| Competitor table | table | Columns, brands, sort |
| Quadrant | quadrant | Axes (visibility × position by default), brands, labels |
| Battle card | KPI row, line | You against one rival, metric |
| Rank over time | line | Brands |
| Head-to-head by model | table, bar | Rival, models |

### 6.3 Sources

Data: `sources.ts`, `metrics.ts` (`domainRows`, `urlRows`, `typeShares`, `citedRank`).

| Widget | Shapes | Key settings |
|---|---|---|
| Top cited domains | table, bar | Top N, model |
| Top cited pages | table | Top N, domain filter |
| Source types | stacked bar, donut | Owned, third party, reviews |
| Your cited pages | table | Model |
| Sites citing rivals, not you | table | Rivals, top N |

### 6.4 Organic research

Data: `keywords.ts`, `kwReport.ts`, `gap.ts`, `keyword_runs`, `keyword_cache`.

| Widget | Shapes | Key settings |
|---|---|---|
| Keyword list | table | Saved list or Topic Bank, columns (volume, KD, CPC, intent, trend) |
| Keyword overview | KPI row | Keyword, country |
| Domain overview | KPI row, line | Domain (yours or a rival), country |
| Top pages | table | Domain, top N |
| Rival domains | table | Domain, top N |
| Keyword gap | table, stacked bar | Rivals, bucket (missing, weak, strong) |

Research data is a snapshot from the last run; the block shows "Data from Oct 3". Schedules can re-run research before a send (costs tasks, opt-in).

### 6.5 Content

Data: `calendar_items`, `intel.ts`, `reports.ts` (`contentRows`).

| Widget | Shapes | Key settings |
|---|---|---|
| Content Plan status | KPI row, stacked bar | Stages |
| Published this period | table, list | Columns (title, keyword, URL, date) |
| Coming next | table | Next N items by due date |
| Page performance | table | Content Intelligence tags, top N |
| Google rank buckets | stacked bar | Pages |
| Update these next | list | Top N |

### 6.6 Website

Data: `/api/traffic` (GA4 via `ga4.ts`, or Umami), `/api/visitors` (`journey.ts`).

| Widget | Shapes | Key settings |
|---|---|---|
| Visits | KPI, line | Source filter |
| AI visits | KPI, line | AI assistant |
| AI share of visits | KPI, gauge | – |
| Visits by AI assistant | bar, table | Top N |
| Top landing pages | table | From AI only, or all |
| Visitors and leads | table | Score (Hot, Warm, Cold), top N |
| Key actions | KPI row | Actions to count |

Website widgets show only when the brand has GA4 or Umami connected. The Traffic and Visitors pages are tester-only today; their report widgets follow the same flag until those pages ship.

### 6.7 Search Console (new, phase 5)

Data: a new GSC connection on top of `gsc_connections` and the existing Google OAuth (`google.ts`).

| Widget | Shapes | Key settings |
|---|---|---|
| Search performance | KPI row, line | Clicks, impressions, CTR, position |
| Top queries | table | Top N, brand or non-brand, country, device |
| Top pages | table | Top N |
| Queries that are also AI prompts | table | Match to tracked prompts |
| Movers | list | Biggest gains and drops in clicks |

### 6.8 Social listening

Data: `mentions`, `social.ts`, `listen.ts`.

| Widget | Shapes | Key settings |
|---|---|---|
| Mentions | KPI, line | Source |
| Sentiment of mentions | stacked bar, donut | Source |
| Social share of voice | stacked bar | Brands |
| Threads AI cites | list | Top N |

### 6.9 Zippie

Data: `change_sets`, `changes`, `site_audits`.

| Widget | Shapes | Key settings |
|---|---|---|
| Fixes shipped | KPI, list | Period |
| Audit score | KPI, line | Site |
| Waiting for approval | list | Top N |

### 6.10 Narrative and layout

| Widget | What it is |
|---|---|
| Cover | Title, client and agency logos, period, prepared-for and prepared-by lines, cover style from the theme |
| Section header | Eyebrow, title, one line |
| Table of contents | Built from section headers, with page numbers in PDF |
| Text | Rich text with variables (section 8) |
| AI executive summary | Section 15.2 |
| AI commentary | Comments on one or more chosen blocks |
| What we did / what's next | Two lists. Can pull from Content Plan and Zippie, or be typed |
| Image | Upload or URL, fit or fill, caption |
| Agency contact card | Name, photo, email, booking link |
| Divider, spacer, page break | Layout only |

---

## 7. Shared widget settings

### 7.1 Data

| Setting | Detail |
|---|---|
| Brand | "Report brand" (default) or any brand in the workspace. Lets one report compare two brands side by side |
| Metrics | The widget's metric choices; multi-pick where the shape allows |
| Filters | AI model, topic, prompt set, country, device, page path, source, keyword list. Only the filters the source supports appear |
| Date range | "Report range" (default) or its own range (section 9) |
| Compare | Report setting, previous period, same period last year, or none |
| Top N | 3–100 |
| Sort | Any column, up or down |
| Group by | Day, week, month for trends; model, topic or brand for bars |

### 7.2 Display

| Setting | Detail |
|---|---|
| Chart type | The widget's shapes |
| Columns | Pick and order table columns |
| Number format | Auto, 1,234, 1.2K, percent, currency (workspace currency), decimals 0–2 |
| Change | Show as points, percent or hidden; show chevron |
| Goal line | A target value drawn on trends and gauges |
| Thresholds | Color a cell or KPI by rules ("visibility < 20 → red"). Colors come from the theme's good / bad tokens |
| Annotations | Mark dates on trends ("Pricing page published"). Can pull from Content Plan publish dates automatically |
| Labels | Data labels on or off, legend position |
| Sparkline | On KPIs, a small trend under the number |

### 7.3 Style

| Setting | Detail |
|---|---|
| Title / subtitle | Text with variables. Default comes from the widget |
| Note | Small text under the block, e.g. a source line |
| Colors | Theme (default) or override per series |
| Background | None, theme surface, theme tint |
| Border | None, hairline |
| Padding | Compact, normal, roomy |
| Hide when empty | On by default for scheduled reports |
| Hide on | PDF only, web only, or neither |

---

## 8. Text blocks and variables

Rich text: headings, bold, italic, links, bullet and numbered lists, a quote style, and inline colored tags.

Type `{{` to insert a variable. Variables resolve at render time for the report's brand and range.

| Variable | Example |
|---|---|
| `{{brand}}` / `{{brand_domain}}` | Acme / acme.com |
| `{{period}}` / `{{period_start}}` / `{{period_end}}` | September 2026 / Sep 1 / Sep 30 |
| `{{compare_period}}` | August 2026 |
| `{{visibility}}` / `{{visibility_change}}` | 38.4% / +6.1 pts |
| `{{sentiment}}`, `{{position}}`, `{{rank}}` | 74, #2.3, 2 of 12 |
| `{{top_competitor}}` / `{{top_competitor_visibility}}` | HubSpot / 61% |
| `{{best_model}}` / `{{worst_model}}` | Perplexity / Gemini |
| `{{new_citations}}` | 7 |
| `{{published_count}}` | 4 |
| `{{ai_visits}}` / `{{ai_visits_change}}` | 1,240 / +18% |
| `{{agency}}` / `{{prepared_by}}` | Northwind Digital / Dana Ruiz |

A variable with no data renders as "–" and shows a warning in the editor.

---

## 9. Date ranges

### 9.1 Choices

| Preset | Meaning |
|---|---|
| Last 7 / 30 / 90 days | Ending yesterday (today's data is incomplete) |
| Last full week | Monday to Sunday before this week |
| Last full month | The calendar month before this one |
| Last full quarter | The calendar quarter before this one |
| Month to date / Quarter to date / Year to date | Up to yesterday |
| Custom | Any start and end on a calendar picker |

**Compare to:** previous period (same length, right before), same period last year, custom, or none.

### 9.2 Rules
- All dates use the workspace timezone (`workspaces.timezone`).
- Ranges can't start before the plan's `historyDays`. The picker greys those days and says "Pro keeps 365 days".
- When a range starts before the brand began tracking, the block shows data from the first day it has and notes "Tracking started Aug 14".
- Schedules always use relative presets, so each send covers the right period.
- A block's own range overrides the report range. The block's title gets a small range tag so readers aren't confused.

---

## 10. Themes

### 10.1 Theme fields

Built on `ReportTheme` in `reportTheme.ts`, extended.

| Group | Fields |
|---|---|
| Colors | Accent, accent 2, hero background, hero text, paper, surface, ink, body text, muted text, good, bad, chart series 1–6 |
| Type | Heading font, body font, number font (Google Fonts list), heading weight, base size |
| Shape | Corner radius 0–28, card style (elevated, outline, tinted, flat), divider style |
| Cover | Layout: dark, gradient, light, split, photo, minimal. Background image upload with dim slider |
| Page | Header (logo, report name, period), footer (custom line, page numbers "3 / 12"), margins |
| Logos | Agency logo, client logo, placement on cover and header, size |
| Charts | Line width, point style, grid lines on or off, "you" always uses the accent |

### 10.2 Theme sources
- The 8 built-in templates (Perceptric, Aurora, Executive, Editorial, Midnight, Fresh, Corporate, Noir), plus an Arrowsterr theme in brand v5.
- **Design with AI** (`/api/reports/style`, existing): describe a look or give a website.
- **Learn from a website** (`/api/reports/brand`, existing): pulls colors, fonts and logo.
- Saved workspace themes. Agency can save one per client brand and set it as that brand's default.

### 10.3 Checks
- Live contrast check on every text color against its background. Text below 4.5:1 shows a warning with a one-click fix.
- Fonts load from Google Fonts in the browser and are embedded in the PDF.

---

## 11. White label

Agency and Enterprise. Enforced on the server: the report API strips white-label settings for lower plans.

| Item | Detail |
|---|---|
| Arrowsterr footer | Removed from reports, links, PDFs and emails |
| Logos and colors | Agency logo and theme everywhere, including the link page's favicon and title |
| Custom link domain | E.g. `reports.northwind.com` |
| Custom sender | E.g. `reports@northwind.com` |
| Client portal | Section 13.4, on the custom domain |
| Login emails | Portal sign-in emails come from the custom sender with the agency's logo |

### 11.1 Custom link domain flow
1. The agency types the domain in Settings → White label.
2. We create a Cloudflare for SaaS custom hostname and show the CNAME record to add (`reports.northwind.com → reports.arrowsterr.com`).
3. A status tag shows Pending DNS, Issuing certificate, or Live. We check every 5 minutes for 72 hours and email when it goes live.
4. Once live, every new link uses the domain. Old links keep working on both hosts.

### 11.2 Custom sender flow
1. The agency types the sender address.
2. We add the domain in Resend and show its DNS records (SPF, DKIM, return path).
3. Status: Pending, Verified, Failed. Until verified, emails go from `reports@arrowsterr.com` with the agency name as the sender name and the agency's email as Reply-To.

---

## 12. Outputs

### 12.1 Live link
- `/r/[token]` renders the saved report with fresh data when opened.
- Data is cached for 1 hour per report. The cover shows "Data as of Oct 16, 9:00".
- The page is responsive (web layout on phones), `noindex`, and fast: under 1.5 s to first paint from cache.
- The page toolbar has Download PDF and, if allowed by the link, Download data.

### 12.2 Frozen link
- The same page, rendered from a stored snapshot of every block's data.
- Every scheduled send creates one, so the email, the PDF and the link always match.

### 12.3 PDF
- Rendered on the server: a `report_pdf` job on the Fly worker opens `/r/print/[token]` in Playwright (Chromium), waits for the page's `data-ready` flag, and prints.
- A4 or US Letter, the report's orientation and margins.
- Fonts embedded, text selectable, links clickable, the table of contents clickable.
- Page breaks never split a KPI, chart or table header. Tables longer than a page continue with their header row repeated.
- Targets: under 15 seconds for 20 pages, under 8 MB.
- Stored in Supabase Storage for 90 days; downloads use a signed URL valid for 1 hour.
- File name: `Brand – Report name – Period.pdf`.

### 12.4 Other exports
| Output | Detail |
|---|---|
| HTML | The existing self-contained download, rebuilt on the block renderer |
| CSV | One table widget |
| XLSX | Every table in the report, one sheet per block, plus a cover sheet with range and brand |
| PNG | One chart at 2× for slides, transparent or themed background |
| Google Slides (later) | One slide per block, using the theme colors |

### 12.5 Email
- A short branded email: logo, title, period, 4 headline KPIs with change, the AI executive summary (if present), and a "View report" button.
- The PDF is attached when chosen (Resend's attachment limit is 40 MB total, check; we stop at 15 MB and send the link only above that).
- Built as table-based HTML with inline styles. Tested in Gmail, Outlook 365, Outlook desktop and Apple Mail, in light and dark.
- A plain-text version is always included.

---

## 13. Sharing and the client portal

### 13.1 Share dialog

| Field | Detail |
|---|---|
| Link type | Live (default) or Frozen at the current data |
| Password | Optional. Stored as a hash (argon2). Viewers enter it once per browser |
| Expires | Never, 7 days, 30 days, 90 days, or a date |
| Allow downloads | PDF, data, or both |
| Copy link | The link on the custom domain when set |
| Existing links | List with type, created, expiry, views, last opened, and Revoke |

### 13.2 Link rules
- Tokens are 64 hex characters (as today). Old `shared_reports` tokens keep working through the new table.
- Revoked or expired links show a branded "This report is no longer shared" page, not an error.
- A link opens only the report it was made for. It never exposes other data in the workspace.

### 13.3 Views
- We count a view per browser per day (a random id in localStorage). No IP addresses are stored.
- The list and the share dialog show total views and last opened.
- Optional email to the report owner on first open by a client (off by default).

### 13.4 Client portal (Agency)
- One branded page per client brand: `reports.northwind.com/acme`.
- It lists every report shared with that client, newest first, with period and a "New" tag for unread ones.
- Clients sign in with a 6-digit email code. The agency controls which emails can sign in.
- Clients never see the Arrowsterr app and use no seats.
- Agency settings: welcome line, contact card, which reports appear automatically (e.g. every scheduled send).

### 13.5 Embeds
- An iframe code for a whole report or one block, with optional height and theme override.
- Embeds use their own token, revocable on its own.

---

## 14. Scheduling and delivery

### 14.1 Schedule panel

| Field | Detail |
|---|---|
| Repeat | Weekly (day), every 2 weeks (day), monthly (day 1–28 or "first Monday", "last weekday"), quarterly (first day of quarter or "first Monday") |
| Time | Hour and minute, in the workspace timezone |
| Range | Relative preset (defaults to match the repeat, e.g. monthly → Last full month) |
| Recipients | To and CC, up to 25 each. Saved recipient lists per brand. Emails are checked as you type |
| Subject | Text with variables. Default: "{{brand}} report · {{period}}" |
| Message | Short text with variables, shown above the KPIs |
| Attach PDF | On or off |
| Include link | Live, frozen, or none |
| Portal | Also post to the client portal (Agency) |
| Wait for data | On by default: holds the send until that day's data run finishes, up to 6 hours |
| Re-run research | Optional: refresh keyword and domain widgets before sending (costs tasks) |

Buttons: Save schedule, Send test to me, Send now.

### 14.2 How a send runs
1. The scheduler (existing `schedule` handler in `src/lib/worker/handlers.ts`) finds schedules with `next_run_at` in the past and enqueues one `report_send` job each.
2. The job checks that data for the period is in (the day's `rollup` is done). If not, it re-queues itself in 30 minutes.
3. It claims the send key `(schedule_id, period)` in `report_sends`. If the key exists, it stops. This is what guarantees a client never gets the same report twice.
4. It resolves every block and stores a frozen snapshot plus a version of the doc.
5. It writes AI commentary if the report has any (Batch API).
6. It renders the PDF (a `report_pdf` job) if attached.
7. It sends through Resend with an idempotency key, and records the Resend message id.
8. It sets `next_run_at` and marks the send Sent.

### 14.3 Failures
- Each step retries up to 3 times with backoff (1, 5 and 30 minutes).
- After the last retry, the send is marked Failed. The owner gets an email and a Slack message (if Slack is on), with the error and a "Retry send" link.
- Blocks with errors are hidden from the output, and the send log lists them. The send only fails if the cover or every KPI fails.
- Bounces and complaints come back through Resend webhooks. A recipient that hard-bounces is flagged in the schedule and skipped next time.

### 14.4 Send history
For each schedule: date, period, status tag (Sent, Failed, Skipped, Sending), recipients, opens (from Resend), the frozen link, the PDF, and Resend.

### 14.5 Plan changes
- On downgrade below the schedule limit, the oldest schedules keep running and the rest pause with a note. Nothing is deleted.
- When a workspace stops paying, all schedules pause. Live links keep working for 30 days, then show "This report is paused".

### 14.6 Edge cases
- Daylight saving: the send time follows local time; the job uses the zoned time each run.
- "Day 31" is not offered; "last weekday" covers month ends.
- A schedule on an archived or deleted report stops at once.

---

## 15. AI in reports

### 15.1 Draft a report
- **Input:** a goal in plain words, the brand, and optional choices (audience: client, boss, team; length: one page, short, full).
- **What the agent does:**
  1. Picks a starting template.
  2. Adds or removes widgets based on the brand's connected data and toolsets.
  3. Sets the range.
  4. Writes the cover title and section headers.
  5. Adds commentary blocks where they help.
- **Output:** a normal report the user edits. The agent only uses widgets from the registry, through structured output validated against the doc schema.
- **Cost:** 10 tasks (same as brand guideline learning).

### 15.2 Executive summary and commentary
- **Input to the model:** the resolved data of the blocks it covers (numbers only, with labels and periods), the brand name, the audience and the tone. No raw answer text unless a quote block is covered.
- **Output (structured):** `{ text, figures: [{ value, label, blockId }] }`.
- **Number check (code, before anything is shown):**
  1. Every number in `text` must appear in `figures`.
  2. Every figure must match the block's data after rounding.
  3. On a mismatch, retry once with the error.
  4. On a second mismatch, use a template sentence built from the data ("Visibility rose 6.1 points to 38.4%.").
- **Rules in the prompt:** state changes and facts. Say "likely" when guessing a cause. Never invent a cause the data doesn't show. No hype words.
- **Settings per report:** tone (plain, formal, upbeat), length (2, 4 or 6 sentences), language (any language the brand tracks), reading level.
- **Editing:** the user can edit the text. An edited block is marked "Edited" and isn't rewritten on the next send unless the user turns "Rewrite each send" back on.

### 15.3 Model and cost
- **Claude Sonnet 5.5** for anything a client reads.
- Scheduled sends use the **Batch API** (half price), since they aren't urgent.
- Prompt caching on the fixed instructions.
- Each summary or commentary costs 3 tasks (`TASK_COST.ai`). Commentary on scheduled sends draws from the plan's task budget; if the budget is empty, the send goes out without commentary and the owner is told.

---

## 16. Built-in templates

Each template is a stored report doc, so adding one needs no code. Page lists are for the paged layout.

### 16.1 Templates

**Monthly client report** (6 pages; AI Visibility)
1. Cover · AI executive summary.
2. AI scorecard · Visibility trend with rivals.
3. Visibility by AI model · Topic × model grid.
4. Share of voice · Competitor table · Quadrant.
5. Wins and drops · Gaps.
6. Published this period · Coming next · Agency contact card.

**AI visibility deep dive** (8 pages; AI Visibility)
1. Cover.
2. Scorecard · Trend by model.
3. Topic × model grid · Prompt table.
4. Prompt deep dives for the 3 biggest gaps.
5. Top cited domains · Your cited pages.
6. Sites citing rivals, not you.
7. Answer stability · New brands appearing.
8. AI commentary on actions.

**Competitor battle report** (4 pages)
1. Cover.
2. Battle card against a chosen rival · Head-to-head by model.
3. Rank over time · Quadrant.
4. Sites citing them, not you.

**Content performance** (4 pages; Content)
1. Cover.
2. Content Plan status · Published this period.
3. Page performance · Google rank buckets.
4. Update these next · Coming next.

**Website and AI traffic** (4 pages; Website)
1. Cover.
2. Visits, AI visits, AI share.
3. Visits by AI assistant · Top landing pages from AI.
4. Visitors and leads.

**Executive one-pager** (1 page; all)
- Cover strip · Scorecard · Visibility trend · AI executive summary · Wins and drops.

**Quarterly business review** (10 pages; Agency)
- Quarter range compared with last quarter, every source the brand has, a "what we did" and "what's next" page, and goals.

**New client audit** (6 pages; Agency, used for pitches)
- Prospect brand against 3 rivals.
- Gaps, sites citing rivals, keyword gap.
- A 90-day plan text block.

**Keyword opportunity report** (4 pages; SEO)
- Keyword list · Keyword gap · Top pages of rivals · Topic Bank picks.

**Search Console report** (4 pages; SEO, phase 5)
- Search performance · Top queries · Top pages · Queries that are also AI prompts.

**Social listening report** (3 pages; phase 5)
- Mentions · Sentiment · Social share of voice · Threads AI cites.

**Zippie work log** (2 pages)
- Fixes shipped · Audit score · Waiting for approval.

### 16.2 Template behavior
- Widgets a brand can't use (no GA4, wrong toolset) are left out when the template is applied. A note at the top of the builder says which ones and how to turn them on.
- Templates carry their theme unless the brand has its own.

### 16.3 Save as template
- From the builder's menu or the list.
- **Fields:** name, category, description, thumbnail (auto), and "Locked" (Agency).
- **What a template keeps:** layout, widgets, settings, theme and text. It drops brand-specific values (a picked prompt, rival or keyword list); those become "pick when applied".

---

## 17. Agency features

### 17.1 Locked templates
A locked template's reports can't move, delete or add blocks. Editors can still change text, filters and ranges. Only workspace owners and admins can unlock.

### 17.2 Apply a template to many brands
1. Pick a template.
2. Pick brands (search, select all, or by tag), up to 200.
3. Pick "pick when applied" values per brand, or let us choose the defaults (top rival by visibility, top 3 gap prompts).
4. Choose naming ("Template · Brand") and an optional schedule for all.
5. Review: a table of brands with any widgets that will be left out.
6. Create. A progress bar runs; each report is a job, so a failure on one brand doesn't stop the rest.

### 17.3 Push template updates
- When a template changes, its reports show "Template updated".
- The owner can open "Push update": a list of reports made from it, each marked Unchanged or Edited since created.
- Preview the change on one brand, then push to all or to the selected ones. Edited reports offer "keep my text" (default) or "replace all".

### 17.4 Roles
| Role | Reports |
|---|---|
| Owner, Admin | Everything, plus white label, domains, portals and template locks |
| Editor | Create, edit, share and schedule |
| Viewer | Open, preview and download |
| Client (portal) | Only reports shared to their portal |

---

## 18. "Add to report" from anywhere

- Every chart and table in the app (Prompts, Competitors, Sources, Keyword Research, Content Plan and others) gets an "Add to report" item in its menu.
- It opens a small dialog: pick a report (recent first) or "New report", then "Add".
- The block lands at the end of the report with the same filters the page had (model, topic, range).
- This is the fastest way to build: browse the app, collect views, then arrange.

---

## 19. Plans and limits

Uses the existing `reports` entitlement in `src/lib/plans.ts`, enforced in every `/api/reports/*` route.

| | Free | Starter | Pro | Agency | Enterprise |
|---|---|---|---|---|---|
| Saved reports | 1 | 10 | 50 | Unlimited | Unlimited |
| Builder | Templates only, no layout changes | Yes | Yes | Yes | Yes |
| Widgets | AI Visibility basics (8) | Their toolset | All | All | All |
| Templates | 3 basic | All | All | All, plus locked agency templates | All |
| Saved themes | 1 | 3 | 10 | Unlimited | Unlimited |
| Links | Frozen | Live and frozen | Plus password and expiry | Same | Same |
| PDF, CSV, PNG | PDF | Yes | Yes | Yes | Yes |
| XLSX | – | – | Yes | Yes | Yes |
| Schedules | – | 2 | 20 | Unlimited | Unlimited |
| Recipients per schedule | – | 5 | 25 | 25 | 50 |
| Versions kept | 30 days | 180 days | 180 days | 2 years | 2 years |
| White label, custom domain and sender | – | – | – | Yes | Yes |
| Client portal | – | – | – | Yes | Yes |
| Apply template to many brands | – | – | – | Yes | Yes |
| AI draft, summary, commentary | Tasks | Tasks | Tasks | Tasks | Tasks |

Limits stop new things only. Over a limit after a downgrade, everything keeps working except creating more; extra schedules pause (14.5).

---

## 20. Data model

One new migration (`supabase/043_reports.sql`). All tables use RLS (viewers read, editors write). Public reads go only through the token route with the service role.

```sql
reports (
  id uuid pk, workspace_id uuid fk, brand_id uuid fk,
  name text, doc jsonb,                 -- pages, blocks, settings (versioned schema, doc.v)
  layout text check (layout in ('paged','web')),
  range jsonb,                          -- { preset, start?, end?, compare }
  theme_id uuid fk null, template_id uuid fk null, template_version int,
  locked boolean default false,
  created_by uuid, updated_by uuid, created_at, updated_at, archived_at
)  index (workspace_id, updated_at desc), index (brand_id)

report_versions (id, report_id fk, doc jsonb, name text null, created_by, created_at)
  index (report_id, created_at desc)

report_templates (
  id, workspace_id null,                -- null = built-in
  name, category, description, doc jsonb, version int,
  locked boolean, thumb_path text, created_by, updated_at
)

report_themes (id, workspace_id, brand_id null, name, theme jsonb, is_default boolean, updated_at)
  -- report_styles rows move here as each workspace's default theme

report_links (
  id, report_id fk, token text unique, mode text check (mode in ('live','frozen')),
  snapshot jsonb null, password_hash text null, expires_at null, revoked_at null,
  allow_pdf boolean, allow_data boolean, views int default 0, last_viewed_at null,
  kind text default 'link',             -- link | embed | portal
  created_by, created_at
)  -- shared_reports rows copy in as frozen links with the same tokens

report_schedules (
  id, report_id fk, cadence jsonb, tz text, send_time time,
  range_preset text, recipients jsonb, subject text, body text,
  attach_pdf boolean, link_mode text, to_portal boolean,
  wait_for_data boolean, rerun_research boolean,
  paused boolean, paused_reason text null, next_run_at timestamptz, created_by, updated_at
)  index (next_run_at) where not paused

report_sends (
  id, schedule_id fk, report_id fk, period text,     -- e.g. '2026-09'
  status text, link_id fk null, pdf_path text null,
  resend_id text null, recipients jsonb, opens int default 0,
  error text null, attempts int default 0, started_at, sent_at,
  unique (schedule_id, period)
)

report_cache (spec_hash text, workspace_id, range_key text, data jsonb, computed_at,
  primary key (spec_hash, range_key))   -- pruned after 7 days

report_comments (id, report_id, block_id, body, author, resolved_at, created_at)

client_portals (id, workspace_id, brand_id, slug, domain text null,
  allowed_emails jsonb, settings jsonb, created_at)

white_label (workspace_id pk, link_domain text, link_domain_status text, cf_hostname_id text,
  sender_email text, sender_status text, resend_domain_id text, updated_at)
```

Job kinds added to the queue: `report_send`, `report_pdf`, `report_apply` (one brand of a bulk apply), `report_thumb`.

---

## 21. API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/reports` | GET, POST | List (with filters, paging) and create |
| `/api/reports/[id]` | GET, PATCH, DELETE | Read, save (JSON patch), delete |
| `/api/reports/[id]/data` | POST | Resolve blocks (all, or a list of block ids) |
| `/api/reports/[id]/versions` | GET, POST | List, name a version, restore |
| `/api/reports/[id]/links` | GET, POST, DELETE | Share links |
| `/api/reports/[id]/schedules` | GET, POST, PATCH, DELETE | Schedules; `/send-now`, `/test` |
| `/api/reports/[id]/pdf` | POST | Queue a PDF, returns a job id |
| `/api/reports/[id]/export` | POST | CSV, XLSX, PNG |
| `/api/reports/draft` | POST | AI draft (15.1) |
| `/api/reports/commentary` | POST | AI summary or commentary (15.2) |
| `/api/reports/templates` | GET, POST | List and save templates; `/apply` for bulk |
| `/api/reports/themes` | GET, POST, PATCH | Themes (existing `/style` and `/brand` move under here) |
| `/api/white-label` | GET, PATCH | Domains and sender, with status checks |
| `/r/[token]`, `/r/print/[token]` | GET | Public and print views |
| `/api/webhooks/resend` | POST | Delivery, open and bounce events |

Every route checks role, plan and toolset, and uses `meteredRoute` for anything that spends tasks.

---

## 22. Widget registry

One file per widget in `src/lib/reports/widgets/`, all listed in `src/lib/reports/registry.ts`.

```ts
export type Widget<C, D> = {
  id: string;                         // "ai.visibility_trend"
  source: "ai" | "competitors" | "sources" | "research" | "content" | "website" | "gsc" | "social" | "zippie" | "layout";
  title: string;
  shapes: Shape[];                    // first is the default
  toolset?: "ai" | "seo";             // Starter's single toolset
  minPlan: Plan;
  size: { minCols: number; minRows: number; defaultCols: number; defaultRows: number };
  config: z.ZodType<C>;               // drives the inspector and validates saved docs
  defaults: C;
  resolve(spec: BlockSpec<C>, ctx: ResolveCtx): Promise<D | Empty>;   // server only
  render(props: { data: D; spec: BlockSpec<C>; theme: ReportTheme; mode: "edit" | "web" | "print" }): JSX.Element;
  variables?(data: D): Record<string, string>;   // feeds section 8
  figures?(data: D): Figure[];                   // feeds the AI number check
};
```

- `resolve` reads `daily_metrics` first (cheap, already summed), then `runs`, `answers` and the research tables when needed.
- Results are cached in `report_cache` by a hash of `(widget id, config, brand, range)`.
- `render` uses only theme CSS variables, never app classes, so exports look the same everywhere.

---

## 23. Rendering, caching and speed

- **One renderer:** `ReportRenderer` lays out pages and blocks for every mode. The editor wraps blocks with selection and drag handles.
- **Charts:** hand-built SVG, extending `TrendChart`, `Donut` and `Quadrant` with theme colors, print sizes and annotations. No chart library, so PDFs stay sharp and the bundle stays small.
- **Builder libraries:** `dnd-kit` for drag and drop, and a small 12-column grid layout of our own. Rich text uses `tiptap` (check licence: MIT core).
- **Caching:** block results cached 1 hour in `report_cache`; live link pages cached 1 hour at the edge per token; thumbnails cached 7 days.
- **Speed targets:**
  - Open a 20-block report in under 1 second with warm cache.
  - Re-resolve after a range change in under 3 seconds.
  - Live link first paint in under 1.5 seconds.
  - PDF in under 15 seconds for 20 pages.
- **Limits:** 50 pages and 300 blocks per report. A single block's data is capped at 5,000 rows (tables page in the web view and cut with "and 1,240 more" in PDF).

---

## 24. API, MCP, webhooks and Zapier

- **REST API v1:**
  - `GET /api/v1/reports`
  - `GET /api/v1/reports/{id}`
  - `POST /api/v1/reports/{id}/send`
  - `GET /api/v1/reports/{id}/pdf`
- **MCP:**
  - New tools `list_reports`, `get_report_data`, `send_report`.
  - The existing `weekly_ai_visibility_report` prompt can create a saved report.
- **Webhooks (and Zapier):**
  - `report.sent`
  - `report.failed`
  - `report.viewed` (first view by a client)

---

## 25. Security and privacy

- Tokens are 64 hex characters from a secure random source. Passwords are hashed with argon2. Password attempts are rate-limited (10 per hour per link and IP).
- Public pages read through the service role, but only the data the report's blocks ask for, scoped to the report's workspace and brands.
- Print pages (`/r/print/`) only accept a short-lived signed token issued to the worker.
- No IP addresses are stored for views; only a random per-browser id.
- Uploaded logos and images are checked for type and size (5 MB), and SVGs are sanitized.
- Every report API change is logged with user and time (who shared, who scheduled, who deleted).
- Portal sign-in codes expire in 10 minutes and allow 5 tries.

---

## 26. What we measure

- Reports created per workspace, and by which way in (template, scratch, AI, "Add to report").
- Share of active workspaces with at least one schedule.
- Sends per month, failure rate, and the top failure reasons.
- Client opens per send, and views per live link.
- Time from "New report" to first share.
- Widgets used most and least (guides what to build next).
- Upgrades started from a report limit or a white-label lock.

---

## 27. Tests

Every phase ships with tests in `tests/` (Node test runner, as today):

- **Resolvers:** each widget's `resolve` against fixture data, including empty and partial ranges.
- **Doc schema:** old and new docs validate; migrations between doc versions.
- **Plan gating:** every report route, for each plan, including white-label stripping.
- **Send once:** a forced retry and a double scheduler run still send one email (the flaky case the reliability rule asks for).
- **Wait for data:** a send holds while the day's rollup is missing.
- **Number check:** commentary with one wrong number is caught, retried, then replaced by the template sentence.
- **Links:** expired, revoked and wrong-password links return the right page.
- **PDF:** a snapshot test of 3 templates (page count, text present, no blank pages).
- **Email:** HTML snapshot for each email, and a plain-text version present.

---

## 28. Phases

### Phase 1: Foundation (2–3 weeks)
- **Scope:**
  - `reports` and `report_versions` tables.
  - Report library (list, filters, row actions, first-visit screen).
  - The current 10 blocks rebuilt on the widget registry.
  - Date ranges and compare.
  - Plan gating on all report routes.
  - `report_links` with live, frozen, password, expiry, revoke and views.
  - Server PDF on the Fly worker.
  - Move `shared_reports` and `report_styles` across.
- **Done when:**
  - A saved report survives a reload.
  - Old share tokens still open.
  - A live link shows new data the next day.
  - The PDF matches the preview.
  - White label is refused below Agency.
- **Built (October 2026):**
  - Tables: `supabase/043_reports.sql` (`reports`, `report_versions`, `report_links`, the `report-pdfs` bucket). Old `shared_reports` tokens are copied into `report_links` as frozen links.
  - Routes: `/api/reports/list`, `create`, `data`, `links`, `pdf`, `summary` (saved reports), `/api/pdf/next`, `done`, `fail` (the worker), `/api/r/view`, `/api/r/unlock` (public links).
  - Pages: the library and editor at `/reports` and `/reports?report=<id>`, public links at `/r/<token>`, the worker's print page at `/r/print/<id>`.
  - PDFs: the Fly worker (`scripts/worker.mjs`) runs Chromium from the Playwright image and prints `/r/print/<id>` to A4. If no worker takes the job in 90 seconds, the editor offers browser print.
  - Prompts, Competitors and Content Intelligence reports are still built in the browser from the app's dates, so they share as frozen links only.
  - Setup: run `043_reports.sql` in Supabase. Optional: set `REPORT_LINK_SECRET` on the app (otherwise it signs with `SUPABASE_SECRET_KEY`).
- **Running cost of phase 1:**

  | Item | Beta (50 teams) | Growth (500 teams) |
  |---|---|---|
  | Fly worker from 256 MB to 1 GB for Chromium (shared-cpu-1x) | +$3.70 (check) | +$9.40, two 1 GB machines (check) |
  | Claude tokens: AI summaries on Sonnet 5.5 (≈250 / 2,500 a month at ≈$0.04, paid for by tasks) | $10 | $100 |
  | Supabase Storage for PDFs (last 5 per report) | $0, inside the current plan (check) | $0 (check) |
  | Live link builds: cached an hour, run on the app server | $0 | $0 |
  | **Monthly total** | **≈ $14** | **≈ $110** |

### Phase 2: Builder (3–4 weeks)
- **Scope:**
  - Canvas, grid, drag and resize, inspector, outline and pages tabs.
  - Undo, copy and paste, keyboard.
  - The first 40 widgets: AI Visibility, Competitors, Sources, Content and Website.
  - Theme manager and contrast checks.
  - Text blocks with variables.
  - 6 built-in templates.
- **Done when:**
  - A user rebuilds the Monthly client report from scratch in under 10 minutes.
  - 50 blocks stay smooth.
  - Undo covers every change.

### Phase 3: Delivery and AI (2–3 weeks)
- **Scope:**
  - Schedules, the send pipeline, send history, retries, alerts and Resend webhooks.
  - Email template.
  - AI executive summary and commentary with the number check.
  - Draft with AI.
  - CSV, XLSX and PNG exports.
  - "Add to report" from app pages.
- **Done when:**
  - A monthly schedule sends on time for 3 test months in a row (time-travel test).
  - No double sends under forced retries.
  - No commentary ships with a number the data doesn't have.

### Phase 4: Agency (2–3 weeks)
- **Scope:**
  - White-label settings.
  - Custom link domain (Cloudflare for SaaS) and custom sender (Resend domains).
  - Client portal with email codes.
  - Locked templates.
  - Apply template to many brands, and push updates.
  - Remaining 6 templates.
- **Done when:**
  - An agency sets up its domain and sender and sends 50 client reports from one template, with no Arrowsterr branding anywhere.

### Phase 5: More data (3–4 weeks)
- **Scope:**
  - Search Console connection and widgets.
  - Organic research and keyword gap widgets.
  - Social listening widgets.
  - Zippie widgets.
  - Report endpoints in the API, MCP tools and webhooks.
  - Looker Studio connector.
- **Done when:**
  - Every product area has at least 3 widgets.
  - Search Console data matches Google's own UI for the same range.

---

## 29. Running cost

Assumptions:
- Each team makes about 20 reports a month, and half of them go out on a schedule.
- Each report gets one AI summary and up to 8 commentary blocks in one call: about 10K tokens in and 2K tokens out on Claude Sonnet 5.5 ($2 / $10 per million tokens). That is about $0.04 a report, or $0.02 through the Batch API.
- Each scheduled send goes to about 2.5 recipients.

| Item | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Claude tokens: AI commentary and drafts (1,000 / 10,000 reports a month, half batched) | $30 | $300 |
| PDF rendering: larger Fly worker for Chromium (2 GB, then 2 machines) | $10 (check) | $25 (check) |
| Email: Resend Pro, needed for first-of-month spikes over the free tier's 100 a day (≈1,250 / 12,500 report emails a month) | $20 (check) | $20 (check) |
| Storage: PDFs, snapshots and thumbnails in Supabase Storage (≈1 GB / 10 GB a month, kept 90 days) | $0, inside the current plan (check) | $0–5 (check) |
| Custom domains: Cloudflare for SaaS custom hostnames (first 100 free, then $0.10 each) | $0 (check) | $0 (check) |
| Google Search Console API | $0 | $0 |
| **Monthly total** | **≈ $60** | **≈ $350** |

If the app already pays for Resend Pro for the weekly emails, the email line is $0 at both stages. AI commentary is paid for by tasks (`TASK_COST.ai`), so the token cost grows with what teams already pay for.

---

## 30. Open questions

1. Report and schedule limits per plan (section 19) are a proposal. Confirm before phase 1.
2. Should Free get one scheduled monthly report as a hook to upgrade?
3. Client portal: email-code sign-in only, or also Google sign-in?
4. Should "Re-run research before send" be on by default for SEO templates, given it costs tasks?

---

## 31. Brand Kits, templates by purpose and the module builder

October 2026 update. This replaces the free grid builder of phase 2 with a module builder, adds Brand Kits, and groups the templates in section 16 by what they are for. Phases A to D below run in place of phases 2 and 4. Phases 3 and 5 stay as they are.

### 31.1 Brand Kit

- **What it holds** (`BrandKit` in `src/lib/brandKit.ts`): name, logo, whether the logo needs a dark ground, eight colors (main, second, headings, text, small notes, page, cards, borders), heading and text fonts from the report font list, corner radius, a footer line, and a tone of voice (up to 3 words and a sample line).
- **Where it lives:** `brand_kits` (`supabase/045_brand_kits.sql`). One kit for the workspace (key `workspace`) and one per client brand (key = brand id). A style saved in `report_styles` becomes the workspace kit when the file runs.
- **How it is learned:** `POST /api/brand-kit` reads the homepage (`readBrand`), sends the measured colors and fonts at once, then asks Claude for the kit (`learnKit` in `src/lib/brandKitServer.ts`). The reply streams one JSON line per part. It costs 10 tasks, the same as a brand guideline.
- **Checks** (`cleanKit`, tested in `tests/brandKit.test.ts`):
  - Every text color must reach 4.5:1 on both cards and page. If one fails, a readable color takes its place.
  - A logo must be an https address or an inline image. If the agent's pick doesn't match a real option, the kit has no logo, and the name is set in the heading font instead.
  - Broken fields fall back to Arrowsterr's look.
- **Every plan gets a Brand Kit.**
  - Starter and Pro: reports use the team's own kit and keep "Made with Arrowsterr".
  - Agency and Enterprise: the footer goes, and each client brand can have its own kit.

### 31.2 Onboarding: Your brand

- After the website step, Zippie learns the kit on screen while the research runs (`KitStep` in `Onboarding.tsx`, `KitLearn` in `BrandKit.tsx`). Only the first onboarding of a workspace shows it.
- If the user picked "Agency" as their role, the step asks for the agency's own website first (guessed from a work email), because that kit brands the reports the agency sends. Everyone else learns from the site they just entered.
- **The show, in order:**
  1. Scanning the site
  2. Its colors
  3. Its fonts
  4. Its logo
  5. A report cover changing from Arrowsterr's colors into theirs
  6. "Brand Kit saved"

  Each stage waits for its real data and stays at least 0.85 seconds. With reduced motion, the finished kit shows at once.
- "Looks right" marks the kit as confirmed. "Use another website" learns again. A failure offers Try again or Skip for now and never blocks onboarding.
- **Settings → Brand Kit** edits every field with a live cover and offers "Learn again". On Agency it also lists client brands, each with Learn.

### 31.3 Templates by purpose

The library opens on a board with one column per purpose. The templates are the ones in section 16.

| Purpose | Templates |
|---|---|
| Win the client | New client audit, AI visibility snapshot |
| Monthly reporting | Monthly client report, Executive one-pager |
| Beat competitors | Competitor battle report |
| Content and SEO | Content performance, Keyword opportunity |
| Quarterly review | Quarterly business review, Website and AI traffic |

### 31.4 Module builder

- A report is a stack of modules: cover, KPI scorecard, trend chart, by AI model, competitor table, cited sources, wins and drops, content published, AI summary, text, section header, contact card.
- Each module has 2 to 3 layouts. Add a module between any two, drag to reorder, duplicate, or delete. Clicking a module opens its settings.
- Chat on the left edits the selected module ("make this a table", "shorter summary"). Edits use tasks.
- The same renderer draws the editor, live link, PDF and email (principle 2).

### 31.5 Style switch

Every report has a Style switch:
- **Agency brand:** the default on Agency.
- **Client brand:** the client's kit, for clients who want the report to look like their own.
- **Arrowsterr.**
- **Saved styles.**

Chat can restyle with AI ("darker", "match their pitch deck"). It changes colors and fonts, never data. The result is saved as a style under that client, and that client's later and scheduled reports use it. On Starter and Pro the switch shows the team's own kit and Arrowsterr only. The server drops client kits and the footer setting below Agency.

### 31.6 Phases

| Phase | Work | Time | State |
|---|---|---|---|
| A | Brand Kit table, the learning route, Settings → Brand Kit, the onboarding step and its animation | 1–1.5 weeks | Built (October 2026) |
| B | Module registry, builder canvas, settings panel, chat edits, autosave on `reports` | 2–3 weeks | Next |
| C | The template board and its 9 templates as stored docs | 1 week | |
| D | Kit → report theme everywhere (report, live link, PDF, email, portal), the Style switch, client kits learned in the background when a brand is added, plan checks on the server | 1 week | |

Setup for phase A: run `supabase/045_brand_kits.sql` in Supabase. Until phase D, reports still read `report_styles`.

### 31.7 Running cost

Added on top of section 29.

| Item | Beta (50 teams) | Growth (500 teams) |
|---|---|---|
| Claude tokens to learn kits: about 6K in and 1.5K out each on Sonnet 5.5 ($2 / $10 per million, check), ≈ $0.03. About 150 a month at Beta and 2,000 at Growth, with agency client kits and re-learns | $5 | $60 |
| Chat edits to modules and restyles (paid for by tasks) | $5 | $50 |
| Reading sites: one fetch of the homepage and up to 5 stylesheets on the app server | $0 | $0 |
| Kit storage in Supabase (a few KB a kit; logos are links or small inline SVGs) | $0 (check) | $0 (check) |
| **Monthly total added** | **≈ $10** | **≈ $110** |
