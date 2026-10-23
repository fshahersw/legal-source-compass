# Citations v2: one citation extractor, exact resolution, citation graph

Wave 1025, worker CITE. Branch `wave1025/cite`. Pattern table version `citations-v2/2026-10-25.3`.

## 1. What this is

The citation extractor that every part of the platform uses. It has three runtimes that give the same output:

| Runtime | Code | Used by |
|---|---|---|
| Python | `scripts/citations_v2/engine.py` | batch (re-)extraction (`run_batch.py`), gold-set tooling |
| TypeScript | `src/lib/citations/engine.ts` | the app (`src/lib/assistant/citations.ts` now calls it) |
| Deno (same TS module) | `supabase/functions/ingest-citations` → `src/lib/citations/nightly.ts` | nightly extraction of newly indexed filing pages |

Both engines read one pattern table. `scripts/citations_v2/pattern_source.py` holds the hand-written data. The
Free Law Project reporter list is vendored under `scripts/vendor/reporters-db/` (BSD-2, version 3.2.67 from the PyPI
sdist, pinned by sha256 in `PINNED.json`). `build_patterns.py` builds the table into `src/lib/citations/patterns.json`
and `patterns.data.ts`. The patterns are written in a restricted regex dialect that both engines run the same way:
JavaScript syntax, ASCII `\w`/`\d`, JavaScript `\s`, fixed-width lookbehind only, no `\b`, no inline flags. The
generator rejects anything outside that dialect.

Parity between the engines is checked three ways:

- **Golden fixture:** `src/lib/citations/fixtures/golden.json` holds 31 texts and one two-page document, 180 citations,
  written by `make_golden.py`. The Python test suite and the vitest suite both check their engine against it.
- **Gold windows:** run on all 153 gold windows, the two engines gave identical output for 641 citations (0 differences).
- **Real filings:** run on 100 indexed byte sets (1,479 pages, 2,017 citations, with short forms linked across pages),
  the two engines gave identical output (0 differences).

Offsets count code points. The TypeScript engine converts its UTF-16 indexes to code points.

### Kinds and keys

| Kind | Key | Example |
|---|---|---|
| case | `case:VOL:REPORTER:PAGE` (reporter = canonical reporters-db edition) | `case:550:U.S.:544` |
| usc | `usc:T:S[:END]`, `usc-ch:T:CH`, appendix `usc:50a:4305` | `usc:42:1983` |
| cfr / cfr_part | `cfr:T:P.S[:END]` / `cfr-part:T:P[:END]` | `cfr:21:314.50` |
| federal_register | `fr:V:P` | `fr:85:12345` |
| statutes_at_large | `stat:V:P` | `stat:124:119` |
| public_law | `pl:C:L` | `pl:111:148` |
| constitution_us / _state | `const-us:art-1:sec-8:cl-3`, `const:CA:art-1:sec-7` | |
| federal_rule | `rule:frcp|frcrp|fre|frap|frbp:N` | `rule:frcp:12` |
| local_rule | `local-rule:<court letters>:N`; with no court named, `local-rule::N` | `local-rule:dnj:7.1` |
| state_statute | `state-stat:ST:CODE:PATH`, 50 states + D.C. (Bluebook T1) | `state-stat:CA:busprof:17200` |
| state_regulation | `state-reg:ST:CODE:PATH`, 50 states + D.C. | `state-reg:CA:code-regs:5:431` |
| mdl | `mdl:N`: a mention, never membership | `mdl:2738` |
| docket | `docket:[O:]YY-type-NNNNN`: a mention | `docket:3:16-md-02738` |

Pin cites, subsections and paragraphs go in `pin`, not in the key. For example, `28 U.S.C. § 1332(d)(2)` has the key
`usc:28:1332` and the pin `(d)(2)`.

Short forms are linked to their antecedent across pages:

- `Id.`, `id. at`, `Id. § …`
- `550 U.S. at 555`, `76 FR at 48213`, `124 Stat. at 242`
- `supra`
- `§ 1983` after a full § 1983 citation
- `Rule 56` after a federal-rule citation

A short form whose antecedent cannot be determined is not given a key. Its `short_status` is `ambiguous` (string
citations, a record reference in between, a page pin after an unpaged authority) or `none`. The engine never guesses.

