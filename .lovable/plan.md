# Law & Safety as folders

Uses the same folder cards and clickable path as Courts and Judges. The look stays the same.

## Law & regulation
```text
Law
  Federal | States | Reference tools
    Federal -> Statutes (U.S. Code, public laws)
             | Regulations (CFR parts, sections, rule documents)
             | Federal Register
             | Agency notices and outlines (e.g. IRS notices)
    States  -> pick a state (map-style card grid with counts)
               -> type of law (code, statutes, court rules...)
                 -> collection -> provision list -> provision / record page
    Reference tools -> Limitation periods | Citations
```
- The current Law outline selector becomes folder steps at the Federal and State levels. Collections open straight into their outline.
- Every step has its own link, so it can be shared and the back button works.
- Folders with no records are greyed out and can't be opened.
- The old dataset list stays reachable as "All law datasets (list)".
- State pages on the map get a "Laws for this state" folder, linking to that state's law folder.

## Product safety
```text
Safety
  FDA | CPSC | Other agencies
    -> record kind (recalls, enforcement, adverse events, injury data, science documents)
      -> searchable list -> record page
```

## Technical details
- A pure `lawTree.ts` maps each law and safety dataset ID to a folder (for example `federal_regulations_*` goes to Regulations, `public_laws` to Statutes, `cpsc_*` to CPSC, `agency_safety_*` by agency prefix). Any ID that isn't mapped goes to "Other", so nothing is hidden. This comes with a test that every current law/safety dataset lands in exactly one folder.
- State folders combine the law-outline collections (by their state code) with state-tagged datasets such as `state_codes`, `indiana_code` and `sd_statutes`. Counts come from the collection provision totals and the dataset record counts that are already loaded.
- The lists at the deepest step reuse the existing DatasetBrowser and LawOutline pieces, now opened from search params (`scope`, `state`, `type`, `ds`, `kind`).
- Then typecheck, tests, build, and a browser walk: Law → Federal → Regulations → a record; Law → States → Texas → a collection → a provision; Safety → FDA → recalls → a record.

## Limits
- Very large datasets (state and federal codes, the Federal Register) still page record by record. Broad searches inside them can be slow.
- Law outlines are marked by your database as not yet cleared for publication. That label stays.
