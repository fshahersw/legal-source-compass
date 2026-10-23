# Safety signals (safety/1): product, device and company safety data joined to MDLs

Wave 1025, SAFETY stream (branch `wave1025/safety`). This covers the design, the SQL contracts, the builders and their
validation samples, the self-updating sources, the app pages, and the RUNBOOK the lead runs to acquire and load the
full data. Workers never write to production. Everything below is staged under `private/build/w1025_safety/`, and the
lead loads it.

## 1. What the data is and is not

- **Reports are not proof of causation.** FAERS, MAUDE, CAERS and NHTSA complaints are voluntary or mandatory reports of
  events. They are not confirmed product defects or confirmed injuries. Every series, breakdown and record carries
  this caveat (`safety.caveat(source)`), and the pages show it.
- Counts are the publisher's counts on the retrieval date. openFDA date counts omit empty days, so months with no
  reports inside a stored coverage window are 0. Months outside the window are absent, never 0.
- Unknown values stay `null` and show as "Not recorded".

## 2. Sources

| id | Publisher / endpoint | Grain stored | Licence |
|---|---|---|---|
| openfda_faers | FDA openFDA `drug/event` (count aggregations) | product × series × month; product × MedDRA PT × quarter (or year) with serious counts | CC0 |
| openfda_maude | FDA openFDA `device/event` | product code / MDL group × event type × month; device and patient problems, makers, brands; record-level reports for MDL device groups | CC0 |
| openfda_caers | FDA openFDA `food/event` | MDL food/cosmetic groups × month | CC0 |
| openfda_enforcement | FDA openFDA `drug|device|food/enforcement` | MDL group × month | CC0 |
| openfda_device_recall | FDA openFDA `device/recall` | MDL group × month | CC0 |
| nhtsa_complaints | NHTSA ODI flat files `COMPLAINTS_RECEIVED_*.zip` | record-level complaints since 2020 (no VIN, city, dealer, operator or DOT); MDL vehicle group series | Public domain |
| cpsc_neiss | CPSC NEISS annual TSV | record-level cases 2021–2025 (**HELD**, see §9) | Public domain |
| cfpb_complaints | CFPB Consumer Complaint Database bulk CSV and API | company × product × issue × state × month aggregates; 24-month records, non-credit-reporting by default; no narratives | CC0 |
| dol_osha | DOL enforcement data catalog (OSHA inspection, violation, accident, accident_injury) | record level since 2015 (addresses, injury age and sex withheld) | Public domain |
| cms_open_payments | CMS Open Payments datastore API | manufacturer × first product × payment type × state × year (general payments) | Public domain |
| corpus `mdls`, `mdl_terminated_history` | JPML titles (read-only snapshot) | MDL title tokens for the linking check | — |

OSHA Severe Injury Reports are **not included**. The record-level file answers 403 to automated requests, and that
block is respected.

## 3. Schema `safety` (database/contracts/safety-signals-v1.sql)

All functions are SECURITY DEFINER with `search_path = ''`. Execution is revoked from public, anon and authenticated,
and granted to service_role. The file is idempotent: it uses no bare DROP and never puts `;` directly before
delete, drop or truncate.

- `sources` (12 rows), `loads` (one ledger row per loader call), `terms` (kind, label: MedDRA PTs, device problems,
  CFPB products and issues, …).
- `subjects`: national totals, MDL product groups, ranked FAERS products, MAUDE product codes and CFPB companies.
  The id pattern is `^[a-z][a-z0-9_]{1,20}:…`, e.g. `mdl:2740`, `faers:docetaxel`, `maude:DQX`, `cfpb_company:…`.
- `mdl_subjects`: the MDL ↔ subject link. Each link carries a `basis` and `title_tokens`, and is accepted only when
  every token occurs in the official title (§4).
- `series`: one row per (subject, series). `vals integer[]` holds one value per month from `coverage_from` to
  `coverage_to`, plus `total`, `query_url`, `method` and `retrieved_at`.
- `breakdowns`: one row per (subject, dim, period) with aligned `term_ids[]`, `vals[]` and `serious[]`, plus `limit_n`
  and `returned`, so a truncated top-N is visible.
- Record tables: `maude_reports`, `record_subjects` (record ↔ subject, with the rule that matched), `nhtsa_complaints`
  (`items` jsonb: one per make/model/year/component row), `neiss_cases`, `cfpb_monthly`, `cfpb_complaints`,
  `osha_inspections`, `osha_violations`, `osha_accidents`, `open_payments`.
