# In-force state statutes from official publishers — AL…MA (STAT-A, wave 1025)

Scope: current, in-force statutory text of 22 jurisdictions (AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY
LA ME MD MA) read only from each state's official government publisher, normalized to `state-law/1`
(`scripts/state_law/MODEL.md`), with an exact-text proof against the publisher's bytes, a database contract
(`database/contracts/state-law-inforce-v1.sql`) and the `/law/codes/$state` in-force browser. STAT-B covers MI–WY on
the same model and library.

Nothing here has been loaded into production: workers never write production. Everything below is staged for the lead.

## 1. Coverage matrix

Sections = the publisher's section count in this project's earlier capture of the same publisher
(`corpus_ingest.publisher_code_states_v2`, read-only), or the count of a full dry run of the new parser where one was
made (marked †). "Sample" = the bounded validation run committed with this wave (40 sections or the chapter's
sections), every stored line of text, heading, history and status marker found verbatim in the publisher's bytes
(`verify.py`, `.raw` kept under `private/acq/w1025_stat-a/state_law/<xx>/`).

| | Publisher (official government) | Source and access | Publisher's currency statement (verbatim) or label | Sections | robots / rate | Plan | Sample |
|---|---|---|---|---:|---|---|---|
| AL | Legislative Services Agency, ALISON | JSON API `/api/code-of-alabama?page=N` (~120 pages) | none printed; newest node `updatedAt` 2026-09-23 | 48,872 | no robots file (app shell); 1 req/s | fresh (~2 min) | 40 ✓ |
| AK | Legislative Affairs Agency, BASIS | per-chapter print ranges `statutes.asp?media=print&secStart=…&secEnd=…` | label "Alaska Statutes 2025" | 20,717 | allowed; 1 req/s | fresh (~1,900 req, ~35 min) or retained | 29 (ch. 09.10) ✓ |
| AR | — | **BLOCKED** — arkleg.state.ar.us links the code only to advance.lexis.com | — | — | commercial host never fetched | owner decision | — |
| AZ | Legislative Council (azleg.gov) | one page per section | "The Arizona Revised Statutes have been updated to include the revised sections from the 57th Legislature, 2nd Regular Session. Please note that the next update of this compilation will not take place until after the conclusion of the 58th Legislature, 1st Regular Session, which convenes in January 2027." | 25,157 | **Crawl-delay 120 s** (25k pages = ~35 days) | **retained** (captures of 2026-10-07; landing page and § 12-542 re-read fresh 2026-10-23 byte-identical) | 40 ✓ |
| CA | Office of Legislative Counsel | bulk `pubinfo_2025.zip` (1.29 GB) streamed; sample by HTTP range | none printed; Last-Modified Mon, 19 Oct 2026 | 162,526 | allowed; one stream | fresh (stream, no disk) | 40 ✓ (2 future-effective, 1 expired) |
| CO | — | **BLOCKED (owner decision)** — leg.colorado.gov: "Click here to access the Colorado Revised Statutes hosted by LexisNexis."; the government host serves C.R.S. **2024** title PDFs only (2025/2026 paths 404); olls.info (crs2026 HTML, captured) is not linked from any government page found | — | (35,791 in capture) | — | confirm olls.info is OLLS-operated → parser over the retained crs2026 files | — |
| CT | Legislative Commissioners' Office | revision `/current/pub/` + `/2026/sup/` supplement (supplement sections replace the revision's) | "GENERAL STATUTES OF CONNECTICUT Revised to January 1, 2025 / 2026 SUPPLEMENT … Revised to January 1, 2026 / Note: This 2026 Supplement is intended to be used in conjunction with the General Statutes of Connecticut, revised to January 1, 2025" | 32,519 | allowed; 1 req/s (intermediate cert supplied from `certs/`) | fresh (~1.7k req, ~30 min) | 37 ✓ |
| DE | Code Revisors / Division of Legislative Services | title → chapter (→ subchapter) pages | "This version includes all acts enacted as of October 01, 2026, up to and including 85 Del. Laws, c. 550." | 23,444 | no robots (404); 1 req/s | fresh (~1.5k req, ~25 min) | 40 ✓ (4 repealed) |
| DC | Council of the District of Columbia | the code site asks "Please do not scrape. Instead, bulk download"; `metadata.json` names the build's commit of the Council's codified XML repository → shallow per-title git fetch at that commit | publisher date `recency through="2026-10-20"` (D.C. Law 26-190; D.C. Act 26-437); build-date/codified-date 2026-10-21 | 24,221 † | robots: content signals search=yes, ai-train=no | fresh (full dry run 160 s; 563 "(Perm)" copies ledgered as not-current) | 24 ✓ |
| FL | The Florida Legislature (Online Sunshine) | title index → "View Entire Chapter" XHTML | label "The 2026 Florida Statutes" | 24,993 | allowed; 1 req/s | fresh (~1k req, ~20 min) | 40 ✓ |
| GA | — | **BLOCKED** — legis.ga.gov links the code only to lexisnexis.com/hottopics/gacode and advance.lexis.com | — | — | — | owner decision | — |
| HI | Legislative Reference Bureau / Legislature | `data.capitol.hawaii.gov/hrscurrent/` listings → one HTML file per section | none printed on the data host; volume folders dated 1/6/2026 | 22,973 | allowed (except *.axd); 1 req/s | fresh (~25k req, ~7 h) or retained (25,213 matching pages) | 40 ✓ |
| ID | Legislative Services Office | title → chapter → section pages | "Idaho Statutes are updated to the website July 1 following the legislative session." / "Idaho Statutes and Constitutions are current through the 2026 Legislative Session." | 22,538 | allowed; 1 req/s | fresh (~24k req, ~7 h) or retained (27,994) | 40 ✓ |
| IL | Legislative Reference Bureau (ILCS database) | chapters → acts → article/full-text pages | "Updating the database of the Illinois Compiled Statutes (ILCS) is an ongoing process. Recent laws may not yet be included in the ILCS database, …" | 72,813 | **Crawl-delay 10 s** | fresh (~2.9k req, ~8 h) | 40 ✓ |
| IN | Office of Code Revision (iga.in.gov) | bulk `2026-Indiana-Code-html.zip`; the URL serves an app shell to this project's honest client | label "2026 Indiana Code"; title files dated 2026-06-23 | 83,135 † | fresh fetch refused (no bypass) | **retained** archive (captured 2026-10-06, sha256-checked); full dry run 83,135 sections, 13 superseded versions ledgered | 37 ✓ |
| IA | Legislative Services Agency | per-chapter "slim" XML (listed under "Unofficial Version"; official = authenticated volume PDFs) | "Year: 2026 (1/1/2026 - 12/31/2026)", label "Iowa Code - 2026"; newest file Last-Modified 10 Jul 2026 | 47,239 | allowed (except /chambers/); 1 req/s | fresh (~1.3k req, ~25 min) | 40 ✓ |
| KS | Office of Revisor of Statutes | chapter → section pages | "These statutes include amendments and new laws enacted during the 2025 legislative session." (authenticated text = printed K.S.A.) | 47,489 | allowed; 1 req/s | fresh (~48k req, ~13 h) or retained (47,490) | 28 (art. 60-5) ✓ |
| KY | Legislative Research Commission | chapter pages → one PDF per section (layout text) | "Includes enactments through the 2026 Regular Session" / "The KRS database was last updated on 10/23/2026" | 40,462 | no robots (404); 1 req/s | fresh (~41k req, ~11.5 h) or retained (40,470) | 40 ✓ |
| LA | Louisiana State Legislature | TOC postbacks → `LawPrint.aspx?d=` per section | "Laws have been updated through the 2025 First Extraordinary Session." / "For a list of laws updated through the 2026 Regular Legislative Session, click here." | 46,365 | no robots (404); 1 req/s | fresh (~52k req, ~14.5 h) or retained (52,320) | 40 ✓ |
| ME | Office of the Revisor of Statutes | title → chapter → section pages | "This version of the Maine Revised Statutes reflects changes made through the Second Regular Session of the 132nd Maine Legislature, is current through October 1, 2026, and is subject to change without notice." | 45,774 | allowed; 1 req/s | fresh (~48k req, ~13 h) or retained (45,774) | 40 ✓ |
| MD | Department of Legislative Services | GetSections API + StatuteText pages (enactments in effect) | "Show statutes in effect as of October 1st of this year" | 40,347 | allowed; 1 req/s | fresh (~40k req, ~11 h) | 21 ✓ |
| MA | General Court (malegislature.gov) | JSON API (Parts/Chapters/Sections) | "This site includes all amendments to the General Laws passed before May 31, 2026, for laws enacted since that time, see the 2026 Session Laws." + its NOTICE that the site is not the official version | 26,812 | allowed; 1 req/s | fresh (~28k req, ~8 h) or retained | 40 ✓ |

