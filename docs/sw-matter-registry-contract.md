# Seeger Weiss matter registry — data contract `sw-matter-registry/1`

Owner: `mdl-members` agent. Consumers: `ui-integration` (reads this file), `data-quality`, `pdf-backfill`, orchestrator.
Status: **v1.2 — 2026-10-03 ~12:50Z. `sw_matters_v1` (24 matters) and `sw_matter_dockets_v1` (2,489 docket-in-matter rows) are [live] and `ready=true`
for all 24 Tier-1 MDLs (3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3081, 2846, 2873, 2804, 3108, 3149, 3114, 3185, 3125, 3144, 3043, 3060, 3014, 2738, 2741, 3026);
Tier-2 and other MDLs are appended by re-running the same projection.** Every object below carries a status tag:
`[planned]` not yet in the database, `[live]` created and verified, `[held]` created but `ready=false`.
The change log at the bottom is append-only; fields are only ever *added* within `/1`.
Anything the UI must not rely on yet is tagged `[planned]`.

Integrity rules this contract enforces (AGENTS.md + docs/courtlistener-backfill-contract.md + LOOP_STATE):
no guessed or fabricated data; identity is `(source_system, entity_type, native_id)`; never fuzzy-merge people,
parties, firms or cases; `parent_docket_id` is not MDL membership; membership needs one of the evidence kinds in §4;
master/member `role` stays `unknown`/`associated_unspecified` unless a source states it; a transferor and a transferee
docket are two records of one action; sealed/restricted/unavailable stays held; unknown seal ⇒ private; unknown values
render "Not recorded".

## 0. What the UI can rely on first (quick map)

| Need | Where | Status |
|---|---|---|
| Matter list / matter page | `corpus_records` dataset `sw_matters_v1` (id `sw-matter:<mdl>`) | [live] 24 matters |
| **Explicit native case ids per provider for master / JPML / member dockets, each with its evidence basis** | `sw_matters_v1.detail.registry.case_ids` (master + JPML) and `sw_matter_dockets_v1.detail.registry.native_case_ids` (every docket) | [live] |
| Same ids as a flat call-ready list | RPC `public.corpus_sw_matter_case_ids_v1(p_mdl, p_roles, p_limit, p_offset)` (service_role only; each id carries `resolution_basis` and `pdf_lookup` — pass only ids with `pdf_lookup=true` to the PDF read API) | [live] (migration `corpus_sw_matter_case_ids_v1_resolution_basis`) · `sw_matters_v1.detail.registry.pdf_case_ids` is the flat master + JPML list with conflicting ids already removed |
| Member list with `membership_basis`, `evidence`, `route`, role | `corpus_records` dataset `sw_matter_dockets_v1` (filters below) | [live] 2,489 rows (incl. master + JPML panel rows) |
| Docket entries of masters / JPML dockets | dataset `sw_docket_entries_v1` | [planned, held until privacy decision §6] |
| Parties / counsel on the master | dataset `sw_matter_parties_v1` + counts in `sw_matters_v1.detail.registry.parties_summary` | [planned, held] |
| Existing PDF read API (do not duplicate) | `public.corpus_matter_pdf_documents_v1`, `corpus_matter_pdf_object_v1`, `corpus_pdf_availability_v1` (orchestrator migration `corpus_matter_pdf_read_v1`) | [live] |

PostgREST exposes only `public`; therefore the whole read model below is in `public.corpus_records` (+ `corpus_datasets`
metadata) and service_role-only `public` RPCs. Nothing in `corpus_ingest` is read by the app.

## 1. Provider native case id forms (exact strings)

The PDF registry (`corpus_ingest.pdf_document_assets.native_case_id`) uses these forms. The registry stores **the exact string**
each provider uses so the UI can pass them unchanged to `corpus_matter_pdf_documents_v1(p_native_case_ids text[])`.

