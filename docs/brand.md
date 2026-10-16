# Arrowsterr brand (v5)

The full brand system. The live version with component previews is the Arrowsterr Brand design system: https://claude.ai/artifact/UPHjbokXkgMsfgTZuJ5KbN. The stylesheet for the website, embeds, emails and decks is `public/brand/arrowsterr-brand.css` (served at `https://app.arrowsterr.com/brand/arrowsterr-brand.css`). The app's own rules live in `src/app/brand.css`, `brand-v2.css` and `twenty.css`.

Arrowsterr is **the Navigator**: a sharp, upbeat guide who shows you where AI sends your buyers and points at your next move. Every screen points somewhere. Numbers come before claims. One spark of gold marks the win.

The look starts from a calm, grey product UI (hairline borders, 13px Inter, 32px rows) and adds a short list of moves that only Arrowsterr makes: Funnel Display headlines with a Signal Blue payoff, the Climb chevrons, the Notch on the main button, and a single gold Spark when something good happens.

## How to use this system

- Build product screens, the website, blog embeds, emails and decks from these tokens and components. Never hard-code a hex value that has a token.
- Outside the app, load `arrowsterr-brand.css` and wrap the block in `<div class="aw">`. Add `data-theme="dark"` for the dark theme. Every class in the component cards (`aw-btn`, `aw-tag`, `aw-table` and the rest) comes from that file.
- Load three Google Fonts: **Funnel Display** (300 to 800), **Inter** (400 to 700) and **Geist Mono** (400, 500). The website body runs on Geist today; treat Geist and Inter as the same text voice.
- Read the sections in order the first time: Personality, Voice, Logo, Color, Typography, Motifs, Layout, Imagery.

## The ten brand rules

1. **Logo.** Always the SVG file from the Logos group, never the word typed out. Always set its height (`aw-logo--sm` 20px, `--md` 28px, `--lg` 40px). Clear space on every side equals the height of the sparkle.
2. **Headings.** Funnel Display (`hero`, `display`, `h1`, `h2`, `h3`) at 18px and up, weight 600 (700 for `hero`), tight tracking. Below 18px, headings are Inter 600 (`h4`).
3. **The payoff word.** One to four words of a heading may be `signal-text` (`aw-accent`). Pick the words that name what the reader gets.
4. **Titles stand alone.** At most one `lead` line under a title. Never a paragraph.
5. **Colour weight.** Greys (`bg-*`, `line-*`, `ink-*`) carry about 85% of any view, `signal` about 10%, `night` closes the page, and `spark` stays under 1%: one gold element per view.
6. **Shape.** `radius-sm` (4px) on controls and tags, `radius-md` (8px) on cards, `radius-lg` (12px) on marketing frames. Hairline `line` borders, no card shadows, no gradients, no pills.
7. **The Notch.** The primary button and featured frames have a 45 degree cut on the top-right corner (`notch`, 8px; 16px on frames). Nothing else is notched.
8. **Direction.** Arrows and chevrons point up or right. They point down only for a falling `aw-delta` or a menu that opens.
9. **Numbers.** Every number is Geist Mono with tabular figures (`num`, `stat`). Every change sits next to its number as an `aw-delta`, with a chevron and a sign, so it reads without colour.
10. **Copy.** 9th-grade words, short sentences, direct "you", verbs first. No em dashes, no emoji. Avoid "not X, Y" and "X, not Y". Avoid lists of three in prose.

## Accessibility floor

- Text meets 4.5:1 on the grounds its token note names, in both themes. `ink-4` is for disabled text only. `sky` and `spark` are shape colours; text on them uses `on-spark`, and text never sits on `sky`.
- Focus is a solid 2px `focus` ring with a 2px offset. On notched buttons the ring sits inside (an inset `on-signal` line), because the cut would clip an outside ring.
- `pos` and `neg` always come with a word or a chevron. Never tell good from bad by colour alone.
- Respect `prefers-reduced-motion`: the stylesheet drops every transition when it is set.

## Running cost

The brand system adds nothing to the monthly bill. The three fonts are free on Google Fonts and the stylesheet is a static file. Beta (50 teams): $0. Growth (500 teams): $0.

## Personality

Arrowsterr is **the Navigator**. Picture the friend in the passenger seat who has the map open, knows the shortcut and tells you to take the next exit. Calm about the problem. Excited about the win. Always pointing somewhere.

The name says it: an **arrow** for direction and a **star** for the moment you get there. The mark shows both: two chevrons climbing and a sparkle above them.

### Four traits

