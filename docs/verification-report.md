# Legal Source Atlas — verification report (2026-09-30)

Scope: fix default data loading and persistence for the first version. The project is unpublished and nothing was deployed.

## Supplied file identity (read this first)
| | Expected (from request) | Actual file on disk |
|---|---|---|
| Size | 6,431,110 bytes | **6,539,722 bytes** |
| SHA-256 | bab51fdd…9eacf | **acb1355f66463d76e865e582a2a3cc3e62a235fe0ffa19eb69ea80fb3e7b7b3e** |

The only uploaded file (`/mnt/user-uploads/atlas-import-bundle.json`) does **not** match the size and hash in the request.
Its row counts do match every expected value (4,633 / 6,372 / 258 / 8 / 73 / 4 original files).
It was copied unchanged to `public/data/atlas-import-bundle.json` (`cmp` identical), and the production build output is also 6,539,722 bytes.
Tests pin the **actual** hash. If a different file was intended, please re-supply it.

## Commands and results (final code)
| Command | Result |
|---|---|
| `bunx vitest run` | 7 files, **65 / 65 tests passed** |
| `bunx tsgo --noEmit` | no errors |
| `bun run build` | exit 0; `dist/client/data/atlas-import-bundle.json` 6,539,722 bytes |
| `python3 docs/verify_atlas.py` (Playwright, fresh context, no manual import) | **49 / 49 checks passed** |

Tests written first (they failed before the fix because the modules were missing): `persistence.test.ts` and `families.test.ts`.
They read the bundled project file directly, so real-data tests never skip.

## Browser checks (fresh context, output of docs/verify_atlas.py)
```
    PASS fresh: distinct 4,633 
    PASS fresh: occurrences 6,372 
    PASS library pager shows 4,633 rows 
    PASS data-exports Endpoint candidates=258 
    PASS data-exports Manifest families=8 
    PASS data-exports Imported promotions=73 
    PASS data-exports Distinct source URLs=4,633 
    PASS data-exports Original occurrences=6,372 
    PASS no 'mismatch' 
    PASS title literal fixed 
    PASS origin bundled 
    PASS data-exports no horizontal overflow 
    PASS raw download sha matches bundled acb1355f66463d76e865e582a2a3cc3e62a235fe0ffa19eb69ea80fb3e7b7b3e
    PASS JSON export keeps raw record + occurrences array 
    PASS original file text downloadable 1000642
    PASS after reload still 4,633 
    PASS hash URL preserved in link https://www.generalcode.com/library/#CT
    PASS query URL link retains ? https://lis.njleg.state.nj.us/nxt/gateway.dll?f=templates&fn=default.htm&vid=Publish%3A10.1048%2FEnu
    PASS drawer link equals row link https://lis.njleg.state.nj.us/nxt/gateway.dll?f=templates&fn=default.htm&vid=Publish%3A10.1048%2FEnu
    PASS short reason rejected (no overlay) 
    PASS review saved with reason 
    PASS undo removes overlay 
    PASS bookmark persisted after reload {"src_4d8e8366596ac73c6f47":true}
    PASS review persisted after reload 
    PASS no bundle in localStorage 
    PASS Saved Sources shows bookmark after reload 
    PASS nav Library 
    PASS nav Jurisdictions 
    PASS nav Source Families 
    PASS 8 family cards unassigned (4,525)
    PASS nav Endpoint Explorer 
    PASS endpoint explorer has rows 
    PASS nav Review Queue 
    PASS review queue lists 1 
    PASS nav Saved Sources 
    PASS nav Data & Exports 
    PASS no page errors 
    PASS legacy migrated and legacy key removed after IDB write 
    PASS bookmarks kept during migration 
    PASS migrated import survives reload (from IndexedDB) 
    PASS restore bundled with confirmation 
    PASS bookmarks kept on restore 
    PASS restore survives reload 
    PASS user import saved in IndexedDB survives reload 
    PASS rejected save shown explicitly 
    PASS after failed save, reload shows bundled (no false claim) 
    PASS rejected bookmark save warned 
    PASS load failure shows error (not empty library) 
    PASS Retry recovers 
```

## Screenshot
![Populated Library](library-populated.png)

## Behaviour now
- **Startup order:** saved IndexedDB import → legacy localStorage import → bundled file.
  - A legacy import is migrated only after the IndexedDB write has been verified, and only then is the old key removed.
  - Stale async loads are discarded, so they cannot overwrite a newer import, restore or clear.