Totals for the 19 acquirable jurisdictions: ≈ 858,000 sections, ≈ 1.19 GB of statute text (capture-based).

Currency gaps the publishers themselves state (shown verbatim beside every section, never hidden): KS (2025 session
only), LA (through the 2025 First Extraordinary Session), AZ (through the 57th Legislature, 2nd Regular Session),
CT (2025 revision + 2026 supplement), IA (annual edition), AK (label 2025). Publisher notes that the web text is not
the official/authenticated edition (MA, KS, IA) are kept in `currency_statement`/`terms_note`; the `official_source`
flag means "read from the official government publisher", not "authenticated edition".

## 2. Status, versions and what is left out

- Status comes only from the publisher's own markers (`status_basis=publisher_marker`) or, for operative text in the
  publisher's current compilation, `in_force` with `status_basis=current_compilation`. DC "Not Funded"/"Not
  Applicable"/"[Omitted]" are kept as `not_recorded` with the verbatim marker. Shared marker detection was tightened
  this wave: catchlines such as "Repealed Laws Not Revived." (AL § 1-1-11, previously misread as repealed),
  "Transferred employees; rights." or "Sunset." are not markers.
- Versions: CA, AL, IN, ME (and IL) print several versions of a number; each becomes `section_id@k` with its verbatim
  label and dates; a version whose stated end date has passed is ledgered (`rejects.jsonl.gz`, "superseded version");
  a version whose start date is ahead is `future_effective`.