| Trait | It sounds like | It never sounds like |
|---|---|---|
| **Pointed** | "Add these 5 prompts. They cover 60% of what buyers ask." | "There are many ways to approach AI search." |
| **Plain-spoken** | "ChatGPT names you in 38% of answers." | "Leverage generative engine optimisation synergies." |
| **Proof-first** | "Up 6.1 points since you fixed the pricing page." | "Massive gains in visibility!" |
| **Bright** | "New citation. Perplexity now quotes your docs." | Confetti, exclamation marks, hype |

### How the traits show up in the design

- **Pointed** becomes the Climb chevrons, the eyebrow mark, arrow links and the up-and-right rule. Every view has one clear next step, painted `signal` with the Notch.
- **Plain-spoken** becomes the grey, quiet product UI: `bg`, `line`, 13px `ui` text, no decoration that does not carry meaning.
- **Proof-first** becomes Geist Mono numbers, `aw-delta` next to every figure, tables before adjectives and real charts on the website.
- **Bright** becomes the Spark: `spark` gold, used once per view, for a citation won, a rank gained or an AI answer that names you.

### Zippie

Zippie is the mascot: a small navy character (`night` body) with a gold spark (`spark`). Zippie appears on empty states, onboarding and the 404 page. Zippie never appears in the product's working screens, in charts, or next to errors. Zippie never talks in the UI; the copy stays in Arrowsterr's own voice.

## Voice and copy

Write like the Navigator talks: short, direct, and about the reader's next move.

### The rules

- **9th-grade words.** "Use" over "leverage", "show" over "surface", "check" over "audit" when both work.
- **Short sentences.** One idea each. Aim for 8 to 14 words.
- **Say "you".** Talk to one person. Use "we" only for what Arrowsterr does ("We check every prompt daily").
- **Verbs first** on buttons and headlines: "Run check", "Add prompts", "Start free", "Book a demo".
- **Numbers over adjectives.** "Named in 38% of answers" beats "great visibility".
- **No em dashes.** Use a full stop or a comma.
- **Skip the contrast trick.** Avoid "not X, Y" and "X, not Y". Say the positive thing.
- **Avoid lists of three in prose.** Two items or four items read as real; three reads as a slogan.
- **No emoji, no exclamation marks** in the product. One exclamation mark per email at most.
- **Sentence case** everywhere: headings, buttons, tabs, table headers. Product names keep their own case: ChatGPT, Perplexity, Gemini, Claude, Google AI Overviews.

### Headlines from the website

These are on-brand and show the payoff-word pattern (`aw-accent` on the bold part):

- Everything you need to win search, **in one place**
- Get named in **AI answers**
- More platform. **Better price.**
- From AI visibility to **published content**

### Product copy

| Spot | Write | Avoid |
|---|---|---|
| Primary button | Run check | Submit |
| Empty state | No prompts yet. Add the questions your buyers ask. | Nothing to see here! |
| Success | Check done. 25 prompts on 5 models. | Success! Your check has completed successfully. |
| Error | Gemini timed out on 3 prompts. We retry in 1 hour. | An error occurred. |
| Win | New citation. Perplexity now quotes your pricing page. | Amazing news! |
| Delete | Delete Acme and its 214 answers? | Are you sure? |

### Screens hold labels, buttons and real errors

Working screens carry no help text, tips or cost notes. Explaining happens once, on a tool's first screen before there is data.

### Numbers in copy

- Use digits for every number, even small ones: "3 prompts", "5 models".
- Percent with no space: "38%". Points for changes in a percent: "+6.1 pts".
- Ranks with a hash: "#1", "#3".
- Money with the symbol and no decimals when whole: "$99/mo".

## Logo

The mark is the **Climb and Spark**: an outer chevron in Signal Blue `#0943B0`, an inner chevron in Sky `#4F7FE0`, and a four-point sparkle in Signal Blue above them. The wordmark sets "Arrowsterr" in near-black `#171717` beside it.

### Files (Logos group)

| File | Use it on |
|---|---|
| `arrowsterr-logo-color.svg` | White, `bg`, `bg-2` and light photos. The default. |
| `arrowsterr-logo-white.svg` | `night`, `signal` and dark photos. All white ink `#FFFFFF`. |
| `arrowsterr-mark-color.svg` | App icon, favicon, avatar, social profile, small spaces on light grounds. |
| `arrowsterr-mark-white.svg` | The same spots on `night` or `signal`. All white ink `#FFFFFF`. |

The site serves the same files at `https://app.arrowsterr.com/brand/<file>`.

### Rules