- **User imports:** stored as exact raw bytes in IndexedDB, including unknown fields and all original file text.
- **Storage failures:** a failed IndexedDB or localStorage write is reported and never shown as "saved". A failed load shows an error with Retry, never an empty library.
- **Reviews and bookmarks:** kept in localStorage and written only by user actions, so startup cannot wipe them. Import and restore leave them untouched; only the confirmed "Clear local reviews & bookmarks" button removes them.
- **Downloads:** the original bundle file (byte-identical), each original file's text, and CSV/JSON exports. JSON rows include the verbatim raw record.

## Remaining limits
- Family membership for directory sources uses only exact rules: a heading category equals the family name, or the exact URL appears among the family's endpoints. Result: 108 linked, 4,525 unassigned, 0 ambiguous. Nothing is guessed.
- Imported verification, currentness and promotion labels are historical metadata. No source was fetched or re-checked.
- Browser state is per browser and per device; nothing is synced.
- The bundled 6.5 MB file is downloaded on each visit that has no saved import. There is no service-worker cache.
- The file hash differs from the one in the request (see above).

---

## Phase: corpussite integration (2026-09-30)

Source: https://github.com/fshahersw/corpussite at commit `9385b59e0e0fa05573df7ec2d9eafa8df30bebcf`.
The repository holds code only (645 files, about 9 MB). The about 130 GB corpus lives outside git, so only these real files were brought in (hashes in `public/data/corpus/PROVENANCE.json`):
- `us-counties-albers-10m.json` (us-atlas 3.0.1, ISC), sha256 `a674dfa3…` matches the upstream SOURCE note.
- `insights.json`: `insights-data.js` with the `window.CATALOG_INSIGHTS=` wrapper removed. Values are unchanged.
- The category rule `categories.py` is ported exactly to `src/lib/corpus/taxonomy.ts`.

New views: Overview, Places Map (state choropleth + county borders), state pages with county maps and county detail, Categories, Litigation Insights.

Commands on final code:
- `bunx vitest run`: 8 files, 71 tests passed. This includes `src/lib/corpus/corpus.test.ts`, which checks hashes, 51 states decoded, >3,000 counties, 2,122 case rows / 131 masters, alias resolution, taxonomy parity and the V2.2A↔state join totals.
- `bunx tsgo --noEmit`: clean.
- `bunx vite build`: succeeded.

Browser check (fresh context): the Overview map rendered. Clicking Texas opened /places/TX with 254 county shapes. Clicking a county opened /places/TX/48471 (Walker County, Texas). "Open sources in Library" applied the Texas filter. Insights rendered with the verbatim qualification. Categories rendered. All seven original views loaded. No page errors.

Limits:
- 888 V2.2A sources name no state and are not placed on the map. States are matched by exact name only.
- Neither dataset has county-level records, so county pages show a name and FIPS without counts.
- Applying corpussite's category rule to V2.2A headings puts most headings in "Other / not matched by rule" (4,531 links; Regulations 96). This is shown as-is, not re-guessed.
- Laws, judges, regulations and county registries from the full corpus are not imported. They need per-collection exports.

---

## Phase: navigation and data consolidation (2026-09-30)

The existing visual theme was preserved. The sidebar now has nine domain destinations: Search, Places, Courts, Judges, Matters, Law & Regulation, Safety, Sources, and Saved Work. Specialist source, review, export, analysis, and raw-inventory pages remain reachable through contextual navigation instead of competing in the sidebar.

Changes verified:
- Replaced long dataset tab strips with one compact record-view selector. Human-readable labels lead; raw dataset IDs remain visible in the advanced inventory.
- Added a metadata registry for dataset names, purposes, field labels, boolean/empty display, and explicit fallback handling.
- Kept all 71 connected datasets reachable through Sources → Dataset inventory.
- Added a compact cross-domain search field to every workspace header.
- Removed the repeated bundle-statistics panel from navigation; provenance remains under Imports & Exports.
- Preserved old `/overview`, `/mdls`, and `/laws` entry points as redirects, including their destination search state.

Final checks:
- `bunx vitest run`: **10 files, 80 / 80 tests passed**.
- `bunx tsgo --noEmit`: no errors.
- Preview build signal: **build OK**.
- Fresh Chromium context, 1280 × 1800: all nine destinations and all specialist pages loaded; Courts returned 50 rows and opened the N.D. California detail drawer; the compact Court selector exposed 11 real record views; Dataset inventory exposed all 71 datasets; global search navigation worked; no page errors or HTTP 5xx responses.
- Fresh Chromium context, 390 × 844: mobile navigation, contextual navigation, filters, and the source table rendered without page errors.

Remaining limits:
- Relationships are displayed only when supplied by corpus links or detail sections. Unsupported joins remain absent or explicitly unmapped; none were inferred.
- Very large corpus datasets still use bounded paging/search and may time out on broad searches.
- Saved sources and review decisions remain browser-local and are not synchronized.
