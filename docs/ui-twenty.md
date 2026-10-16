# Product UI in the style of Twenty

The app follows Twenty's light theme (packages/twenty-ui/src/theme in twentyhq/twenty), with Arrowsterr's logo and blue. All of it lives in `src/app/twenty.css`, loaded after `brand.css` and `brand-v2.css`.

## The rules
- **Type:** Inter at 13px. Headings are 600 weight with no negative tracking. Numbers use tabular figures.
- **Greys:**
  - Text: #333, #666, #999 and #B3B3B3.
  - Lines: #EBEBEB and #F1F1F1.
  - Page: #FCFCFC.
  - Hover: black at 4%.
- **Blue:** Arrowsterr Blue (#0943B0), only on the one main button of a view and on the selected nav icon.
- **Shapes:**
  - 4px corners on buttons, inputs and tags, 8px on panels.
  - No shadows on cards. One shadow for menus and the side panel.
- **Shell:**
  - The sidebar sits on the page grey, with the workspace switcher on top and sections that fold.
  - On a phone the sidebar folds into a menu button.
  - The page header shows "Section / Page" and the pickers.
  - The page itself is a white panel with a hairline border.
- **Tables:** 32px rows, grey header labels, hairline grid lines.
- **Tags:** 20px high, 4px corners.
- **Side panel:**
  - A record opens on the right, over the page: `.aw-side-panel` with an `.aw-side-panel__bar`.
  - Prompts use it now.
- **Views:**
  - `.aw-viewbar` and `.aw-viewbtn` switch a list between views.

## Running cost
None. This is styling only: no new servers or paid services, so the Beta (50 teams) and Growth (500 teams) totals stay $0.
