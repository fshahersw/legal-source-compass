# Add the new uploads (source catalog + state court links)

## What each file is, and whether it adds anything

| File | Contents | Verdict |
|---|---|---|
| catalog.json (22 MB) | 9,348 sources with categories, access method, jurisdiction, notes, capture info | **New.** A larger source catalog than the current library (4,633) |
| stateparsed.json | 55 states/territories, 2,956 court links grouped by section (District, Bankruptcy, State and Local Courts…) | **New.** Official court website list for each state |
| 01a016f5…md | One DOJ "state resources" web page (Northern Mariana Islands) saved as text | The page stateparsed.json was built from. Kept as the source reference only |
| dockets.json | 2,122 dockets | **Duplicate.** Same 2,122 dockets already in the case catalog |
| graph.json, clusters.csv, firms.csv | Summaries of those same 2,122 dockets (per year, 45 defendant clusters, 9 firms) | **Already shown.** The case Analytics tab works these out from the same rows. Used only to check that our numbers match |

## Build

1. **Source catalog**
   - Split catalog.json into per-jurisdiction files (it's over 10 MB) and keep the original as a stored file.
   - Merge into the Source library by exact URL. When a URL is already there, keep one row and show both records. When it isn't, add it as a new row. No fuzzy merging.
   - New filters: category, access method, layer. The detail panel shows notes, caveats, access requirements and capture dates, labeled as imported, not checked by us.
   - State pages count and list catalog sources by exact jurisdiction code.
2. **State court links**
   - On each state page, add an "Official court websites" section with the links grouped as in the file (District, Bankruptcy, State and Local Courts…), each opening in a new tab. Link to the DOJ page as the source.
   - Link a court to its court page only when its URL exactly matches one of our courts. Otherwise show the link only.
3. **Consistency check (no UI)**: a test that compares the case Analytics totals with graph.json, clusters.csv and firms.csv (2,122 dockets, 1,032 active / 1,090 closed, filings per year, cluster counts). Any mismatch is reported, not hidden.
4. **Verify**: tests, plus a browser check of the library counts, one state page (MN) with court links, and one source detail.

## Technical notes
- Static files under public/data/catalog/ and public/data/state-courts.json, with pure parsers and tests in src/lib/atlas/. No backend changes.
- The existing 4,633-source bundle and its exports stay unchanged. The catalog is a second layer on top, joined by exact URL.