ECF headers (`Case 3:16-md-02738 Document … Filed … Page …`) are treated as page furniture: docket and MDL numbers
inside them are dropped.

## 2. Measurement (gold set)

The gold set is `scripts/citations_v2/gold/gold-2026-10-25.json`, with sha256 `76f6f98629934223bff0899a17ac30a9f3fe230c12251ee028e13ccb2c9d6bc6`. It has 153 windows
and 648 hand-verified citations. Each window records its exact offsets and source hashes: `sha256` and page,
`page_text_sha256`, `window_sha256`, and for the Federal Register windows the GovInfo `raw_sha256`.

How the gold set was built:

1. Draft each window with the new extractor.
2. Review the window by hand. The reviews are in `corrections.json`: items removed, added (exact text and occurrence),
   re-keyed, re-kinded, or ignored. An item is ignored when it is page furniture cut off by the window edge.
3. Freeze the result.

`gold_tool.py measure` scores each extractor against the gold set by family. A prediction must overlap a gold span and
have the same key to count. The full report, with every miss and every error, is
`scripts/citations_v2/gold/measure-2026-10-25.json`.

The windows come from four strata:

| Stratum | Windows | Gold citations | Source |
|---|---|---|---|
| court filings | 83 | 314 | indexed filing pages: a uniform sample, a statute/regulation-token sample (`state_pages.json`), and an administrative-code sample (`reg_pages.json`) |
| opinions | 39 | 228 | case-law opinions, including a state-court stratum with statute tokens |
| reports | 20 | 61 | GAO and DOJ-OIG report PDFs |
| Federal Register | 11 | 45 | GovInfo FR HTML (5 rules, windows that do not overlap) |

Results, by type. The old extractor is documents-extract/1 plus the assistant parser.

| Type | Gold | Old P | Old R | New P | New R |
|---|---|---|---|---|---|
| case | 230 | 0.995 | 0.843 | 0.995 | 0.943 |
| docket (mention) | 102 | 1.000 | 0.873 | 1.000 | 1.000 |
| short forms | 87 | — | 0.000 | 0.966 | 0.977 |
| state_statute | 67 | 0.547 | 0.433 | 1.000 | 0.970 |
| usc | 48 | 1.000 | 0.938 | 1.000 | 1.000 |
| cfr + cfr_part | 32 | 1.000 | 0.750 | 1.000 | 1.000 |
| state_regulation | 22 | — | 0.000 | 1.000 | 0.955 |
| mdl (mention) | 15 | 0.917 | 0.733 | 1.000 | 1.000 |
| federal_rule | 12 | — | 0.000 | 1.000 | 1.000 |
| federal_register | 11 | 1.000 | 1.000 | 1.000 | 1.000 |
| public_law | 9 | 1.000 | 1.000 | 1.000 | 1.000 |
| statutes_at_large | 7 | 1.000 | 0.714 | 1.000 | 0.857 |
| constitutions, local rules | 8 | — | 0.000 | 1.000 | 1.000 |
| **all** | **648** | **0.941** | **0.644** | **0.994** | **0.971** |

Results, by stratum (new extractor):

| Stratum | P | R |
|---|---|---|
| filings | 0.990 | 0.984 |
| opinions | 1.000 | 0.943 |
| reports | 0.984 | 1.000 |
| Federal Register | 1.000 | 0.978 |

All 17 misses of the new extractor are listed in the measure report:

- 12 are 19th-century nominative reporters (`7 Harris 485`, `8 Wright 189`, `21 Pick 378`, `10 Casey 17`, `18 Id. 482`)
  or reporters written without periods (`211 Tenn 139`). This is why case recall in opinions is 0.943. Recall on
  filings and reports is at or above 0.98.
- 1 is a star page glued to a citation (`467 U.S. 638`).
- 1 is a lower-case `104 stat. 3909` (a publisher typo).
- 1 is an OCR `707 KAR l:320`.
- 1 is a run-together name, `California Business & ProfessionsCode § 17200`.
- 1 is the second item of a state statute list after `§§` (`49069 and 49073-49077`).

The errors are:

