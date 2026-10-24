# Visual registry: status (2026-10-24)

The owner's visual registry (courthouses, judges, agencies, committees, companies, state capitols) is published to
`corpus_datasets` / `corpus_records` and read by the site through `src/lib/visuals/*`.

## Owner decisions applied

- 2026-10-24 afternoon: images are shown without re-verifying their licences at the origin. Each image still shows its
  credit, licence and source page as the registry records them. Images bind to pages only by exact identifiers.
- 2026-10-24 night: every agency seal and logo is used whatever its `rights_status` says (a registry seal takes
  precedence over a generic mark). Judge portraits are published, including state and special-court judges bound by a
  unique exact name within the same state.

## Published datasets (live row counts, read 2026-10-24)

| Dataset | Rows | Bound to | Page that reads it |
|---|---|---|---|
| `court_images` | 211 | exact court id | court pages (seal, emblem) |
| `court_buildings` | 160 | exact court id | court pages (building photos) |
| `judge_portraits_open` | 240 | FJC node id (235) or exact name within one state (5) | judge pages |
| `agency_images` | 218 | Federal Register agency id | agency pages (seal, logo) |
| `committee_marks` | 30 | exact committee code and website host | committee pages |
| `company_logos_open` | 37 | exactly one unshared CIK | company pages |
| `state_capitol_images` | 55 | state | state pages |

The build report in `private/build/visual_registry/REPORT.md` lists inputs by sha256, per-dataset licence and rights mix
as recorded, and every hold with its reason. The local `judge_portraits_open.json` in that folder has 46 rows; the
published dataset has 240 because the later FJC fetches added the rest.

## Binding rules

- A name never links on a near match. Federal judges bind by FJC node id. A state or special-court judge binds only when
  the registry names a state and exactly one judges record in that state has the same normalised name.
- Court images and buildings bind by exact court id. Registry court links that fail the identity rules are held, not
  guessed (for example photographs of artwork, or evidence pages that are not a court page).
- Agencies bind by Federal Register agency id. Two registry agencies have no matching agency page and are not shown.
- Committees need an exact committee code and website host. Three marks have no exact match and are held.
- Companies need exactly one CIK that no other registry entity shares.

## How the pages draw them

- Agency pages show the recorded seal first, then the logo, then the GSA mark, then the building icon. The GSA mark is
  used only when the agency has no recorded mark, or when the recorded image fails to load (the caption then says so).
  208 agencies have a recorded mark: 117 seals and 91 logos.
- The caption is one short line (kind, source site, author and licence when recorded) plus an "About this image"
  button with the file type, size and source page. Rights notes are not shown.
- Judge portraits sit below the recorded and crosswalk portraits and show their credit. A portrait bound by name within
  a state carries a note saying so.
- Image hosts must be on the fixed allowlist (`IMAGE_HOSTS` in `src/lib/visuals/common.ts`); a record that fails
  validation is dropped, never repaired.

## Open items

- Agency list pages still show only the GSA mark (they do not pass the agency id to the registry lookup).
- Agencies 6 (Agency for International Development) and 209 (Forest Service) have TIFF-only registry files, which
  Chrome and Firefox cannot draw. They need PNG renditions from the data side.
- The 176 stored court logos are not uploaded to storage yet; fallback emblems show meanwhile.
- 349 registry federal-judge portraits are held because their FJC page has not been fetched. FJC allows one request
  every 30 seconds, so further fetches are slow by design.

## Rebuild

`scripts/enrichment/visual_registry/` holds the build, verify and lookup scripts. `build_visual_registry.py` reads the
registry JSON and workbook plus saved read-only corpus lookups and writes the build files; `verify_visual_registry.py`
checks them; the lead publishes them through `scripts/enrichment/corpus_writer.py`.