- Loader: `public.safety_load_v1(target, rows jsonb, opts jsonb, meta jsonb)`.
  - Takes at most 10,000 rows per call.
  - Validates rows per target and refuses duplicate keys within a call.
  - Refuses credential-looking URLs and withheld fields (VIN, city, dealer, operator, addresses, injury age and sex,
    CFPB narratives).
  - `neiss_cases` needs `opts.confirmed_by_lead`.
  - Counts inserted, updated and unchanged rows and writes a `loads` row.

## 4. Linking rules

**Product ↔ MDL**

- A link is accepted only on explicit title evidence. `scripts/safety_v2/mdl_map.py` lists 114 MDLs, and each entry
  gives:
  - the title tokens that justify it;
  - a basis: `title_names_product` (38), `title_names_brand` (34), `title_names_manufacturer_and_device` (27),
    `title_names_vehicle_and_component` (9) or `title_names_class` (6);
  - the search derived only from those words. FAERS uses generic, brand or medicinal-product phrases, or the
    established pharmacologic class.
- `load_mdl_subjects` checks the tokens again against the titles snapshot. That snapshot is
  `private/build/w1025_safety/mdl/titles.json`: 1,858 MDLs, sha256 `0c65a74f…bbea3`.
- A mention of a product in a document is never a link.
- 27 MDLs are deliberately **not mapped**, with reasons in `NOT_MAPPED`:
  - Pesticides and other non-FDA products: MTBE, Roundup, paraquat, AFFF, social media, Generac.
  - Products FAERS cannot isolate: oral sodium phosphate, Watson fentanyl.
  - Titles with no product name a source field holds: J&J talc and sunscreen, Abbott formula and preterm nutrition,
    baby food, Bausch & Lomb.
  - Pelvic mesh: the MAUDE product codes changed over time.
  - Implantable defibrillators: maker names changed with acquisitions, or the title names no model.
  - Combat Arms earplugs: not in MAUDE.
  - Juul: no brand field.
  - Onewheel: CPSC scope.
  - PPA: withdrawn before FAERS coverage.
- Philips CPAP (MDL 3014) counts only reports with "Philips" in the manufacturer or brand. Reports filed under
  "Respironics" alone are not counted, so that group understates.

**Company**

- CFPB, OSHA, Open Payments, NHTSA and MAUDE companies are shown by the exact name each source publishes.
  Sources are never merged.
- The only cross-link is the CMS Open Payments manufacturer id to the insights `op-` entity.
- No SEC or SAM link is made, because no source here carries a CIK or UEI. A name match is not an identifier.

## 5. Read RPCs

### `public.product_signals_v1(p_mdl text)`: the VIZ-B product signal timeline

```
returns table (series text, month text, value numeric, unit text, source_dataset text, source_url text, basis text)
```

- `p_mdl` is the MDL number as text (`'2740'`). Anything else raises `22023 Invalid MDL`.
- `series` takes one of these values:
  - `adverse_events`, `adverse_events_serious`, `adverse_events_death` (FAERS, plus CAERS for food and cosmetic
    groups);
  - `device_reports`, `device_reports_death`, `device_reports_injury`, `device_reports_malfunction` (MAUDE);
  - `enforcement_reports`, `recalls` (FDA enforcement, device recalls, NHTSA recalls);
  - `complaints` (NHTSA vehicle complaints);
  - the litigation series:
    - `filings`: the month-over-month change in the JPML pending total-actions figure, consecutive monthly
      reports only, so it can be negative after a correction;
    - `docket_entries`: from `mdl_docket_activity`;
    - `documents_filed`: from `documents.documents` when present.
- `month` is `'YYYY-MM'`. `value` is the count for that month. `unit` is the label of what is counted.
  `source_dataset` is a `safety.sources` id or a corpus dataset id. `source_url` is the exact query or document. `basis`
  is the link basis plus its note, for example `title_names_brand — …`.
- A month inside a stored coverage window with no reports returns 0. A month outside it is absent. An MDL with no
  product link returns only its litigation series, or no rows.

### Other RPCs

- `safety_mdl_products_v1(mdl)`
- `safety_subjects_v1(type, kind, q, limit, offset)`. The listing total is the ranked count, or else the MDL group's
  main series total, or else null.
- `safety_subject_v1(id)`: profile, MDL links, series with values, all-time breakdowns (top 60), periods, record
  counts.