- 2 false positives: a `§ 3.5` report heading, and a citation of an opinion the filing only quotes.
- 2 short forms whose antecedent is a record document: the gold set keys them to the record, and the extractor correctly
  leaves them unlinked.

## 3. Resolution (database/contracts/citations-v2.sql)

Resolution is by exact key into `citations.authorities`. It has four states:

- `resolved`: exactly one corpus record.
- `ambiguous`: two or more records. The candidates are kept.
- `unresolved`: a range, a page that starts no document, a court that is not named, or a resolver that is not installed.
  The last case has the reason `unresolved_target_missing`.
- `not_in_corpus`: a well-formed authority that the corpus does not hold.

`reason` records why. Resolution never uses similarity.

| Key | Target |
|---|---|
| `usc:T:S` | `us_code_sections` id `T:S` (documents.links id `usc:T:S`) |
| `cfr:T:P.S` | `ecfr_sections_full` `cfr:T:P.S`, else `federal_regulations_sections` (link: the part in `federal_regulations_parts`, as in documents/1) |
| `cfr-part:T:P` | `ecfr_sections_full` `cfr:T:part-P`, else `federal_regulations_parts` `cfr:T:P` |
| `fr:V:P` | `citations.fr_index`, built from the `federal_register_history` fact "80 FR 53243 (pages 53243-53256)". The page that starts the document is used first; then the one document whose page range holds P. Two or more documents gives `ambiguous`. |
| `stat:V:P` | `public_laws_enacted` id `stat-V-P` (first page of a law; another page → `unresolved`) |
| `pl:C:L` | `citations.pl_index` (from `cells.law`) |
| `const:ST:art-N[:sec-S]` | `state_constitution_sections`. The article is compared as roman or arabic. Other provision forms → `unresolved`. |
| `const-us:*` | `not_in_corpus` (no U.S. Constitution dataset) |
| `rule:SET:N` | `court_rule_sections` with doc `us-SET` and `rule_section.number` = N |
| `local-rule:COURT:N` | `court_rule_sections` with doc `<court>-civil` or `<court>-combined`, excluding labels that mark criminal or patent rules. A district abbreviation (`ndcalciv` → cand, `dnj` → njd) is mapped by `citations.court_from_slug`. `Local Rule 7.1` with no court named becomes `local-rule:@<court of the filing>:7.1` in the link step. |
| `case:V:R:P` | `public.caselaw_resolve_v2(citation)` when installed; else `caselaw.cases.cite_keys @> caselaw.cite_key('V R P')`. One cluster → resolved (link `record` / `caselaw/<id>`); two or more → ambiguous. |
| `state-stat:ST:…` / `state-reg:ST:…` | `public.state_law_resolve_v1(state, normalized citation)` / `public.state_reg_resolve_v1(…)` when installed |
| `mdl:N` | `mdls` record N (relation `mentions`) |
| `docket:*` | `unresolved` (`docket_numbers_are_mentions`) |

**Resolvers owned by other workers (CASELAW, STAT-A, REGS).** These are called through `citations.call_resolver` only
when `to_regprocedure` finds them. Their answers are read tolerantly. An answer can be:

- a jsonb object;
- a set of rows;
- a scalar record id.

The fields read are `status`/`resolution`, `dataset`/`target_dataset`, `record_id`/`target_id`/`id`/`cluster_id`, and
`candidates`.

A resolved answer must name a record that exists in `public.corpus_records` (dataset + id) or in `caselaw.cases`. If it
does not, the authority stays `unresolved` with reason `resolver_target_not_found`. Once a resolver is deployed, run
`select public.citations_requeue_v2(null, 'unresolved_target_missing');` and then `citations_resolve_v2`.

## 4. Graph contract and RPCs

### Tables (schema `citations`)

| Table | Contents |
|---|---|
| `runs` | Ledger. One running run per kind (`batch`, `nightly`). A run left running for 3 h is closed as abandoned. |
| `page_state` | Which extractor version read each page. A page with no citations still has a row. |
| `occurrences` | One row per citation. A row is accepted only when the stored page text holds exactly `matched` at [start, end). Holds kind, form, short type and status, key, normalized form, pin, group, case name, antecedent `{page, seq}`, fields and extractor version. |
| `authorities` | key → resolution, target, candidates, documents.links id |
| `edges` | One row per (citing document, key). Holds mentions (full + linked short forms), first page and offsets, pages, pins, extractor version, and relation `cites` or `mentions` (MDL and docket numbers). |
| `fr_index`, `pl_index` | Lookup indexes for Federal Register pages and public laws |