- Always place the SVG. Never type "Arrowsterr" in a font as a logo.
- Always set the height: 20px in nav bars and footers (`aw-logo--sm`), 28px in headers and emails (`aw-logo--md`), 40px on covers (`aw-logo--lg`). Width follows.
- Clear space on every side equals the height of the sparkle (about a quarter of the mark's height).
- Smallest sizes: the full logo at 16px tall, the mark at 16px tall.
- On a dark theme surface, use the white logo, or place the colour logo on a white `aw-logo-badge` tile.
- Featured images and social cards: the colour logo in a white `aw-logo-badge`, centered at the top.

### Never

- Recolour the chevrons, swap their order, or fill the sparkle with gold. Gold is `spark`, a UI colour; the logo stays blue.
- Stretch, tilt, outline, add a shadow or put it on a busy photo.
- Pair the mark with a different wordmark font.
- Use the chevrons on their own as a logo. Alone, they are the Climb motif.

## Color

Four brand colours sit on a grey product base. Greys do most of the work so the blue can point.

### The brand four

| Token | Light | Dark | Role |
|---|---|---|---|
| `signal` | `#0943B0` | `#2F63D6` | **Signal Blue.** The one thing to click, your brand in a chart, the outer chevron. |
| `sky` | `#4F7FE0` | `#4F7FE0` | **Sky.** Inner chevron, second chart series. Shape colour only. |
| `night` | `#0B1B3F` | `#0B1B3F` | **Night.** Headlines (`ink-strong` in light), closing CTA bands, deck title slides. |
| `spark` | `#F5A70A` | `#FFC53D` | **Spark Gold.** The win. One per view. |

### How much of each

- Greys (`bg-*`, `line-*`, `ink`, `ink-2`, `ink-3`): about 85% of a view.
- `signal` and `signal-tint`: about 10%. One primary button, the accent words, your row in a table, your line in a chart.
- `night`: one band per page, usually the last.
- `spark`: under 1%. A spark tag, the win stat, the end dot of a rising line. Never more than one gold thing in sight.

### Pairs that pass (4.5:1 or more)

| Text | On | Light | Dark |
|---|---|---|---|
| `ink-strong` | `bg` | 16.9 | 16.8 |
| `ink` | `bg-3` | 11.2 | 14.1 |
| `ink-2` | `bg-3` | 5.1 | 8.0 |
| `ink-3` | `bg` | 5.0 | 5.3 |
| `signal-text` | `signal-tint` | 7.7 | 6.9 |
| `on-signal` | `signal` | 8.6 | 5.4 |
| `spark-text` | `spark-tint` | 6.2 | 9.2 |
| `on-spark` | `spark` | 8.4 | 10.7 |
| `pos` | `pos-tint` | 4.7 | 6.8 |
| `neg` | `neg-tint` | 5.0 | 6.4 |
| `on-night-2` | `night` | 9.9 | 9.9 |

### Rules

- Paint links, eyebrows and accent words with `signal-text`, never `signal`, so they stay readable in dark.
- Never set text in `sky` or `spark`. Gold words use `spark-text`.
- Put white text only on `signal`, `night` and `neg`.
- `pos` and `neg` carry a chevron or a word every time (`aw-delta`, `aw-tag--green` with "Cited").
- Charts: `signal` is you, `sky` is the closest rival, `line-strong` is everyone else. Never use more than three series colours.
- No gradients anywhere. The only blend is the chart area fill, `signal` at 8%.
- Dark theme greys follow the product: `bg` `#171717`, `bg-2` `#1B1B1B`, `bg-3` `#1D1D1D`, `bg-4` `#222222`.

## Typography

Three faces, each with one job.

| Family | Token | Job |
|---|---|---|
| **Funnel Display** | `display` | Headings 18px and up. The voice of the brand. |
| **Inter** | `sans` | Everything you read or click: body, UI, buttons, labels. |
| **Geist Mono** | `mono` | Every number, rank, delta, code and keyboard key. |

### Why Funnel Display

Funnel Display narrows as it gets heavier, a little like a funnel or a path closing in on a target. It has the geometric bones of a tech brand and a warmer, odd edge in letters like **a**, **g** and **y** that makes headlines feel like Arrowsterr and nobody else. It runs from weight 300 to 800 and is free on Google Fonts.

### The scale

| Style | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `hero` | 64 / 1.0 | 700 | -0.035em | One per page, the top headline. 40px on phones. |
| `display` | 48 / 1.05 | 600 | -0.03em | Website section heads, slide titles. 34px on phones. |
| `h1` | 36 / 1.1 | 600 | -0.025em | Post titles, email headlines. |
| `h2` | 28 / 1.15 | 600 | -0.02em | Headings inside posts. |
| `h3` | 22 / 1.2 | 600 | -0.015em | Tile titles, FAQ questions. |
| `h4` | 15 / 22 | 600 Inter | 0 | Card and panel titles in the product. |
| `lead` | 18 / 28 | 400 | 0 | The one line under a hero. |
| `body` | 16 / 26 | 400 | 0 | Website and blog copy. |
| `ui` | 13 / 20 | 400 | 0 | All product UI. |
| `label` | 12 / 16 | 500 | 0 | Tags, field labels, table headers. |
| `stat` | 40 / 1.0 | 500 mono | -0.02em | Hero numbers. |
| `num` | 13 / 20 | 500 mono | 0 | Numbers in tables and KPIs. |

### Rules

- Headings use `ink-strong`. The payoff words use `signal-text` (`aw-accent`). Never colour a whole heading blue.
- Never set Funnel Display under 18px or in all caps. Never letter-space it open.
- Use `text-wrap: balance` on headings so lines break evenly.
- Body copy runs 60 to 70 characters wide (`aw-prose`, `aw-lead`).
- Numbers are always mono and tabular, so columns line up and changes do not jiggle.
- No italics in headings. Use weight, not italics, for emphasis in body copy.
- Eyebrows (`aw-eyebrow`) are 13px Inter 600 in `signal-text` with the Climb mark. Never all caps.

## Signature motifs

Six moves make a screen look like Arrowsterr even with the logo covered. Use them on purpose and sparingly.

### The Climb

Two stacked chevrons from the mark, pointing up. It means "this way, higher".

- Eyebrows above section titles (`aw-eyebrow`).
- The info callout icon (`aw-callout`) and the pull-quote mark (`aw-quote`).
- A large, 6% white watermark in the corner of a Night panel (`aw-panel-night--climb`).
- List bullets use a single chevron turned to point right (`aw-list`).

### The Spark

The four-point star from the mark, in `spark` gold. It means "you won something".

- A spark tag (`aw-tag--spark`) for a new citation or a rank gained.
- The win stat (`aw-stat--win`) on a dashboard.
- The end dot of a line that hit a new high (`aw-chart-dot--win`).
- The "In short" label of a quick summary (`aw-summary`).
- One per view. If two things want gold, the smaller one goes blue.

### The Notch

A 45 degree cut on the top-right corner, like an arrow tip or a folded map corner.

- The primary button (`aw-btn--primary`, `aw-btn--on-night`) and the top rank badge (`aw-rank--top`). 8px cut; 10px on large buttons.
- One featured frame per section (`aw-frame--notch`), 16px cut with a `line-strong` edge.
- Nothing else is notched: never cards, inputs, tags or images.

### Target ticks

Four small L-shaped corner marks, 6px outside a box, in `signal-text` (`aw-ticks`). They say "look here".

- One per view, on the number or card you want read first.
- Never on a button or around text.

### The flight grid

A 16px dot grid in `line-strong` on `bg-2` (`aw-dotgrid`). It is the ground that product views sit on in marketing frames, featured images and slide backgrounds. Never behind body copy.

### The payoff word

One to four words of a headline in `signal-text` (`aw-accent`). Pick the words that name the result: "Get named in **AI answers**".

## Layout, motion and responsive

### Grid and spacing

- Spacing runs on 4px steps: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48, `space-16` 64, `space-28` 112.
- Website content is `max-width` 1120px with a 24px gutter (16px on phones).
- Website sections pad `space-28` (112px) top and bottom; 88px under 960px; 64px under 600px.
- A section head (`aw-section-head`) is an eyebrow, a `display` title and at most one `lead` line, with `space-12` before the content.
- Feature sections use the bento (`aw-bento`): 10 columns, 16px gaps, tiles spanning 6 + 4 or 4 + 6, alternating by row.
- Product screens use `space-4` card padding and `space-4` gaps. Rows and controls are `control-md` (32px).

### Page rhythm on the website

1. Hero: `hero` headline with a payoff word, one `lead` line, a primary and a secondary button, a product view on the flight grid.
2. Proof: logos or one stat row.
3. Features: a bento of product views.
4. How it works: a numbered list (`aw-list--num`).
5. Pricing or a table.
6. FAQ (`aw-faq`).
7. Night CTA band (`aw-panel-night--climb`) to close.

### Motion

- Quick and plain: 120 to 150ms, `cubic-bezier(.22, 1, .36, 1)`.
- Things move up or right when they enter: 8px rise, fade in.
- Arrow links nudge 3px right on hover.
- No bounces, spins or parallax. Respect `prefers-reduced-motion`.

### Responsive

| Width | Change |
|---|---|
| 960px and down | Bento and 3 or 4 column grids fold to 1 or 2 columns. Sections pad 88px. |
| 600px and down | `hero` 40, `display` 34, `h1` 30, `h2` 24, `h3` 20. All grids one column. Sections pad 64px. Gutter 16px. Inline forms stack. Buttons with `aw-btn--block-mobile` go full width. |
| Any width | Tables scroll inside `aw-table-wrap`; the page never scrolls sideways. |

## Imagery and icons

### Show the product

- The main image is always a real product view: a table, a chart or a list, in an `aw-window` or `aw-frame`, sitting on the flight grid (`aw-dotgrid`).
- Use believable sample data: real model names, made-up brands (Acme, Northwind, Globex, Initech), numbers that add up.
- Crop tight. Show the one part that proves the point, with Target ticks on the number that matters.
- No stock photos of people at laptops. No 3D blobs, no glowing orbs, no purple gradients.

### Featured images and social cards

- 1200 × 630.
- `bg-2` flight grid, the colour logo in a white `aw-logo-badge` centered at the top, one product view below it.
- No words in the image. The title lives in the post.

### Icons

- 16px line icons, 1.5px stroke, round caps and joins, drawn on a 16px grid. Same style as Lucide.
- Icons use `ink-2` at rest and `ink` on hover. Icons that carry meaning meet 3:1.
- Brand-only icons: the Climb (direction, tips), the Spark (wins, AI), a single chevron (bullets, deltas).
- No emoji anywhere in the product, emails or decks.

### Charts

- `signal` is you, `sky` is the nearest rival, `line-strong` is everyone else.
- 2px lines, round joins, a `signal` area at 8%.
- Grid lines in `line-faint`, axis labels in Geist Mono 11px `ink-3`.
- A line that ends on a new high gets the Spark end dot.
- Label the series in a legend (`aw-legend`), never by colour alone in the copy.

### Decks

- Title slide: `night` background, white logo top-left, `display` headline in white with a payoff word in `#8FB0FF`, the Climb watermark bottom-right.
- Content slides: `bg` background, `display` title, one product view or one chart per slide, numbers in Geist Mono.
- 16:9, 64px margins.

## Token reference

| Token | Light | Dark | Use |
|---|---|---|---|
| `signal` | `#0943B0` | `#2F63D6` | Signal Blue, the brand colour. Primary button fill, selected states, the outer chevron of the mark, the lead chart series. One Signal element leads each view. |
| `signal-hover` | `#07368E` | `#3A6BDB` | Hover and pressed fill for anything painted `signal`. |
| `signal-text` | `#0943B0` | `#8FB0FF` | Links, accent words in headings, eyebrows, active nav text. Reads on `bg`, `bg-2`, `bg-3` and `signal-tint` in both themes (7.4:1 or more). |
| `signal-tint` | `#EEF3FF` | `#1D2740` | Tinted fill behind blue tags, selected table rows and the info callout. Text on it is `signal-text`. |
| `on-signal` | `#FFFFFF` | `#FFFFFF` | Text and icons on `signal` fills (8.6:1 light, 5.4:1 dark). |
| `sky` | `#4F7FE0` | `#4F7FE0` | Sky, the inner chevron of the mark and the second chart series. A shape colour only: never set text in it. |
| `spark` | `#F5A70A` | `#FFC53D` | Spark Gold. The four-point star and the one win moment per view (a new citation, a rank gain, an AI answer). Fill only; text on it is `on-spark`. |
| `spark-text` | `#8A4B00` | `#FFC53D` | Gold words: the label inside a spark tag, a 'New' marker. Reads on `bg`, `bg-2` and `spark-tint` (6.2:1 or more). |
| `spark-tint` | `#FFF4DC` | `#33280F` | Fill of the spark tag and the spark callout. |
| `on-spark` | `#0B1B3F` | `#0B1B3F` | Text on `spark` fills (8.4:1 light, 10.7:1 dark). |
| `night` | `#0B1B3F` | `#0B1B3F` | Night, the deep navy of the mascot. Dark panels, the closing CTA band, deck title slides. Same in both themes; in dark, give a Night panel a `line` border. |
| `on-night` | `#FFFFFF` | `#FFFFFF` | Headlines and buttons on `night` (16.9:1). |
| `on-night-2` | `#B3C7F2` | `#B3C7F2` | Body copy and captions on `night` (9.9:1). |
| `ink-strong` | `#0B1B3F` | `#F5F7FF` | Headings, big numbers, the wordmark. On `bg`, `bg-2`, `bg-3`. |
| `ink` | `#333333` | `#EBEBEB` | Body copy and table cells. On every `bg-*` (11:1 or more). |
| `ink-2` | `#666666` | `#B3B3B3` | Secondary text: table headers, meta lines, inactive tabs. On `bg`, `bg-2`, `bg-3` (5:1 or more). |
| `ink-3` | `#707070` | `#8C8C8C` | Captions, axis labels, placeholders, helper icons. On `bg` and `bg-2` only (4.6:1 or more). |
| `ink-4` | `#B3B3B3` | `#5C5C5C` | Disabled text only. Never for anything a person must read. |
| `bg` | `#FFFFFF` | `#171717` | Default surface: cards, tables, inputs, the page in the app. |
| `bg-2` | `#FCFCFC` | `#1B1B1B` | Page background behind cards, side panels, table header row. |
| `bg-3` | `#F1F1F1` | `#1D1D1D` | Segmented controls, hover rows, neutral tag fill, code blocks. |
| `bg-4` | `#EBEBEB` | `#222222` | Pressed states, the selected segment track, progress tracks. |
| `hover` | `rgba(0, 0, 0, 0.04)` | `rgba(255, 255, 255, 0.06)` | Laid over any surface on hover: nav links, ghost buttons, table rows. |
| `line` | `#EBEBEB` | `#292929` | Card and table borders, dividers. Borders carry the structure; there are no card shadows. |
| `line-faint` | `#F1F1F1` | `#222222` | Row dividers inside tables and lists, chart grid lines. |
| `line-strong` | `#D6D6D6` | `#333333` | Secondary button border, menus, dot-grid dots, the notch edge. |
| `line-control` | `#8C8C8C` | `#6B6B6B` | Input, checkbox and radio borders (3.4:1 on `bg`). |
| `focus` | `#0943B0` | `#8FB0FF` | The 2px focus ring on every control, offset 2px. 3:1 or more on every surface. |
| `pos` | `#0B7A54` | `#4FC08D` | Gains and passes: rank up, cited, live. Always paired with an up chevron or a word. On `bg` and `pos-tint`. |
| `pos-tint` | `#E6F4EE` | `#13291F` | Fill of the green tag and the success callout. |
| `neg` | `#C02A35` | `#FF7A84` | Losses and errors: rank down, missing, failed. Always paired with a down chevron or a word. On `bg` and `neg-tint`. |
| `neg-tint` | `#FBEBEC` | `#331A1C` | Fill of the red tag and the error callout. |


| Token | Value | Use |
|---|---|---|
| `space-1` | `4px` | Icon to label, tag padding. |
| `space-2` | `8px` | Gaps inside controls and between tags. |
| `space-3` | `12px` | Button side padding, table cell padding, gaps between stacked fields. |
| `space-4` | `16px` | Card padding in the app, grid gaps, the dot-grid pitch. |
| `space-6` | `24px` | Card padding on the site, page gutter, gap between cards. |
| `space-8` | `32px` | Space between a heading block and its content. |
| `space-12` | `48px` | Space between groups inside a section. |
| `space-16` | `64px` | Section padding on phones. |
| `space-28` | `112px` | Section padding on the website at desktop width. |
| `radius-sm` | `4px` | Buttons, inputs, tags, menus items, segmented controls. The product's default. |
| `radius-md` | `8px` | Cards, tables, menus, dialogs, windows. |
| `radius-lg` | `12px` | Marketing frames and bento tiles on the website. |
| `radius-full` | `999px` | Avatars and status dots only. Nothing else is round. |
| `control-sm` | `24px` | Small buttons, segmented options, icon buttons in toolbars. |
| `control-md` | `32px` | Default button and input height in the product, table row height. |
| `control-lg` | `40px` | Website and email buttons, form inputs on the site. |
| `tag-h` | `20px` | Tag and chip height. |
| `notch` | `8px` | The Notch: the top-right corner cut on primary buttons. 16px on frames. |
| `max-width` | `1120px` | Website content width. |

## Components

Every class below is in `arrowsterr-brand.css`, scoped to `.aw`.

### Button

Buttons for every action; the primary one carries the Notch.

**Provide:** a verb-first label ("Run check"), and an icon only when it adds meaning. Use `<button>` for actions and `<a>` for links.

**Classes:** `aw-btn` plus one of `--primary`, `--secondary`, `--ghost`, `--danger`, `--on-night`, `--ghost-night`; sizes `--sm` (24px), default (32px), `--lg` (40px, website and email); `--icon`, `--block`, `--block-mobile`. Group with `aw-btn-row`.

- Do show one primary per view. Pair it with a secondary.
- Do use `--lg` on the website and in emails, the default in the product.
- Don't round the corners past `radius-sm` or add a shadow to the primary.
- Don't write "Submit", "Click here" or "Learn more".

### Callout

Callouts: a tinted box with an icon for a tip, a win, a pass or a failure.

**Provide:** a bold lead word ("Tip.", "Check failed.") and one or two sentences.

**Classes:** `aw-callout` (Climb, blue), `--spark` (win), `--pos` (pass), `--neg` (failure).

- Do say what happened and what happens next on a failure.
- Don't add a coloured side border or a shadow.

### Card

Cards and product windows: white boxes with hairline borders that hold one piece of product.

**Provide:** a title (`aw-h4`), the content and at most one link or button.

**Classes:** `aw-card` with `--lg`, `--flush`, `--tint`, `--link`; `aw-card__head`; `aw-window` with `aw-window__bar` (breadcrumb plus `aw-kbd`) and `aw-window__body`; `aw-skel` for placeholder lines.

- Do let borders carry structure. No shadow on cards.
- Don't nest cards inside cards. Use a divider instead.

### Chart

Charts: inline SVG lines and bars plus share-of-voice bars in HTML.

**Provide:** the data, a legend and a text label for the chart.

**Classes:** `aw-chart`, `aw-chart-grid`, `aw-chart-base`, `aw-chart-label`, `aw-chart-line` (`--2`, `--muted`), `aw-chart-area`, `aw-chart-dot`, `aw-chart-dot--win`, `aw-chart-bar` (`--you`, `--2`); `aw-sov`, `aw-sov__row`, `is-you`; `aw-legend`.

- Do paint you in `signal`, the nearest rival in `sky`, all others in `line-strong`.
- Do mark a new high with the Spark end dot.
- Don't use pie charts or 3D.

### Controls

Checkboxes, radios, toggles, segmented controls and the inline sign-up form.

**Provide:** a label next to every control.

**Classes:** `aw-check` around a native checkbox or radio; `aw-toggle` on a checkbox for on/off settings; `aw-seg` with `aria-pressed` buttons; `aw-inline-form` for email plus button.

- Do use a toggle for settings that apply at once, a checkbox for choices saved with a button.
- Don't use more than four options in a segmented control.

### FAQ

The FAQ: native `<details>` rows with the question in Funnel Display.

**Provide:** questions as buyers ask them, answers of one to three sentences.

**Classes:** `aw-faq` around `<details><summary>Question</summary><div>Answer</div></details>`.

- Do open the first question by default.
- Don't put links-only answers or more than eight questions in one block.

### Frame

Marketing frames for product views, with the Notch and the flight grid on the featured one.

**Provide:** a product view (window, table or chart) on an `aw-dotgrid` top half and an `aw-h3` title below.

**Classes:** `aw-frame`, `aw-frame--notch`, `aw-dotgrid`, `aw-ticks`.

- Do notch one frame per section, the one that matters most.
- Do put Target ticks on the number you want read first.
- Don't put text on the dot grid.

### Heading

Headings in Funnel Display with an eyebrow above and one payoff word in Signal Blue.

**Markup:** `<span class="aw-eyebrow">AI visibility</span>`, then `<h1 class="aw-hero">Get named in <span class="aw-accent">AI answers</span></h1>`, then at most one `<p class="aw-lead">`.

**Classes:** `aw-hero`, `aw-display`, `aw-h1`, `aw-h2`, `aw-h3` (Funnel Display), `aw-h4` (Inter 600), `aw-lead`, `aw-body`, `aw-small`, `aw-caption`, `aw-label`, `aw-num`, `aw-code`, `aw-kbd`, `aw-eyebrow`, `aw-accent`, `aw-link`, `aw-link--arrow`, `aw-prose`.

- Do give each page one `aw-hero` and each section one `aw-display`.
- Do put the accent on the words that name the result.
- Don't set Funnel Display under 18px, in caps or in a colour other than `ink-strong`, `on-night` or the accent.
- Don't add a paragraph under a title. One lead line at most.

### Input

Text fields and the custom select: labels on top, errors below, no native dropdowns.

**Provide:** a short label, a placeholder that shows the format, and an error that says how to fix it.

**Classes:** `aw-field`, `aw-field__label`, `aw-field__error`, `aw-input` (`--lg` on the website), `aw-textarea`, `aw-select` (a button), `aw-menu`, `aw-menu__item`.

- Do set `aria-invalid="true"` on a field with an error.
- Don't use `<select>`, `window.prompt`, `window.confirm` or `window.alert`. Open an `aw-menu` or a dialog.
- Don't add help text under fields.

### List

Lists with chevron bullets, check marks or mono numbers.

**Provide:** short items, one line each where you can.

**Classes:** `aw-list` (chevrons), `aw-list--check` (wins and features), `aw-list--num` (steps, 01 02 03), `aw-list--tight`; a nested `<ul>` gets small square dots.

- Do keep items parallel: all start with a verb or all with a noun.
- Don't nest more than one level.

### Logo

The Arrowsterr logo and mark, always placed as SVG files with a set height.

**Provide:** the file from the Logos group and an `alt` of "Arrowsterr" (empty `alt` for a mark next to the word).

**Classes:** `aw-logo` with `aw-logo--sm` (20px), `aw-logo--md` (28px) or `aw-logo--lg` (40px); `aw-mark` (32px) with `--sm` (20px) or `--lg` (56px); `aw-logo-badge` for a white tile.

- Do use the colour files on white and light greys, the white files on `night` and `signal`.
- Do keep clear space equal to the sparkle's height.
- Don't type the name as a logo, recolour the chevrons or put the logo on a busy photo.

### Motifs

The four shapes that mark a screen as Arrowsterr: the Climb, the Spark, the Notch, and Target ticks on the flight grid.

**Classes:** `aw-climb` (inline mark, sized by font-size), `aw-star` (inline spark), the Notch on `aw-btn--primary` and `aw-frame--notch`, `aw-ticks` on any box, `aw-dotgrid` on a backdrop.

- Do use one Spark and one set of Target ticks per view.
- Do point chevrons up or right.
- Don't notch cards, inputs, tags or images.
- Don't put the flight grid behind body copy.

### NightPanel

The Night panel: a deep navy band that closes a page or opens a deck.

**Provide:** an eyebrow, a `display` headline with a payoff word, one short line and two buttons (`--on-night` and `--ghost-night`).

**Classes:** `aw-panel-night`, `aw-panel-night--climb` (Climb watermark), `aw-cta-band`.

- Do use one per page, as the last section.
- Don't put tables, forms or gold inside it.

### Quote

The pull quote: a customer's words in Funnel Display under the Climb mark.

**Provide:** a quote under 30 words with a result in it, the person's name and role.

**Classes:** `aw-quote` on a `<figure>` with `<blockquote>` and `<figcaption><b>Name</b> · Role</figcaption>`.

- Do quote a number when the customer gave one.
- Don't use quote marks; the Climb is the mark.

### Section

A website section: eyebrow, display title with a payoff word, then a bento of frames.

**Provide:** a title of six to ten words and two to six frames.

**Classes:** `aw-wrap`, `aw-section` (`--tight`, `--tint`), `aw-section-head` (`--center`), `aw-bento` with `aw-span-4`, `aw-span-6`, `aw-span-10`; `aw-grid-2`, `-3`, `-4`; `aw-stack`, `aw-row`.

- Do alternate 6 + 4 and 4 + 6 rows in the bento.
- Don't put more than one notched frame in a section.

### Stat

Stat blocks: a label, a big mono number and its change.

**Provide:** a label, a value with its unit in `<small>`, and an `aw-delta`.

**Classes:** `aw-stats` (joined row), `aw-stat`, `aw-stat__label`, `aw-stat__value`, `aw-stat__note`, `aw-stat--hero`, `aw-stat--win` (adds the Spark).

- Do show the change next to every number.
- Do give the Spark to one stat at most.
- Don't round away the meaning: "38.4%" beats "about 40%".

### Summary

The "In short" box at the top of a post: the takeaways before the detail.

**Provide:** two to five bullet points, each a full sentence with a number where you have one.

**Classes:** `aw-summary`, `aw-summary__label`, and an `aw-list` inside.

- Do put it right after the post's first paragraph.
- Don't use it twice in one post.

### Table

Data tables: 32px rows, mono numbers on the right, your brand's row in Signal tint.

**Provide:** a `<table class="aw-table">` inside `aw-table-wrap`; `is-num` on number cells and their header; `is-you` on the row for the viewer's brand.

**Classes:** `aw-table-wrap`, `aw-table`, `is-num`, `is-you`, `aw-cell-brand`, `aw-fav`, `aw-heat--0` to `--3`.

- Do right-align numbers and keep headers in sentence case.
- Do use heat cells for shares so the eye finds the leaders.
- Don't zebra-stripe. Row lines and hover are enough.

### Tag

Tags, chips, deltas and rank badges: small, square-cornered labels for state and change.

**Provide:** one or two words for a tag; a signed number for a delta ("+6.1", "−3"); "#n" for a rank.

**Classes:** `aw-tag` with `--blue`, `--green`, `--red`, `--spark`, `--night`, `--outline`; `aw-dot` inside a tag for live state; `aw-chip` for a removable filter; `aw-delta--up`, `--down`, `--flat`; `aw-rank` and `aw-rank--top`.

- Do use `aw-tag--spark` only for a win, once per view.
- Do pair green and red with a word or chevron.
- Don't make tags round or taller than `tag-h` (20px).