- `safety_breakdown_v1(id, dim, period, limit)`
- `safety_term_quarters_v1(id, dim, terms[], from, to, limit)`
- `safety_records_v1(source, subject, q, from, to, filter, limit, offset)`. Sources: maude, nhtsa, neiss, cfpb, osha,
  osha_accidents. The total is capped at 10,000.
- `safety_record_v1(source, id)`
- `safety_company_profile_v1(name)`: exact names, `merged_across_sources: false`.
- `safety_status_v1()`
- `safety_ingest_plan_v1(source)` and `safety_ingest_apply_v1(run, target, rows, opts)`

## 6. Insights family `safety2` (database/contracts/insights-safety2-v1.sql)

Apply this after safety-signals-v1.sql and `insights-v1.sql`. It registers family `safety2` (ordinal 85) with these
metrics:

- `mdl_product_reports`
- `mdl_product_reports_change_pct`
- `mdl_faers_serious_share`
- `mdl_maude_death_injury_share`
- `mdl_months_first_report_to_transfer`
- `mdl_months_first_recall_to_transfer`
- `faers_serious_share_national`
- `maude_death_injury_share_national`
- `nhtsa_complaints_crash_fire_share`
- `cfpb_top3_company_share`
- `osha_inspections_with_citations_share`

Each metric carries its method and caveats: reports ≠ causation, and the summary and alternative reporting programs
move MAUDE report volume between years. Facts are emitted only for spine entities. The first-report-to-transfer metrics
are null when matching reports reach back to the source's window floor (FAERS 2004-01; earlier reports are not
visible). Refresh with `select insights.refresh_safety2('manual')`, or through
`ingest_refresh_insights_v1` after a scheduled run.

## 7. Self-updating sources

| ingest source | function | schedule (UTC) | needs | writes |
|---|---|---|---|---|
| safety_faers_series | ingest-openfda-events | `*/20 5-8 * * 2` (12 runs each Tuesday) | secret `DATA_GOV_API_KEY` | `series_patch`: the last 3 months of each planned subject's FAERS series (cursor rotation, ≤ 90 requests/run) |
| safety_maude_series | ingest-openfda-events | `*/20 9-12 * * 2` | `DATA_GOV_API_KEY` | `series_patch` for MAUDE series |
| safety_cfpb_complaints | ingest-cfpb-complaints | `37 13 * * *` | — | `cfpb_complaints`: complaints received in the last 7 days for the products in scope (≤ 20 pages of 1,000) |

- The functions share `src/lib/safety/{ingestSafety,edgeSafety}.ts` with the ingest/1 run ledger. A run follows these
  steps: `ingest_open_run_v1`, then `safety_ingest_plan_v1`, then `safety_ingest_apply_v1`, then
  `ingest_finish_run_v1`, then `ingest_refresh_insights_v1`.
- The sources are registered by the contract with `enabled = false`, which is the ingest/1 default.
- If the deploy bundler will not follow imports outside `supabase/functions`, run
  `node scripts/safety_v2/bundle_functions.mjs <out>` and deploy from `<out>`.

## 8. App

- `/safety/products` is the index, with list views "Named in MDL titles", "Drugs (FAERS)" and "Devices (MAUDE)".
  It is searchable and paged.
- `/safety/products/$id` is the product profile, with tabs Overview (signal timeline), Reactions / problems (term ×
  period heatmap), Records (MAUDE or NHTSA; searchable, paged, linked to the publisher) and Sources (basis, queries,
  caveats).
- `/safety/companies?name=…` shows exact-name company facts per source.
- One new "Products & devices" tab in the Product safety section brings it to 7 tabs. The 9-section sidebar is
  unchanged.
- Server functions are in `src/lib/external/safetySignals.functions.ts`. They are read-only, zod-validated, use
  `rpcPostOptional`, and return `null` when the contract is not installed. In that case the pages say "not loaded
  yet".

## 9. Validation sample (staged, bounded)