A graph node is the resolved record (`<dataset>/<record id>`), so parallel citations of one decision are one node. An
unresolved authority's node is `key/<key>`.

### Compatibility with documents/1

- `documents.links` is not touched.
- `citations.document_links` has the same columns as `documents.links`. Its mentions are summed per edge before pages
  are collected, which fixes the defect VIZ-B's test found (see the handoff).
- `public.citations_links_v2(p_type, p_id, p_relation, p_limit)` answers in the `documents_links_v1` insights Link
  shape.

### Read RPCs

All read RPCs are service role only. Documents appear only if their text is served and `documents.is_open` is true.

| RPC | Returns |
|---|---|
| `citations_document_v2(p_document_id, p_limit)` | the document summary, pages extracted, versions, counts by kind and by resolution, unlinked short forms, and `authorities[]`: node + relation, mentions, full/short mentions, first page, pages, pins |
| `citations_cited_by_v2(p_key \| p_dataset+p_id, p_limit, p_offset)` | the authority, every key of the node, documents, mentions, `by_mdl`, `by_court`, `by_year` (`[[k, n]]`), undated, and `list[]` (document summary + mentions, first page, pins) |
| `citations_top_authorities_v2(p_mdl?, p_kind?, p_limit)` | most-cited nodes by citing documents: documents, mentions, first and last year |
| `citations_cocitations_v2(p_key \| p_mdl, p_limit, p_min, p_top)` | either the nodes cited together with a node (`documents_together`), or the top pairs among an MDL's `p_top` most-cited nodes |
| `citations_authority_v2(p_key \| p_dataset+p_id)` | everything `cited_by` returns, plus `co_cited`, `occurrences`, `first_filed` and `last_filed` |
| `citations_map_v2(p_mdl, p_kinds?, p_authorities=40, p_documents=60)` | the citation map (below) |
| `citations_status_v2()` | counts, resolver presence, recent runs, table sizes |

### Citation map (VIZ-B): exact shapes

The SQL answer of `public.citations_map_v2('2738')`:

```json
{
  "mdl": "2738",
  "kinds": null,
  "documents_total": 40,
  "documents_citing": 30,
  "truncated": true,
  "nodes": [
    {"id": "caselaw/1", "type": "authority", "node": "caselaw/1", "key": "case:550:U.S.:544", "kind": "case",
     "label": "550 U.S. 544", "resolution": "resolved", "reason": "exact_citation",
     "target": {"dataset": "caselaw", "id": "1", "title": "Bell Atlantic Corp. v. Twombly"}, "candidates": null,
     "documents": 12, "mentions": 30},
    {"id": "documents/d_0123456789abcdef01234567", "type": "document", "authorities": 2,
     "document": {"id": "d_…", "title": "…", "filed_date": "2024-03-01", "doc_type": "motion", "court_id": "njd", "mdl": "2738",
                  "source_url": "https://…", "…": "documents.summary() fields"}}
  ],
  "links": [{"source": "documents/d_0123456789abcdef01234567", "target": "caselaw/1", "mentions": 4}]
}
```

In this answer:

- `nodes` holds authority nodes first, ordered by `documents` descending, then document nodes.
- Every link's `source` is a document node and its `target` is an authority node. Both are present in `nodes`.
- `truncated` means that more authorities or documents exist than the limits returned.
- `p_kinds` filters by citation kind. MDL and docket mentions are never on the map.

The server function `getCitationMap({ mdl, kinds?, authorities?, documents? })` in
`src/lib/citations/citations.functions.ts` returns `{ available: false }` when the contract has not been applied. Otherwise
it returns `{ available: true, value: CitationMap | null }`. The types are in `src/lib/citations/graph.ts`:

```ts
type CitationMap = {
  mdl: string; kinds: AuthorityKind[] | null; documentsTotal: number; documentsCiting: number; truncated: boolean;
  authorities: (AuthorityNode & { documents: number; mentions: number })[];
  documents: (DocumentRef & { node: string; authorities: number })[];
  links: { source: string; target: string; mentions: number }[];   // only between returned nodes
};
type AuthorityNode = { node: string; key: string; kind: AuthorityKind; label: string;
  resolution: "resolved" | "ambiguous" | "unresolved" | "not_in_corpus" | "pending"; reason: string | null;
  target: { dataset: string; id: string; title: string | null; href: string | null } | null; candidates: string[] };
type DocumentRef = { id: string; title: string | null; filedDate: string | null; docType: string | null;
  courtId: string | null; mdl: string | null; sourceUrl: string | null };
```

`target.href` is the site page of the record:

| Dataset | Page |
|---|---|
| `us_code_sections` | `/law/uscode/T/S` |
| eCFR / CFR | `/law/cfr/T/S` or `/law/cfr/T/part/P` |
| case law | `/cases/<cluster>` |
| every other dataset | `/records/<dataset>/<id>` |

The other server functions in the same file are `getDocumentCitations`, `getCitedBy`, `getAuthorityProfile`,
`getTopAuthorities`, `getCoCitations` and `getCitationStatus`. They use the same `Answer<T>` wrapper.

## 5. Nightly extraction

`supabase/functions/ingest-citations` checks the ingest trigger secret with `ingest_check_trigger_v1`. It returns 202
and runs `runNightly` as a background task. Each invocation:

1. Opens a nightly run.
2. Takes byte sets that have a stored page not yet read at the current extractor version, newest first
   (`citations_pending_pages_v2`). Byte sets are always taken whole, so short forms can link across pages.
3. Extracts them with the TypeScript engine, for about 1.2 s of CPU. The edge runtime allows about 2 s per request.
   Measured speed is about 1 ms per 1,000 characters, so one invocation covers about 1.2 M characters, which is about
   45 average byte sets.
4. Loads the results, resolves the new keys, and relinks the loaded documents.
5. Closes the run as `ok`, `partial` (stopped by its budget; the next invocation continues) or `failed`.

`citations-v2-schedule.sql` posts six times, at 06:13–07:53 UTC, after documents-nightly (05:41). It also schedules
`insights.refresh_citations` at 08:17.

## 6. Insights

`database/contracts/insights-citations-v1.sql` registers the family `citations` with three metrics:

- `citations_filings_citing`: per MDL and per court, per year. n is the number of filings with searchable text.
- `citations_decisions_cited`: per MDL, snapshot.
- `citations_provisions_cited`: per MDL, snapshot.

Facts are written only for entities in the spine. The PGlite test covers this.

## 7. RUNBOOK (lead)

**Expected scale** (as of 2026-10-23): 22,034 indexed byte sets, 293,626 pages and 561.6 M characters, serving 22,107
documents with text.

The read-only sample covers 300 byte sets: 3,741 pages, 7.66 M characters, 7,901 citations (2.11 per page), and 0 offset
mismatches. Its files are in `private/build/w1025_cite/batch-sample/`. From that sample, the full run should give:

- about 620,000 occurrences (±20 %; dockets about 31 %, cases 34 % full + short, MDL mentions 8 %);
- about 210,000 edges (9.5 distinct keys per byte set);
- about 60,000–150,000 authority keys;
- about 19 minutes of Python extraction CPU (1.8 ms per 1,000 characters).

The export needs 882 GETs. The database needs roughly 300–400 MB for occurrences, edges and authorities including
indexes. The local disk needs only the cursor file.

1. Apply the contract (idempotent; PGlite-tested), in this order:
   `database/contracts/citations-v2.sql`, then `database/contracts/insights-citations-v1.sql` (after insights-v1.sql).
2. Build the lookup indexes (each call is bounded):
   - `select public.citations_build_index_v2('fr', '', 200000);`: repeat with `p_after` set to the returned `last` until
     `done` (about 6 calls, 1,011,264 FR records).
   - `select public.citations_build_index_v2('pl', '', 100000);`: one call, 51,833 laws.
