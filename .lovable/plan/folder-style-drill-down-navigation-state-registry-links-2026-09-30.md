# Folder-style drill-down navigation + state registry links

Yes, it makes sense: every section should open like a filing cabinet. You start at the drawer, open a folder, open a sub-folder, then click the item itself. Colors, fonts and styling stay as they are.

## One shared pattern for every section
```text
Level 1  Big folder       e.g. Litigation
Level 2  Category         e.g. Courts  (cards with counts)
Level 3  Sub-category     e.g. Federal district courts by state
Level 4  List             clickable rows
Level 5  Item page        full court / judge / MDL / case / source page
```
- **Folder cards**: each level shows cards with a name, a one-line description and a count. Clicking a card opens the next level.
- **Path bar**: breadcrumbs at the top show exactly where you are (Litigation / Courts / Texas / N.D. Texas). Every step can be clicked to go back.
- **Left-side tree** (desktop): a collapsible outline of the current section, so you can jump between sibling folders without going back.
- **Same list controls everywhere**: search, up to three filters, count and paging in the same place on every list.
- **Empty folders are hidden** (or shown greyed out with "0") so nothing leads to a blank page.

## How each section maps onto it
- **Explore**: Map → State → (Courts | Judges | MDLs & cases | Laws | Sources) → County → item.
- **Litigation**: Courts → Federal / State → by state → court page. Judges → by court. Matters → MDLs → MDL page (cases, docket documents). Case catalog → by firm or judge → case.
- **Law & Safety**: Federal or State → type of law → collection → provision. Safety → agency → recall/alert.
- **Sources & Work**: Registry V2.2 → jurisdiction → research task → source. Source library, registry v0.6 and coverage gaps follow the same steps. Saved, review queue and exports are grouped as "My work".

## State pages linked to the state registry
- Each state page gets a "Sources for this state" folder card with the Registry V2.2 count for that state. The card breaks down by research task (courts & procedure, regulatory, law, etc.) and opens that state's registry filtered to the chosen task.
- Registry V2.2 jurisdiction pages link back to the state's map page.
- Each federal item links to the federal registry group.

## Friendlier pages
- A short "What's here" summary line at the top of each folder, in place of long notices.
- Item pages open with a summary card, then jump links to their sections (Cases, Docket documents, Judges, Sources), with long tables collapsed after 25 rows.
- Clicking a judge name in the case catalog opens the judge's page when an exact name match exists. Otherwise it opens the People A–Z entry, and stays a filter if neither exists.
- Consistent wording: "Open", "Show all", "Back to …".

## Technical details
- New shared components: `FolderGrid` (cards with counts, linking to the next level), `DrillPath` (breadcrumb built from route params), `SectionTree` (collapsible outline per top-level section). All use the existing card/nav classes.
- `places.$state.tsx`: add a registry card group using `loadRegistryJurisdiction(usps)` and task counts; link to `/sources/registry-v22?j=XX&task=…`. The registry page links back to `/places/$state` when the code is a state.
- Courts index: group by system → state using the existing court fields; the judges index groups by court.
- Registry V2.2: add a task level between jurisdiction and list (the `task` search param already exists).
- Judge-name linking uses an exact normalized-name match against the judges listing (`nameKey`). It never fuzzy-merges.
- Tests: task-count grouping, state↔registry code mapping, judge-name matcher. Then typecheck, build, and a browser walk-through of each section from level 1 to the item page.

## Limits
Folders only show levels the data actually has. For example, courts without a state stay under "No state recorded". Everything remains read-only and unpublished.
