# Rebuild the app around three jobs: deadlines, state laws, sources

## What changes for you

**1. New home screen: a simple dashboard (replaces the map)**
- Three large tiles: **Check a deadline**, **Read state laws**, **Find sources**.
- One search box at the top that searches all three.
- A short "Recently viewed" row, saved in this browser only.
- The map moves to a page you can still open, but it is no longer the first thing you see.

**2. Side menu cut down to the three jobs plus "More"**
- Deadlines, State laws, Sources, More.
- "More" holds everything else (courts, judges, cases, agencies, data exports, saved items) on one plain list page instead of many tabs.
- Strip the second row of small tab links under every page title. Pages show a title, one line of explanation, and the content.

**3. Deadline calculator: one page, top to bottom**
- Pick state, pick claim type, enter the date. The answer shows right away beside the form.
- Exception questions appear only when they could change the answer, as short yes/no rows, with the most common ones first.
- If a "yes" means the tool can't give a reliable date, it says that in one plain sentence and names the law to check. It never shows a guessed date.
- Sources and full notes sit in a "Show the law" panel you can open when you need them, not inline.

**4. State laws: pick a state, then browse or search**
- A state list with a search box, then the state's code shown as a simple folder-style outline with search inside it.
- Each section shows the law's text first; source and history details move into a small "About this text" panel.
- States that aren't fully loaded say so plainly (for example, California is loaded but not yet reviewed).

**5. Sources: one searchable list**
- One list with search and 3 to 4 filters (state, type, status). Click a row to open its details in a side panel instead of a new page.
- The separate "library", "catalog", "registry" and "coverage" pages become filters on this one list. Old links still work and land on the matching filter.

**6. Visual cleanup across all pages**
- Fewer boxes, borders and badges; larger, easier-to-read text; consistent spacing; one accent color.
- Works on phone screens without sideways scrolling.

## What stays the same
- Every deadline rule, period and data source stays as it is. This is a layout and wording change only.
- Nothing is invented. Missing values still show "Not recorded".
- The Kansas and California import work continues separately.

## Order
1. Menu and home dashboard
2. Deadline calculator
3. State laws
4. Sources
5. Cleanup pass, then screenshots on desktop and phone for you to check

## Technical details
- Changes the project rule "sidebar has exactly 4 sections; home `/` is the map". New rule: 4 menu items (Deadlines, State laws, Sources, More), home is the dashboard, map moves to `/places`. AGENTS.md and project knowledge get updated to match.
- `AppShell`: drop the `context` sub-nav row, simplify the header. Add the new `/more` route.
- Calculator: restyle `GuidedCalculator` presentation only. `calculateGuided`, the screening logic and the rule bundles stay untouched, so existing tests keep passing. Show only the screening questions relevant to the selected rule's inventory.
- Sources: merge `sources.library/catalog/registry/coverage` into a single list driven by search params. Keep the old routes as redirects.
- Run the existing limitations and UI tests, then Playwright screenshots at 1280px and 390px.