- Not kept: annotations, case notes, editor's notes, cross references, law review references (HI, KS, KY, ME, IA
  footnotes), recodification citations (IN), DC codification instructions (named in `effective.note` when present).
- Ledgered, not emitted: range entries ("Secs. x to y", CT, HI, AK), DC "(Perm)" permanent-version copies (the
  publisher marks them "not the most current"), superseded versions.

## 3. Storage design

Choice: dedicated tables in a private `state_law` schema (contract `database/contracts/state-law-inforce-v1.sql`),
not `corpus_records` and not Storage objects:
- the reader needs tree navigation, exact-section reads, per-state search and citation resolution with joins on
  edition/code/number — relational and indexable;
- one active edition per state with atomic supersede/withdraw/purge (counted, bounded deletes) and a loader that
  re-checks every row (sha256 of text, normalized number, status enum, references, counts) before activation;
- publisher bytes stay where they already are (private `corpus-originals`, content-addressed) or are re-read; the
  tables hold text and provenance only.

Tables: `editions` (lifecycle loading → active → superseded/withdrawn; unique active per state), `codes`,
`citation_patterns`, `nodes`, `sections` (LIST-partitioned by state, 51 partitions), with `tsv` a generated column.

Row/byte estimates (AL–MA, 19 jurisdictions):

| item | estimate |
|---|---|
| sections rows | ≈ 0.86 M (CA 163k, IN 83k, IL 73k largest) |
| section text | ≈ 1.19 GB raw; TOAST-compressed ≈ 0.5–0.6 GB |
| tsvector (generated, A = number + heading, B = `left(text, 250000)`, `english`) | ≈ 0.45–0.6 GB |
| GIN per partition | ≈ 0.35–0.5 GB |
| nodes | ≈ 60–80k rows, < 30 MB |
| btree indexes (edition/code/number_norm, node, ordinal) | ≈ 120 MB |
| **total** | **≈ 2.0–2.5 GB** (national with STAT-B ≈ 4.5–5 GB; production DB is 119 GB) |

Measured: DC full dry run 24,221 sections → `sections.jsonl.gz` 12.4 MB; IN 83,135 → 23.9 MB.