| stream | staged rows | check | result |
|---|---|---|---|
| openfda/subjects | 78 subjects, 16 MDL links | tokens vs title snapshot | all pass |
| openfda/faers | 360 series, 308 breakdowns (MDLs 2740, 3094 …) | series months vs openFDA search totals; terms with serious counts | 135 checked across openFDA, 0 mismatches |
| openfda/maude | 92 series, 96 breakdowns | as above | (in the 135) |
| openfda/other | 9 series | enforcement/recall month sums | (in the 135) |
| openfda/records | 3,000 MAUDE reports + 3,000 subject links | re-read by report number | (in the 135) |
| nhtsa | 27,579 complaints (first 40,000 lines of the 2025–2026 file), 36 series, 58 links | vs api.nhtsa.gov complaintsByVehicle | 20 checked, 0 mismatches, 5 skipped (API 400/404 for some models) |
| cfpb | 14,748 aggregates, 19,104 records (5 companies) | vs CFPB API, settled months only | 30 checked, 0 mismatches |
| neiss (HELD) | 3,000 cases of 2025 | full years 2021–2025 vs published case counts and weight sums | exact: 340,442 / 323,343 / 338,262 / 361,672 / 410,201 cases |
| osha | 2,000 inspections, 6,071 violations, 66 accidents | DuckDB re-read of the DOL files | 75 checked, 0 mismatches |
| open_payments | 3,261 rows (2 manufacturers × 2023–2025) | vs CMS trans_general / total_amount_general | 6 checked, 0 mismatches |

Each `manifest.json` records the inputs (URL, sha256, rows), the chunk sha256 values and the notes. The total staged
size is about 11 MB.

## 10. Size budget (full run, estimated from measured bytes per row in pglite)

| item | rows | DB size |
|---|---|---|
| FAERS series, 2,000 products + MDL groups | ~17k | ~70 MB |
| FAERS/MAUDE breakdowns | ~25k | ~100 MB |
| MAUDE MDL records | ~420k + links | ~550 MB + ~130 MB |
| NHTSA complaints 2020+ | ~400k | ~450 MB |
| NEISS 2021–2025 (HELD) | 1.77M | ~600 MB |
| CFPB aggregates | 2.29M | ~260 MB |
| CFPB non-credit records, 24 months | 1.25M | ~170 MB (all products: 12.15M rows, ~1.4–2 GB) |
| OSHA since 2015 | — | ~0.5 GB |
| Open Payments (top 500 manufacturers, 2019–2025) | — | ~150 MB |
| **Total** | | **≈3.5–4 GB without NEISS ≈ 2.9–3.4 GB** (budget 6 GB) |

## 11. RUNBOOK (the lead)

Run every command from the repository root. Keys and credentials are sourced inside each command and never echoed.
Stream one build at a time, and load each with `--delete-loaded` so the disk stays under about 150 MB.

**0. Contracts** (once, in this order):

```
database/contracts/safety-signals-v1.sql      -- schema safety, loader, read RPCs, ingest source rows (enabled=false)
database/contracts/insights-safety2-v1.sql    -- after insights-v1.sql
```

Check: `select public.safety_status_v1();` lists the `safety` tables with 0 rows; `select count(*) from safety.sources;` returns 12.

**1. Titles and subjects** (a few minutes). Every openFDA command below is prefixed with the same
`set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a &&`; `load.py` and `fetch_titles.py`
run with `private/scratch/env.sh` sourced inside the same command.

```
python3 -I scripts/safety_v2/fetch_titles.py           # read-only corpus GETs
set -a && eval "$(grep '^DATA_GOV_API_KEY=' private/scratch/secrets.env)" && set +a && \
  python3 -I scripts/safety_v2/openfda_build.py subjects --outdir private/build/w1025_safety/full/openfda
```

Expected: 114 MDL groups (each token-checked again), 2,000 FAERS products, the MAUDE codes with ≥ 50 reports (4,799
codes seen in the sample run), and national subjects. Re-run `fetch_titles.py` first if the corpus MDL list changed.

**2. FAERS** (about 110k requests, ~9 h at ~3.5 req/s; the key allows 120k/day):

```
python3 -I scripts/safety_v2/openfda_build.py faers --outdir private/build/w1025_safety/full/openfda --max-requests 25000
python3 -I scripts/safety_v2/load.py private/build/w1025_safety/full/openfda --delete-loaded   # with env.sh sourced
```

The build is resumable through `done.txt`, so repeat it until `stopped_at_budget` is false. Quarter grain applies to
MDL groups and the top 300 products, and year grain to the rest.

**3. MAUDE series + other + records:**