| provider tag | `pdf_document_assets.source_system` values it feeds | native case id form | example |
|---|---|---|---|
| `courtlistener` | `courtlistener`, `courtlistener-public-locator` (same id space) | numeric CourtListener docket id as text | `65407433` |
| `docketbird` | `docketbird` | `<court>-<office>:<yyyy>-<type>-<seq5>` | `cand-4:2022-md-03047` |
| `official-court` | `official-court` | free-form string **as printed by the court page**, no court prefix | `2:23-md-3080`, `3:25md3140` |
| `jpml` (DocketBird court `jpml`) | `docketbird` | DocketBird form with court `jpml`, office `0` | `jpml-0:2026-md-03185` |

An `official-court` id is attached to a docket only with evidence: the PDF registry row's `origins` source URL host/path must
belong to the same court as the docket (recorded in `basis`). Unresolvable official-court ids stay in
`unassigned_native_case_ids` of the matter, never guessed onto a docket.

Provider-neutral key (`docket_key`) — used only to *link* provider ids, never to merge entities:

```
docket_key = "<court>:<office>:<yyyy>-<type>-<seq5>"          e.g. cand:4:2022-md-03047   (= DocketBird id with the first '-' replaced by ':')
parse(docket_number) = /^(\d{1,2}):(\d{2}|\d{4})-?([a-z]{2,4})-?(\d{1,6})(?:-[A-Za-z]{2,5})*$/i
year: 4 digits kept; 2 digits => 00-69 -> 20yy, 70-99 -> 19yy;  type lower-cased;  seq zero-padded to 5; judge-initial suffixes dropped
```

Two provider records are linked as "the same docket" only when (a) the `court` ids are equal strings **and** (b) the keys are equal
**and** (c) the CourtListener side resolves to exactly one docket id for that key (more than one ⇒ `ambiguous`, held, e.g. CL
4261857 and 18704765 both `ilnd 1:14-cv-01748`). If both sides expose a PACER case id and they differ, no link is made.
`resolution_basis` records which rule fired (`exact_docket_key`, `exact_docket_key+pacer_case_id`).

## 2. corpus_ingest model (private; versioned)

Runs, entities, entity_versions, observations and relationships follow `database/contracts/corpus-ingest-v1.sql`.
Writes go through a service_role-only wrapper `public.corpus_registry_intake_v1(p_run, p_mode, p_rows)` [planned] that is pinned
to the run's `scope.source_system`, checks `record_sha256 = canonical_integer_jsonb_sha256_v1(data)` for registry namespaces,
and calls `corpus_ingest.ingest_entities`. Provenance on **every** row: `source_url`, `retrieved_at`, `record_sha256`,
`source_sha256` (raw bytes of the captured response/document), `http_status` when HTTP, `schema_version`.

### 2.1 Namespaces

| source_system | purpose | schema_version |
|---|---|---|
| `sw-matter-registry` | derived, evidence-backed registry (this contract) | `sw-matter-registry/1` |
| `courtlistener` | raw REST observations (dockets, docket-entries, recap-documents, parties, attorneys) written by `scripts/ingest/members-cl-service.mjs` + importer | `courtlistener-rest-v4.7/1` |
| `docketbird-mcp` | raw DocketBird observations; new types `litigation_relationship_observation`, `member_case_header`, `member_docket_sheet_observation` | `docketbird-mcp-capture/1` |
| `jpml-site` | free JPML PDFs/HTML parsed for Schedule A (one `source-document` entity per file: URL, sha256, bytes, parse receipt) | `jpml-site-document/1` |

### 2.2 Registry entity types (`sw-matter-registry`)

1. **`matter`** — native_id `mdl:<number>` (e.g. `mdl:3047`). One per JPML MDL number.
   data: `mdl_number`, `caption_as_printed`, `caption_source`, `status` (`pending|terminated|unknown`) + `status_source` (JPML report id/date),
   `tier` (`tier1|tier2|other`, orchestrator list 2026-10-03), `transferee_court_id`, `date_centralized` (+source), `jpml_counts`
   `{as_of, pending, historical_total, report_url, report_sha256}`, `firm_evidence` (kinds, not a representation claim),
   `judge_strings` (source strings, never merged), `known_gaps[]`.