Full-text search plan: `websearch_to_tsquery('english', q)` over the per-state partition (the RPC always filters by
state, so one partition's GIN is used), ranked by `ts_rank_cd` with number/heading weight A, snippets by
`ts_headline` with `⟦…⟧` markers (parsed by `snippetSegments`, never HTML), plus an exact-citation hit first (a query
that parses as a citation of the state resolves through the same patterns as CITE). Text beyond 250,000 characters
of a section is stored and readable but not indexed (a handful of very long CA/IN sections).

RPCs (public, SECURITY DEFINER, `search_path=''`, service_role only; loader RPCs lead-only):
- `state_law_states_v1()` — one row per active edition with currency fields and status counts;
- `state_law_tree_v1(p_state, p_node_id, p_limit, p_offset)` — node, breadcrumb, children with counts, direct
  sections (paged);
- `state_law_section_v1(p_state, p_section_id)` — full section, path, source, other versions, prev/next;
- `state_law_search_v1(p_state, p_q, p_limit, p_offset, p_status)` — ranked hits with snippets;
- `state_law_resolve_v1(p_state, p_citation)` → `{result: resolved | ambiguous | unresolved | unknown_state |
  no_edition, section_id, pinpoint, candidates, …}` for CITE (MODEL.md §5): exact lookup only, never a neighbour;
- loader: `state_law_begin_edition_v1`, `…_load_nodes_v1`, `…_load_sections_v1`, `…_activate_edition_v1`,
  `…_withdraw_edition_v1`, `…_purge_edition_v1`; `state_law_retained_sources_v1` lists retained publisher originals.

Python ↔ SQL parity: `norm_number`, `norm_cite` and every state's citation patterns are checked against
`norm_vectors.json` (64 probes across the 20 acquirable jurisdictions) in both `test_lib.py` and the PGlite contract
test.

## 4. App wiring (`/law/codes/$state`)

- Tabs "In force (official publisher)" / "Captured editions" (≤ 7 tabs, 9-section nav unchanged); legacy deep links
  keep the captured view.
- In-force view: edition header (publisher + official source link, the currency statement verbatim — or "Publisher
  states the text is current through …" when only a date is stated, or "No currency statement from the publisher"
  plus what the source files state — read dates and whether the edition was re-parsed from retained copies, status
  counts, About this source), outline with breadcrumb and paging, section reader (status badge, basis and marker,
  effective dates, text, history, source link + sha256, other versions, prev/next, copy citation), search within the
  state (snippets, status filter, exact citation hit).
- `/law/codes`: "Currency by jurisdiction" table (publisher statement, read date, sections, repealed count, captured
  edition beside it).
- When the contract is not applied the server functions return null and the page shows "not loaded" — no fallback to
  other data.

## 5. RUNBOOK

Prerequisites: Python 3.11+ with lxml (present), `pdftotext` (poppler, for KY), `git` (DC), network to the publisher
hosts. Disk: no full run keeps raw bytes; transient footprint ≤ 15 MB (DC per-title checkout), IN holds its 43 MB
archive in memory; outputs ≈ text/5 gzipped (CA ≈ 45 MB, others 3–25 MB).

### 5.1 Apply the contract (lead)

```
# PGlite proof first (no network):  node --test scripts/state_law/state-law-contract.test.mjs
# then apply database/contracts/state-law-inforce-v1.sql as one migration (creates schema state_law + RPCs)
```

### 5.2 Acquire (one state per command; run several states in parallel only on different hosts)

```
B=private/build/state_law; R=private/acq/state_law
python3 scripts/state_law/run.py <xx> --out $B --raw $R                     # fresh, from the publisher
python3 scripts/state_law/run.py <xx> --out $B --raw $R --option source=retained   # retained originals (needs
                                    # the contract applied and EXTERNAL_SUPABASE_URL/KEY in the environment)
python3 scripts/state_law/run.py <xx> --out $B --raw $R --retained-index FILE      # retained, index from a file
python3 scripts/state_law/verify.py $B/<xx>/<edition_id> --no-require-raw          # structural check of a full run
```

| state | command extras | requests | time at the published/polite rate | notes |
|---|---|---:|---|---|
| AL | — | ~120 | 2 min | |
| AK | — | ~1,900 | 35 min | retained print ranges also available |
| AZ | `--option source=retained` | 25,157 retained | minutes | fresh would take ~35 days (Crawl-delay 120) |
| CA | — | 1 stream (1.29 GB) | 15–30 min | nothing written to disk but outputs |
| CT | — | ~1,700 | 30 min | supplement year `SUP_YEAR` in ct.py; bump each January |
| DE | — | ~1,500 | 25 min | |
| DC | — | 1 + 55 git fetches | 3 min | revision taken from the site's metadata.json |
| FL | — | ~1,000 | 20 min | |
| HI | retained optional | ~25,000 | 7 h | |
| ID | retained optional | ~24,000 | 7 h | |
| IL | — | ~2,900 | 8 h | Crawl-delay 10 honoured |
| IN | `--option source=retained` | 1 archive | 1 min | fresh is refused by the publisher (exit 3) |
| IA | — | ~1,300 | 25 min | |
| KS | retained optional | ~48,000 | 13 h | |
| KY | retained optional | ~41,000 | 11.5 h | needs pdftotext |
| LA | retained optional | ~52,000 | 14.5 h | |
| ME | retained optional | ~48,000 | 13 h | |
| MD | — | ~40,000 | 11 h | |
| MA | retained optional | ~28,000 | 8 h | |
| AR, GA, CO | — | 0 | — | exit 3, `blocked.json` written |

Exit codes: 0 done, 3 blocked (publisher refused or state blocked; nothing to load), 1 error (fix and re-run; runs
are idempotent per edition directory).

### 5.3 Load (lead only)

```
set -a; . private/scratch/env.sh; set +a        # credentials only in this shell, never printed
python3 scripts/state_law/load.py $B/<xx>/<edition_id> --dry-run    # validates files, prints the plan, no network
python3 scripts/state_law/load.py $B/<xx>/<edition_id> --activate   # begin → nodes → sections → activate
```
The loader refuses sample editions and editions whose `verify.json` failed; every call is idempotent (re-run the
same command to resume). Activation re-checks counts, orphan sections, duplicate ordinals and node counts in SQL and
supersedes the state's previous active edition.

### 5.4 Verification SQL (read-only)

```sql
select state, edition_id, lifecycle, (expected->>'sections')::int sections, currency_statement
  from state_law.editions order by state, created_at;
select state, status, count(*) from state_law.sections s join state_law.editions e using (edition_id)
 where e.lifecycle = 'active' group by 1, 2 order by 1, 2;
select public.state_law_resolve_v1('DE', '10 Del. C. § 8106');          -- resolved
select public.state_law_resolve_v1('KS', 'K.S.A. 2025 Supp. 60-513(a)(4)'); -- resolved, pinpoint (a)(4)
select public.state_law_resolve_v1('DC', 'D.C. Code § 12-9999');         -- unresolved (never a neighbour)
select public.state_law_search_v1('ME', 'limitation of actions', 5, 0, null);
select pg_size_pretty(pg_total_relation_size('state_law.sections_ca'));
```

Rollback: `state_law_withdraw_edition_v1(edition_id, reason)` (the state then has no active edition and the page
says so), re-load the previous edition directory with `load.py --activate` (activation is only from `loading`), then
`state_law_purge_edition_v1(edition_id, 5000)` in bounded rounds until it reports nothing left.

### 5.5 Refresh plan and re-check job

Cadence (from the publishers' own statements): DC weekly (rebuilds as laws take effect); DE, KY, ME, MD, MA monthly;
AL, IL monthly; LA, KS, AZ, ID, HI, CT, IA, IN, AK, FL after each session (re-check January and July); CA monthly
(the bulk file is rebuilt continuously).

Re-check job design (`state_law_currency_watch`, scheduled edge function with a run ledger, lead to deploy): for each
active edition, re-read only the publisher's currency evidence — the statement page (`currency_source_url`), the
bulk file's Last-Modified/ETag (CA, IA chapter sample), DC `metadata.json`'s codified-date and revision, ALISON's newest
`updatedAt` — and compare it verbatim/by hash with the active edition. A change records `currency_changed` with both
values and queues a re-acquisition of that state; no text is changed by the watcher and nothing is inferred about
which sections changed. Requests per weekly run: ~25, each under the host's crawl delay.

## 6. Files

Library and contract: `scripts/state_law/{MODEL.md, lib.py, run.py, verify.py, load.py, gen_vectors.py,
norm_vectors.json, test_lib.py, test_states.py, state-law-contract.test.mjs, certs/}`,
`database/contracts/state-law-inforce-v1.sql`. State modules: `scripts/state_law/states/{al, ak, ar, az, ca, co, ct,
dc, de, fl, ga, hi, ia, id, il, in, ks, ky, la, ma, md, me}.py`. App: `src/lib/law/stateLaw{Contract,.server,
.functions}.ts`, `src/components/law/{InForceCodeBrowser, CodeCurrencyTable}.tsx`, `src/routes/law_.codes.{$state,
index}.tsx`.
