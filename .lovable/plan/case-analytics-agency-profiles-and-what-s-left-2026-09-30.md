# Case analytics, agency profiles, and what's left

Same look and colors as now. Nothing is redesigned.

## About the new upload

`matters.json` is exactly the same file as the case catalog already in the app (2,122 cases, same bytes). So there is no new data in it. But the app only uses part of it. These parts are not used yet:
- **Firm role**: "anchor" (1,654) versus "competitor" (469)
- **Defendants**: AstraZeneca 176, 3M 172, Novo Nordisk 99, L'Oréal 93, and more. 208 cases name no defendant.
- **Time to close**: 1,090 cases have both a filing date and a closing date.

## 1. Case analytics (turns the old "Case insights" page into this)

A new "Analytics" tab at the top of the Case catalog, with these views:
- Cases filed per year, stacked by status (active or closed)
- Top defendants, as a bar list. Clicking one narrows the case list.
- Firms split by role (anchor or competitor), shown as stacked bars
- A court map: states shaded by case count, reusing the existing map. Clicking a state narrows the list.
- Time to close: the typical (median) number of days by year filed and by firm. Only closed cases are counted.
- Each defendant lists the MDLs its cases link to, based only on the real master-docket links.

Each chart gets a Chart/Table switch, like your screenshots. MDL and court pages get the same small analytics block, limited to their own cases. A new filter for defendant and role is added to the list. The old separate Litigation Insights page will redirect here.

## 2. Agency profiles (like the screenshots)

Under Law & Safety, a new "Agencies" folder. Each agency page (HHS, DOT, FDA, CPSC…) would show:
- Stat cards: Federal Register documents, rules, proposed rules, CFR parts cited, safety records, saved files
- Documents per year by type, with a Chart/Table switch
- Tabs: Overview · Rules & notices (most recent, filterable by type) · Regulations · Safety & enforcement · Documents
- A note saying that department totals include the documents their component agencies file

The first step checks which agency fields the Federal Register and safety records actually have. Any card with no data behind it says "Not recorded". It never shows a guessed zero.

## 3. Provision page upgrades (from the 40 CFR screenshot)

Add these to the page for a single rule or law:
- A "Copy citation" button
- "All sections of this part" and "Current eCFR ↗", shown only when a real link exists
- A "Dates & sources" section
- A "Federal Register" list of documents that cite this part, shown only when the database links them

## 4. Cleanup of what's still left

- Make the map the home page (Explore)
- Remove or redirect the old pages: Categories, Jurisdictions, Source families, Endpoints, Case insights. Each keeps a link into its new home.
- Feed the four supporting tables into the court, case and county pages (court map, docket links, duplicate-document groups, county profiles) instead of keeping them as separate lists
- Court pages get a small state map with the court's state highlighted
- Judge names on MDL pages become links, but only on a single exact name match
- Coverage gaps compare against the database's own records per state, not only against the V2.2A file

## Ideas beyond this round (not included unless you want them)

- A timeline on each judge page (cases assigned by year)
- Law firm profile pages (cases, courts, MDLs, defendants)
- Defendant profile pages that join cases, MDLs, docket documents and FDA/CPSC safety records by company name, shown only on an exact name match

## Technical details

- New pure `src/lib/atlas/caseAnalytics.ts` (by year × status, defendant counts, role × firm, median days to close, state rollup via court → state from the court directory), with tests against the real file
- Charts use the existing recharts setup and BarList. A shared `ChartTableToggle` wraps them.
- Agency data is checked first with read-only queries on the Federal Register and safety datasets. The profile uses bounded count queries, cached, through a new `agency.functions.ts` server function.
- Redirects keep search terms. The 4-section sidebar is unchanged.
- Verify with tests, typecheck, build, and a browser walk: Case catalog → Analytics → click a defendant; Law & Safety → Agencies → HHS; a CFR provision page; the home map.

## Limits

- The median time to close uses only the 1,090 closed cases that have both dates.
- An agency card can't be computed if the database has no agency field for those records. It will say so rather than guess.