2. **`docket`** — native_id = `docket_key`. One per distinct docket identity that appears in any matter.
   data: `court_id`, `docket_number_as_recorded[]`, `docket_key`, `case_type`, `provider_ids[]` = `[{provider, source_system, id, resolution_basis, pacer_case_id?, url, retrieved_at}]`,
   `captions[]` (source string + provider; kept private for member dockets), `date_filed`, `date_terminated` (+ source), `status_note`,
   `judge_refs[]` = `[{role:'assigned_to'|'referred_to', cl_person_id|null, source_string, provider}]` (native person id only from the CL docket's own `assigned_to`/`referred_to` resource; strings otherwise), `held[]` (blocked/sealed flags).
3. **`matter-docket`** — native_id `mdl:<n>|<docket_key>` (the role is NOT part of the id: roles are sets stated by sources). The link "this docket is in matter M".
   data: `matter`, `docket_key`, `role` (most specific stated role by precedence master > jpml_panel > transferee > transferor > member > associated_unspecified),
   `roles_stated[]`, `route`, `membership_basis[]` (evidence kinds), `evidence_ids[]`, `first_evidence_at`, `action_id`, `counts_as_action` (see §5), `status`.
   A docket asserted for two MDLs by different sources has one link per MDL; the projection flags it `conflict` and never resolves it.
4. **`membership-evidence`** — native_id = sha256 of the canonical tuple `(evidence_kind, matter, member_key, master_key, source_url|source_sha256, locator)`.
   **One record per assertion.** data: `evidence_kind`, `label`, `claim{asserted_role, asserted_route, member_docket_key, master_docket_key}`,
   `source{system,url,document_sha256,retrieved_at,http_status?}`, `locator{page|entry_number|row_ordinal|graph_query_id}`, `quote` (≤ 240 chars exact source text or null),
   `native_ids{cl_docket_id,docketbird_case_id,fjc_idb_id,cl_entry_id}`, `qualification`.
5. **`transfer-link`** — native_id `tl:<sha256(originating_key|receiving_key)>`. Links the transferor and transferee dockets of one action; data: `originating_docket_key`, `receiving_docket_key`, `evidence_ids[]`, `transfer_date`.
6. **`entry-capture`** — native_id `<docket_key>|<provider>`; per master/JPML docket and provider: `captured`, `provider_total`, `total_source`, `complete`, `cursor_state`, `observed_at`. (Counts only; the entries themselves stay in the raw namespaces.)
7. **`party-capture`** — same shape for `parties` / `attorneys` (CL) with counts and completeness.

Relationships (`corpus_ingest.relationships`, `source_system='sw-matter-registry'`, `inferred=false` always):
`matter-docket --matter--> matter`, `matter-docket --docket--> docket`, `membership-evidence --supports--> matter-docket`,
`transfer-link --originating--> docket`, `transfer-link --receiving--> docket`, `entry-capture --docket--> docket`.
Cross-namespace references (CL docket id, DocketBird case id, CL person id) are **fields** (`provider_ids`, `judge_refs`), not edges,
so the namespace-local target-presence refresh cannot flip them. CL's own native graph (`courtlistener` namespace) still carries
`dockets --assigned_to--> people`, `docket-entries --docket--> dockets`, etc. for the new observations.

## 3. Vocabulary (closed lists)

`role` (what the *source states*): `master` · `jpml_panel` · `member` · `transferor` · `transferee` · `associated_unspecified`
(an MDL association with no stated role, e.g. FJC IDB) · `unknown`.
`route`: `transferred` (JPML schedule / transfer entry) · `pending_in_transferee_court` (listed on an order but already pending in the transferee district) · `direct_filed` (only if a source says so) · `unknown`; `multiple_sources` when different sources state different routes.
`status`: `open|terminated|unknown` from the *docket header/entry evidence*; a CL `date_terminated` on a master (e.g. 2741, 3043) is
shown as "docket header terminated" and never overrides the JPML pending status of the MDL.

## 4. Evidence kinds (`membership_basis`) — the only things that can create a membership

| kind | what it is | can assert | label shown |
|---|---|---|---|
| `docketbird_relationship` | DocketBird graph edge `CONSOLIDATED_INTO_MDL_MASTER` returned by `find_litigation_relationships` (capture + query text + response sha256 kept) | member ↔ master, route unknown | Provider-reported (DocketBird) |
| `jpml_schedule_a` | Schedule A / CTO schedule of a JPML order (PDF url + sha256 + row ordinal) | transferor docket ↔ MDL, route `transferred` | JPML order, Schedule A |
| `docket_transfer_entry` | exact docket-entry text on a master, JPML or receiving docket naming the case number (CL entry id / DocketBird document id kept) | transferor/transferee/member as the text states | Docket entry |
| `native_crosswalk` | exact uploaded crosswalk (AWS release `member_of_mdl`, catalog `mdl_master_docket_id`) | member ↔ master | Firm dataset crosswalk |
| `fjc_idb_mdl_number` | exact FJC IDB `multidistrict_litigation_docket_number` on the docket's own IDB row (source snapshot version/date kept) | `associated_unspecified` | Historical administrative (FJC IDB) |
| `master_party_case_reference` | a CourtListener `parties` record of the MASTER docket (the association's own `docket_id`) whose `party_types[].extra_info` names exactly one civil action number and no other court cue; court = master's court; one evidence row per referenced action (party ids listed, no party names) | member ↔ master, route unknown | Master docket party list (case number named) |
| `jpml_cto_schedule` | same as `jpml_schedule_a` but from a conditional-transfer-order schedule PDF ("SCHEDULE CTO-n") | transferor docket ↔ MDL, route `transferred` | JPML conditional transfer order schedule |
| `identity_resolution` | exact CL lookup by court + docket number that resolves the provider id of a docket evidenced by another kind | identity only — **never creates membership** | Identity (exact court + number) |
| `jpml_master_docket_list`, `cl_docket_header`, `docketbird_search_exact`, `docketbird_is_mdl_master` | evidence for the **master** and **jpml_panel** roles and identities (JPML master docket list; CL header whose court+number equal the master; DocketBird exact search in court `jpml`) | master / jpml_panel | as in `label` |

Negative evidence is stored too: `ORDER DENYING TRANSFER` entries create `membership-evidence` with
`claim.asserted_role='not_member'`, and the docket is **excluded** from membership counts (it stays visible with its basis `transfer_denied`).
Never inferred from caption, product, judge, firm or court similarity.

## 5. Counting units

* `sw_matter_dockets_v1` row = one docket-in-matter. A transferred action appears as **two** rows (`transferor`, `transferee`) sharing `action_id`; exactly one row per action has `counts_as_action=true` (the transferee row when its identity is evidenced, else the transferor).
* Matter counters: `members.rows` (all rows), `members.actions` (rows with `counts_as_action`), `members.by_basis{kind:n}`, `jpml.pending|historical_total` (from the Oct 1 2026 JPML report, `jpml_census_2026_10_01`). `members.actions` is **never** presented as the MDL size; JPML counts are.
* Entries: `captured` and `provider_total` always shown separately (`provider_total=null` renders "Not recorded").

## 6. Public projection (corpus_records datasets)

All datasets: `category` as listed, `state=null`, `county_geoids='{}'` (court location is not governing law), contiguous `ordinal` per dataset, filters are flat strings or arrays of strings (compatible with `corpus_query_bounded`), `item.id = id`, stable item JSON (search resolves identity by exact `item` equality).
Re-projection upserts; rows are never deleted — superseded rows get `item.cells.status='superseded'`.

### 6.1 `sw_matters_v1` [live, ready] — grain: one MDL matter
* `id`: `sw-matter:<mdl>` · `category`: `sw_matter` · `title`: caption as printed (institutional MDL caption)
* `item.cells`: `mdl_number`, `status`, `tier`, `transferee_court`, `judge_as_printed`, `jpml_pending`, `jpml_total`, `registry_members` (rows), `registry_actions`, `entries_captured`, `entries_total`, `masters` (count)
* `detail.facts` ([label, value] pairs, "Not recorded" when unknown), `detail.sections` (Masters, JPML proceeding, Judges, Members by basis, Entries coverage, Parties/counsel coverage, Known gaps)
* **`detail.registry`** (machine block the UI should read):
```json
{
  "schema": "sw-matter-registry/1",
  "mdl": "3140",
  "case_ids": [
    { "role": "master", "docket_key": "flnd:3:2025-md-03140", "court_id": "flnd", "docket_number": "3:25-md-03140",
      "native_case_ids": [
        { "provider": "courtlistener", "source_system": "courtlistener", "id": "69674950", "resolution_basis": "exact_docket_key+pacer_case_id", "pacer_case_id": "529488" },
        { "provider": "docketbird", "source_system": "docketbird", "id": "flnd-3:2025-md-03140", "resolution_basis": "exact_docket_key" },
        { "provider": "official-court", "source_system": "official-court", "id": "3:25md3140", "resolution_basis": "court_page_host+exact_docket_number" } ],
      "basis": ["jpml_master_docket_list_2026_10_01", "docketbird_is_mdl_master"], "evidence_ids": ["…"] },
    { "role": "jpml_panel", "docket_key": "jpml:0:2026-md-03140", "native_case_ids": [ { "provider": "jpml", "source_system": "docketbird", "id": "jpml-0:2026-md-03140" } ], "basis": ["…"] }
  ],
  "pdf_case_ids": ["69674950", "flnd-3:2025-md-03140", "3:25md3140"],
  "members": { "rows": 0, "actions": 0, "by_basis": {}, "list": "dataset sw_matter_dockets_v1, filters mdl=<mdl>, role=member|transferor|transferee|associated_unspecified" },
  "unassigned_native_case_ids": [],
  "judges": [ { "docket_key": "…", "role": "assigned_to", "cl_person_id": "2755", "source_string": "M. Casey Rodgers", "basis": "courtlistener docket resource assigned_to" } ],
  "entries": [ { "docket_key": "…", "provider": "courtlistener", "captured": 0, "provider_total": null, "complete": false, "observed_at": "…" } ],
  "parties_summary": { "docket_key": "…", "provider": "courtlistener", "parties_captured": 0, "attorneys_captured": 0, "complete": false },
  "tier": "tier1",
  "jpml": { "as_of": "2026-10-01", "pending": 6412, "historical_total": 6524, "report_url": "https://www.jpml.uscourts.gov/…" },
  "jpml_orders": [ { "doc_type": "transfer_order", "doc_date": "2024-…", "rows": 28, "url": "https://www.govinfo.gov/…", "document_sha256": "…", "alt_copies": [] } ],
  "docketbird_graph": [ { "retrieved_at": "2026-10-03T12:40:47Z", "master_case_id": "njd-2:2024-md-03113", "returned": 0, "total_members": 0, "truncated": false } ],
  "gaps": ["…"],
  "provenance": { "run_ids": ["…"], "projection_schema": "sw-matter-registry-view/1", "projected_at": "…" }
}
```
`pdf_case_ids` is the flat de-duplicated list for master+JPML dockets, ready to pass to `corpus_matter_pdf_documents_v1`.
* `filters`: `mdl`, `tier`, `status`, `court_id`, `year_centralized`, `has_members`, `_listing:'true'`, `native_id`.

### 6.2 `sw_matter_dockets_v1` [live, ready] — grain: one docket-in-matter
* `id`: `sw-md:<mdl>:<docket_key>` (role is a field, not part of the id) · `category`: `sw_matter_docket` · `source_url`: CL docket page if a CL id exists, else DocketBird canonical URL, else the evidence document URL
* `title`: `<docket_number> (<court_id>) — <role label>`; party/individual captions are **not** projected (member captions withheld; institutional captions allowed on master/JPML rows).
  A caption is *institutional* only if it has no "X v. Y" party form and either starts "In re" or names the litigation itself; a master docket whose own CourtListener caption is person-v-company (the lead case that became the master, e.g. MDL 3026 `1:22-cv-00071`) shows no caption and `caption_withheld=true`; every master row additionally carries the fact `MDL caption (JPML report)`.
* `item.cells`: `mdl`, `role`, `route`, `docket_number`, `court_id`, `filed`, `terminated`, `status`, `basis` (comma list), `evidence_count`, `action_id`, `counts_as_action`
* `detail.registry`:
```json
{ "docket_key": "cand:4:2022-cv-00401", "native_case_ids": [ { "provider": "courtlistener", "source_system": "courtlistener", "id": "62613213", "resolution_basis": "…" } ],
  "role": "member", "route": "transferred", "membership_basis": ["docketbird_relationship", "jpml_schedule_a"],
  "evidence": [ { "kind": "jpml_schedule_a", "label": "JPML order, Schedule A", "source_url": "…", "source_sha256": "…", "locator": { "page": 3, "row": 14 }, "quote": null, "retrieved_at": "…" } ],
  "action_id": "act:…", "counts_as_action": true, "linked_dockets": [ { "docket_key": "…", "role": "transferee" } ],
  "judges": [ ], "caption_withheld": true, "held": [ ] }
```
* `filters`: `mdl`, `role`, `route`, `basis` (array), `court_id`, `year`, `status`, `counts_as_action`, `tier`, `native_case_id` (array: every provider id string — lets the UI find a row from a PDF row's `native_case_id`), `_listing`, `native_id`.
* Listing columns: docket number, court, role, route, basis, filed, evidence count.
* Also upserts **`public.corpus_workspace_docket_links`** rows (`source_dataset='sw_matter_dockets_v1'`, `source_record_id=<id>`, `mdl`, `cl_docket_id`, `court_id`, `docket_number`, `event_date`=filed, `date_basis='case_filed_date'`, `evidence_url`, `linkage_basis` = the basis list text) for rows that have a CL id.

### 6.3 `sw_docket_entries_v1` [planned, **held**] — grain: one entry on a master/JPML docket from one provider
`id`: `sw-entry:<provider>:<native entry id>`; cells: `mdl`, `docket_key`, `provider`, `entry_number`, `date_filed`, `description` (≤ 500 chars, only if projectable), `documents` (count), `documents_unsealed_explicit`, `availability` (`source_available|source_unavailable|unknown`, never inferred), `native_entry_id`. Privacy rule proposed: description projected unless the docket is blocked, any attached document has `is_sealed=true`, or the text matches /seal|restricted|in camera|ex parte|redact/i. **Held (`ready=false`) pending orchestrator decision** because `cl_master_entries` withholds descriptions.

### 6.4 `sw_matter_parties_v1` [planned, **held**] — grain: party-on-docket, master dockets only
Institutional parties by name; natural-person/unclassified parties → `name_withheld=true` (counts only); counsel = attorney name + firm + role (professional identity; no contact fields). Source: CL `parties`/`attorneys` with the per-association native docket (never the query docket).

### 6.5 RPCs (service_role only; `SECURITY DEFINER`, `search_path=''`) [live]
`public.corpus_sw_matter_case_ids_v1(p_mdl text, p_roles text[] default null, p_limit int default 500, p_offset int default 0) → jsonb`
`{ matter, total, rows:[{role, docket_key, court_id, docket_number, route, basis[], evidence_count, native_case_ids:[{provider, source_system, id, resolution_basis, pdf_lookup}]}] }` — reads `sw_matter_dockets_v1` only when its dataset is `ready`. `pdf_lookup=false` marks an id whose own provider header conflicts with the master identity (`resolution_basis` contains `header_conflicts`, e.g. MDL 3014 CourtListener 63571952): shown for transparency, not to be passed to `corpus_matter_pdf_documents_v1` as the matter's PDFs. SQL: `database/contracts/corpus-sw-matter-case-ids-v1.sql`.
Revoked from `public, anon, authenticated`; granted to `service_role`.

### 6.6 Query recipes (PostgREST via the server key)
```
matter page      GET corpus_records?select=id,title,item,detail&dataset=eq.sw_matters_v1&id=eq.sw-matter:3140
matter list      POST rpc/corpus_query_bounded {p_dataset:'sw_matters_v1', p_filters:{tier:'tier1'}, p_limit:50}
members (page)   POST rpc/corpus_query_bounded {p_dataset:'sw_matter_dockets_v1', p_filters:{mdl:'3140', role:'transferee'}, p_limit:50, p_offset:0}
by evidence      … p_filters:{mdl:'3140', basis:'jpml_schedule_a'}
from a PDF row   GET corpus_records?select=id,item&dataset=eq.sw_matter_dockets_v1&filters->native_case_id=cs.%5B%22cand-4%3A2022-md-03047%22%5D
exact ids        POST rpc/corpus_sw_matter_case_ids_v1 {p_mdl:'3140', p_roles:['master','jpml_panel']}  →  pass native_case_ids[].id to rpc/corpus_matter_pdf_documents_v1
```

## 7. Where the data comes from, what is partial (read before trusting counts)

* CourtListener REST is quota-limited. **Observed 2026-10-03: the Usage API reports 25/min, 300/hour, 1,400/day** (the Oct 2 run verified 50/600/2,800). The service honours the lower, live values and the persisted rolling ledger. `page_size=100` is **not honoured** by `docket-entries` (1 request tested on docket 67678440: 20 rows returned).
* DocketBird `get_docket_sheet` returns at most ~1,000 entries per sort order (recent + chronological views); middle gaps are possible beyond ~2,000 entries and are recorded in `entry-capture.complete=false`.
* DocketBird graph totals (`total_members`) are provider-indexed and far below JPML counts for new MDLs (e.g. 3047: 20 vs JPML 3,824 pending). They are evidence, not a census.
* JPML posts only some orders as free PDFs (hearing-session transfer orders, some tag-along transfer/vacate/deny orders). CTO schedules are otherwise on PACER; the registry therefore records CTO *docket entries* as `docket_transfer_entry` and parses a CTO schedule only when the PDF is freely available (JPML site, or a RECAP document the PDF backfill already stored).
* FJC IDB associations are historical administrative (tape years ≤ 2021 plus 2099 pending markers) and never a current census.

## 8. Change log (append-only)

* 2026-10-03 11:00Z — v1.0 written (all objects planned). Native-case-id forms and `docket_key` rule fixed. CL limits observed: 25/min, 300/h, 1,400/day; `page_size` ignored.
* 2026-10-03 12:00Z — v1.1: `sw_matters_v1` (6 rows) and `sw_matter_dockets_v1` (1,119 rows) are live and `ready=true` for MDL 3047, 3140, 3094, 3163, 3180, 3166.
  Changes vs v1.0 (all additive/clarifying): matter-docket id has no role suffix; docket-in-matter record id is `sw-md:<mdl>:<docket_key>`; new route `pending_in_transferee_court`;
  new evidence kinds `master_party_case_reference`, `jpml_cto_schedule` and the master-identity kinds; `conflict` filter (docket asserted for two MDLs, e.g. five E.D. Pa. 2026 dockets asserted for 3163 by DocketBird/JPML and for 3094 by the firm crosswalk);
  `candidate_identity_links` in `detail.registry` (same court/year/type/seq, different office digit — e.g. JPML "3:22-00401" vs CourtListener "4:22-cv-00401" in N.D. Cal.; never merged).
  Verification SQL: `database/contracts/sw-matter-registry-verify-v1.sql` (registry vs projection: 0 mismatches; 0 caption leaks; 0 inferred/unresolved edges).
  Write paths added (service_role only): `public.corpus_registry_intake_v1`, `public.corpus_registry_relationships_v1`. `corpus_workspace_docket_links` rows are inserted only with `source_dataset='sw_matter_dockets_v1'`.
* 2026-10-03 13:00Z — v1.2: all 24 Tier-1 MDLs are live (`sw_matters_v1` 24 rows; `sw_matter_dockets_v1` 2,600 rows incl. master and JPML-panel rows; 588 workspace links; both datasets `ready=true`).
  Changes vs v1.1 (all additive/clarifying, still `/1`):
  * **Institutional caption rule**: a caption is institutional only if it has no "X v. Y" party form and either starts "In re" or names the litigation. A master docket whose own CourtListener caption is person-v-company (the lead case that became the master) shows no caption (`caption_withheld=true`); every master row carries the fact `MDL caption (JPML report)`. Verification SQL §4 asserts 0 "X v. Y" forms in projected rows.
  * `detail.registry.docketbird_graph[]` on matters: one entry per DocketBird member-graph query (`returned`, `total_members`, `truncated`, `retrieved_at`, `master_case_id`); a zero or short answer is a coverage fact about DocketBird's index, never evidence of absence. Also written as a known-gap line.
  * `jpml_panel` rows: DocketBird search in court `jpml` (`jpml-<office>:<year>-md-<MDL number>`); more than one hit is kept as separate panel identities (MDL 2804: `jpml-0:2017-md-02804` and `jpml-1:2017-md-02804`); same-sequence `cv` cases in court `jpml` are excluded. Not found for 3081, 3125, 3180 (gap line).
  * **Ambiguous master identities**: several CourtListener dockets with one court+docket number are all kept with `resolution_basis=ambiguous_same_docket_key_multiple_courtlistener_dockets` (MDL 2804: 6240169 [entries captured first], 61465334, 62647370). A CourtListener docket with the master's number but a different PACER case id and a party-v-party caption is **not** attached by header; if the firm crosswalk names it the master (MDL 3014: 63571952), it is listed only as `firm_crosswalk_only_courtlistener_header_conflicts`, carries a `held` note, and is excluded from `pdf_case_ids`. Conflicts are recorded, not resolved.
  * `pdf_case_ids` never contains an id whose `resolution_basis` ends in `header_conflicts`.
  * Evidence hygiene: evidence entities no matter-docket references any more are set `review_status='quarantined'` (reversible, never deleted); detection SQL in the verify file §5.
  * New SQL: `native-live-api-relationships-v4-members.sql` (incremental "versions without edges" form + refresh of `target_present`), verify file §4–§6.
  Coverage facts at this version: JPML initial orders parsed for all 24 (GovInfo `USCOURTS-jpml`, sha256 kept per copy); CTO schedules parsed for 3047, 3094, 2804, 2873; CourtListener entries complete for 3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3108, 3149, 3114, 3185, 3125, 3144, 2846 and partial (cursor kept) for 2804, 2873, 3081, 3026; not yet collected for 3060, 3043, 3014, 2741; 2738 (CL 6245245) is `blocked=true` at the source and gets no relations.
* 2026-10-03 13:05Z — v1.2 (addendum): RPC `public.corpus_sw_matter_case_ids_v1` is [live] (service_role only, `SECURITY DEFINER`, `search_path=''`); migration `corpus_sw_matter_case_ids_v1_resolution_basis` adds `resolution_basis` and `pdf_lookup` per native case id (smoke-tested through PostgREST for MDL 3014, 2804, 3080 and an unknown MDL).
* 2026-10-03 13:10Z — v1.2 (addendum): re-projection no longer flips an already-ready dataset to `ready=false` while it runs (earlier re-projections had a few-minute not-ready window; the app saw no matters then). After every projection the script reads both datasets back through PostgREST and stores `metadata.projection_validation = {records, verified, validated_at, full_fields_sha256, method}` (canonical-JSON sha256 over id, title, item, detail, filters, ordinal; current: 24 matters and 2,600 dockets, verified=true). `ready` is only set by the script when both read-backs match.
