# Consolidate pages: retire 4 standalone pages into library filters, merge state sources

## What changes for you

- The separate **Categories**, **Jurisdictions**, **Families** and **Endpoints** pages go away. Everything they did becomes filters and views inside the **Source library** — one place instead of five.
- Old addresses keep working: they redirect to the library with the right filter already applied.
- On each **state page**, the source list merges the state directory, the source catalog and Registry V2.2 into one list, shown once per exact web address, with a small label saying which collection each row came from.

## Details

### 1. Library gains what the four pages did
- **Category filter**: the corpussite taxonomy rule (already ported in `taxonomy.ts`) becomes a "Category" facet in the library, computed from each source's heading. Unmatched headings stay "not matched" — no re-guessing.
- **Jurisdiction and Family filters**: already exist in the library; nothing new needed.
- **Endpoints view**: the library page gets a Sources / Endpoints switch. Endpoints shows the 258 raw endpoint candidates with the same search, copy and open actions the explorer had.

### 2. Redirects, not dead links
- `/categories` → library with the Category panel focus
- `/jurisdictions` → library (jurisdiction facet)
- `/source-families` → library (family facet)
- `/endpoint-explorer` → library, Endpoints view
- Sidebar and section menus lose the four entries; the sidebar stays at its 4 main groups.

### 3. State pages: one merged source list
- Today a state page shows Registry V2.2 sources, while the library shows directory + catalog sources — the same website can appear in both.
- The state page's source list will merge all three collections by **exact URL only** (the project's standing rule — no fuzzy matching). Duplicates appear once, with labels like "Directory · Registry V2.2" showing every collection that contains it.
- Counts on the state page update to the merged total; "Open sources in Library" keeps working.

### 4. Verification
- Unit tests: category facet matches the old Categories page totals; endpoint view keeps all 258 candidates; merge dedupes only on exact URLs.
- Browser check: all four old addresses redirect correctly; library filters reproduce what each retired page showed; a state page shows the merged list with provenance labels; no page errors.

## Technical notes
- Files removed: `src/routes/categories.tsx`, `jurisdictions.tsx`, `source-families.tsx`, `endpoint-explorer.tsx` (replaced by tiny redirect routes so old links never 404).
- Library: `LibraryBrowser.tsx` gains the Category facet and a Sources/Endpoints view switch; `sources.library.tsx` hosts it.
- State merge: new pure function in `src/lib/atlas/` (exact-URL dedupe across directory, catalog, registry-v22) with tests, used by `places.$state.tsx`.
- AppShell: CONTEXT_NAV trimmed; `/jurisdictions` removed from the Explore group.
- All standing rules hold: no invented data, exact-match only, "Not recorded" for unknowns.