```
python3 -I scripts/safety_v2/openfda_build.py maude   --outdir private/build/w1025_safety/full/openfda
python3 -I scripts/safety_v2/openfda_build.py other   --outdir private/build/w1025_safety/full/openfda
python3 -I scripts/safety_v2/openfda_build.py records --outdir private/build/w1025_safety/full/openfda   # ~420k reports in windows ≤ 25,000
python3 -I scripts/safety_v2/validate_openfda.py --outdir private/build/w1025_safety/full/openfda --n 60
python3 -I scripts/safety_v2/load.py private/build/w1025_safety/full/openfda --delete-loaded
```

**4. NHTSA** (streams the zips remotely; one file at a time):

```
python3 -I scripts/safety_v2/nhtsa_complaints.py --files 2020-2024 --outdir private/build/w1025_safety/full/nhtsa
python3 -I scripts/safety_v2/validate_nhtsa.py --outdir private/build/w1025_safety/full/nhtsa
python3 -I scripts/safety_v2/load.py private/build/w1025_safety/full/nhtsa --delete-loaded
# then --files 2025-2026
```

**5. CFPB** (reads the 5.6 GB CSV member as a stream, ~20–30 min; or `--url` to stream from CFPB):

```
python3 -I scripts/safety_v2/cfpb_build.py --outdir private/build/w1025_safety/full/cfpb
python3 -I scripts/safety_v2/validate_cfpb.py --outdir private/build/w1025_safety/full/cfpb --n 30
python3 -I scripts/safety_v2/load.py private/build/w1025_safety/full/cfpb --delete-loaded
```

Expected: 2,291,113 aggregate rows and 1,252,537 non-credit records since 2024-11, from the local copy dated
2026-10-15. `--records-scope all` adds credit reporting (12.15M rows, ~1.4–2 GB). Do not use it without a budget
decision.

**6. OSHA** (inspections from the local catalog copy; violations via HTTP Range reads):

```
python3 -I scripts/safety_v2/osha_build.py --since 2015-01-01 --outdir private/build/w1025_safety/full/osha
PYTHONPATH=private/scratch/pylib python3 scripts/safety_v2/validate_osha.py --outdir private/build/w1025_safety/full/osha
python3 -I scripts/safety_v2/load.py private/build/w1025_safety/full/osha --delete-loaded
```

**7. Open Payments:**

```
python3 -I scripts/safety_v2/open_payments_build.py --years 2019-2025 --top 500 --outdir private/build/w1025_safety/full/open_payments
python3 -I scripts/safety_v2/load.py private/build/w1025_safety/full/open_payments --delete-loaded
```

**8. NEISS (HELD).** AGENTS.md says `cpsc_injury_data` "stays removed, never reacquired without a new instruction".
Load only after the owner confirms. The loader refuses without `--confirm-neiss "<date> <who confirmed>"`.

**9. Catalog datasets and insights:**

```
python3 -I scripts/safety_v2/catalog_build.py --publish     # safety_mdl_products, safety_faers_products, safety_maude_products, safety_cfpb_companies
select insights.refresh_safety2('manual');
```

**10. Edge functions.** Deploy `ingest-openfda-events` and `ingest-cfpb-complaints` with `--no-verify-jwt`; both
require a bearer token. Set the secret `DATA_GOV_API_KEY`. Do one manual run each, then enable:

```
update ingest.sources set enabled = true where id in ('safety_faers_series','safety_maude_series','safety_cfpb_complaints');
```

Then re-apply ingest-v1.sql section 9, which creates the schedules.

**Verification SQL:**

```sql
select public.safety_status_v1();
select target, count(*) calls, sum(rows) rows, sum(inserted) ins, sum(updated) upd from safety.loads group by 1 order by 1;
select series, count(*) months, min(month), max(month), sum(value) from public.product_signals_v1('2740') group by 1 order by 1;
select relation, count(*), count(distinct mdl) from safety.mdl_subjects group by 1;   -- mdl_group: 114 MDLs
select basis, count(*) from safety.mdl_subjects group by 1 order by 2 desc;
select source_id, count(*) from safety.series group by 1;
select public.safety_subjects_v1('mdl_group', null, null, 20, 0);
```

## 12. Open risks

- NEISS hold (owner removal of `cpsc_injury_data`).
- Philips understatement (Respironics-only reports are not counted).
- OSHA Severe Injury Reports are blocked (403).
- CFPB credit-reporting records are excluded by default.
- The FAERS request budget takes about two days at the daily key limit if every product gets quarter grain.
- The local CFPB and OSHA copies are shared files dated 2026-10-15/17.
- openFDA counts change as FDA re-processes reports. The weekly patch rewrites the last 3 months only.
