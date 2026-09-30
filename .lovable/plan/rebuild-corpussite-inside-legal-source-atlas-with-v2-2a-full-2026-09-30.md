# Rebuild CorpusSite inside Legal Source Atlas, with V2.2A fully merged in

## What I found in corpussite
- The GitHub repo holds code only: 645 files, about 9 MB. The research data (about 130 GB: laws, judges, MDL, regulations, county records, saved originals) is not in git. It sits in release assets of `fshahersw/externalcorpus` and is served by a local Python server.
- Real data that is in git and small enough to ship: the U.S. county map geometry (`us-counties-albers-10m.json`, public us-atlas), `insights-data.js` (saved case catalog: matters, MDL, firms, courts, states, years, plus a qualification note), the judge portrait membership file, and the category and area definitions.
- The interface is plain HTML/JS: hubs for Places (states and counties), Law (laws, regulations), Litigation (judges, MDL, counsel), Insights and statistics, Sources, and Additions/Connections, with an interactive state/county map.

## What gets built (phase 1, this pass)
In this project's current navy/gray style, as one platform instead of two:

1. **Overview**: entry point with the national map and live counts computed from the loaded data.
2. **Interactive map (Places)**: every state and county clickable, using the real county geometry. Colors show how many sources and matters each place has. Clicking a state opens its page, and a county opens its detail.
3. **State and county pages**: the V2.2A sources for that jurisdiction, saved matters and courts from the insights catalog, endpoint candidates, and breadcrumbs.
4. **Categories**: one taxonomy that merges V2.2A heading categories, the eight source families and corpussite's categories. A category that cannot be matched exactly is shown as unassigned, never guessed.
5. **Sources**: the existing Library becomes the unified directory, with filters for state, county, category, family and hub.
6. **Litigation / Insights**: charts from the real insights catalog (matters by year, state, court, MDL, firm, status), shown with its original qualification text. Firm and name grouping follows corpussite's own documented rules.
7. The existing Endpoint Explorer, Review Queue, Saved Sources and Data & Exports pages stay, extended to the new data.

Everything stays browser-local, as you chose: bundled files, IndexedDB for imports, localStorage for reviews and bookmarks. Nothing is written to the cloud.

## Accuracy rules
- V2.2A is merged by exact URL and exact jurisdiction and category match. Each record keeps its raw imported fields and where it came from.
- Counts are always computed from rows. Corpussite README figures (for example 2,968,623 provisions) are not shown as live data.
- Sections whose data isn't loaded (laws text, judge profiles, regulations, county registries) show an honest "data not yet imported" state and accept a JSON/CSV import, the same way V2.2A did.

## Not possible in this pass
- The 130 GB corpus can't run in a browser app. Laws, judges and regulations need exports from your local server, in bounded per-collection files, before they can appear. Later, they could go into the cloud database if you drop the "local only" rule.
- The Python server, pipelines and crawlers are not ported. There is no crawling.

## Technical details
- Download corpussite at a fixed commit into /tmp. Copy only the county geometry, insights data (converted from `window.X=` JS to JSON), and category and area definitions into `public/data/corpus/`, and record a sha256 for each.
- New modules: `src/lib/corpus/{geo,insights,taxonomy,join}.ts`. These are pure logic with tests that use the real files. `join.ts` maps V2.2A sources to state and county FIPS through exact name/USPS matching and reports anything unmatched.
- SVG map component that decodes the TopoJSON with `topojson-client`, with no map service or API key.
- New routes: `/overview`, `/places`, `/places/$state`, `/places/$state/$county`, `/categories`, `/insights`. Library filters gain state, county and hub.
- Tests, typecheck and production build. A Playwright check in a fresh browser session covers the map clicks, state pages, charts and all views. Results go in `docs/verification-report.md`.