3. Run the full extraction as a stream, from the repository root:
   `set -a && . private/scratch/env.sh && set +a && python3 -I -B scripts/citations_v2/run_batch.py stream --state private/build/w1025_cite/batch.cursor.json`

   This opens one `batch` run, then for each export page (25 byte sets) extracts, loads and saves the cursor. A failure
   closes the run as failed and keeps the cursor: rerun the same command to resume. A run left open is closed as
   abandoned after 3 h, or by the next `open`. When the export is finished, the command resolves (`citations_resolve_v2`
   until pending = 0) and links (`citations_link_v2` over every byte set, 500 per call), then closes the run as `ok`.
   Use `--max-sets N` for a bounded first pass.
4. Deploy the nightly function from a bundle: `node scripts/citations_v2/upload_patterns.mjs --execute` (with the
   environment of step 3) stores `src/lib/citations/patterns.json` content-addressed in private storage
   (`corpus-exports/citations/patterns/<sha256>.json`, readback-checked, never overwritten); then
   `node scripts/ingest/bundle_functions.mjs <dir>` writes `<dir>/ingest-citations` (it copies `src/lib/{citations,ingest}`
   and replaces the 330 KB `patterns.data.ts` with a loader that fetches that object at cold start and refuses bytes
   whose SHA-256 differs from `patterns.json` at bundle time, `src/lib/citations/patterns.remote.ts`). Deploy the
   bundle's files with verify_jwt off. A new pattern table needs both steps again. Then make one manual post (SQL in the
   header of `citations-v2-schedule.sql`), and apply `citations-v2-schedule.sql`.
   Deployed 2026-10-23: version 1, the six runtime files byte-identical to the bundle of that day (pattern table
   `0f06cc29…54c2`, `citations-v2/2026-10-25.3`); the formatter later wrapped one line of `patterns.remote.ts`
   (no code change), so the next deploy differs from version 1 only there.
5. Run `select insights.refresh_citations('initial');`.
6. When CASELAW, STAT-A or REGS deploy their resolvers, run
   `select public.citations_requeue_v2(null, 'unresolved_target_missing');` (or with the kind `'case'`), then
   `select public.citations_resolve_v2(5000);` until pending = 0.

**Verification SQL**

```sql
select public.citations_status_v2();                                     -- counts, resolvers, runs
select status, pages_loaded, citations_accepted, citations_rejected, rejected, error from citations.runs order by started_at desc limit 5;
select count(distinct src_id) from citations.page_state;                  -- = indexed byte sets with text (22,034)
select kind, resolution, count(*) from citations.authorities group by 1, 2 order by 1, 2;
select count(*) from citations.occurrences o tablesample system (2) join corpus_ingest.pdf_text_pages p on p.sha256 = o.src_id and p.page = o.page
 where substr(p.text, o.start_offset + 1, o.end_offset - o.start_offset) <> o.matched;   -- must be 0 (a 2 % block sample)
select public.citations_map_v2('2738', null, 40, 60) -> 'documents_citing';
```

## 8. Open risks

- **Nominative reporters.** 19th-century nominative reporters (Pennsylvania `Harris`, `Wright`, `Casey`; `Pick`) are
  not in reporters-db, and bare words are excluded to protect precision. Old state-court opinions lose some recall.
- **State statute and regulation resolution.** These stay `unresolved_target_missing` until STAT-A and REGS install
  their resolvers. The answer-reading adapter is tolerant but untested against their real functions.
- **Local rules.** Local rules in `*-combined` documents often have two texts (civil and criminal, or old and new
  versions). These resolve as `ambiguous` with candidates.
- **Case-law ambiguity.** A citation that `cite_keys` gives to several clusters stays `ambiguous`. The edge-level case
  names are stored in `occurrences.case_name`, ready for name-based disambiguation that is not applied yet.
- **CPU limit.** The nightly CPU budget relies on the edge runtime's 2 s limit. The extraction budget is configurable in
  `serveCitations({ nightly: { extractBudgetMs } })`.
- **Legacy extractors.** documents/1's extractor (`scripts/documents/citations.py`, `state_codes.py`) still writes
  `documents.extractions` for the citation kinds. Citations v2 replaces that use: once the stream has loaded, the lead
  can stop running the documents/1 citation kinds. They were not changed, so that the documents tests and the parity
  fixture keep their current meaning.
