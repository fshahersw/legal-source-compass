# Seeger Weiss matter registry — data contract `sw-matter-registry/1`

Owner: `mdl-members` agent. Consumers: `ui-integration` (reads this file), `data-quality`, `pdf-backfill`, orchestrator.
Status: **v1.3 — 2026-10-03 ~16:00Z. Four datasets are [live] and `ready=true` for the 24 Tier-1 MDLs (3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3081, 2846, 2873, 2804, 3108, 3149, 3114, 3185, 3125, 3144, 3043, 3060, 3014, 2738, 2741, 3026):
`sw_matters_v1` (matters), `sw_matter_dockets_v1` (docket-in-matter, now with captions), `sw_docket_entries_v1` (docket entries of master dockets, descriptions shown) and
`sw_matter_parties_v1` (parties of master dockets with counsel name + firm + role). Owner decision 2026-10-03 "show as published": entry descriptions, member-case captions and party
names are shown exactly as the court record shows them, EXCLUDING anything sealed, restricted, in camera, ex parte or redacted (§6.0); counsel is name + firm + role only, no contact fields.
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
| Member list with `membership_basis`, `evidence`, `route`, role | `corpus_records` dataset `sw_matter_dockets_v1` (filters below) | [live] 2,617 rows (incl. master + JPML panel rows), 1,674 with a published caption |
| Docket entries (timeline) of master dockets | dataset `sw_docket_entries_v1` (§6.3), filter `mdl`, order = `ordinal` (chronological) | [live] 36,680 rows (36,659 CourtListener + 21 external for blocked MDL 2738); collection is quota-bound; coverage per matter in `sw_matters_v1.item.cells.entries_published` vs `entries_total` |
| Parties and counsel (name, firm, role) of master dockets | dataset `sw_matter_parties_v1` (§6.4), filter `mdl`; coverage in `sw_matters_v1.detail.registry.parties_summary` and `item.cells.parties_published` | [live] 4,670 rows / 15,289 counsel links; partial per matter (quota-bound; 1,375 counsel links wait for their attorney record) |
| Member-case captions | `sw_matter_dockets_v1.item.cells.caption`, row `title` = `<caption> — <docket_number> (<court>)` (§6.2) | [live] where a source prints one |
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

### 6.0 Publication rules ("show as published", owner decision 2026-10-03)

Published exactly as the court record (or the cited source) shows it — whitespace collapsed only: **docket-entry descriptions** (clipped to 500 characters, `description_chars` keeps the original length), **member-case captions**, **party names and the party `extra_info` note**, **counsel name + firm + role**.
Never published:
1. **Exclusion text** — a value (entry description, document description, caption, party name or note) whose text matches `/seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact/i` is withheld (`description_withheld='sealed_or_restricted_text'`, caption not shown, `name_withheld=true`). The pattern is deliberately broad: it also catches "unsealed", "motion to seal", "Sealed Air" — false positives are withheld, never published, and counted (`sw_matters_v1.item.cells.entries_withheld`).
2. **Sealed documents** — an entry with any recap document flagged `is_sealed=true` is shown without description and without its document list (`description_withheld='sealed_document'`, `documents_sealed>0`).
3. **Blocked dockets** — a CourtListener docket with `blocked=true` at the source is not projected at all (no entries, parties, attorneys): today 6245245 (MDL 2738), 14916674 (2885), 16684846 (2921), 6239202 (2800). A member docket whose lake header is blocked gets no caption and no CourtListener id.
4. **Sealed counsel** — attorney role 3 ("Attorney in sealed group") is omitted and counted (`counsel_sealed_omitted`).
5. **Contact fields** — attorney address block, phone, fax and email are never published (the lake read returns only the first two lines of the attorney block, from which the **firm** is taken: line 1, or line 2 when line 1 is the attorney's own name; a line that looks like an address or contact label gives `firm=null`). A party name or note containing an email or phone pattern is withheld.
Attorney role codes (CourtListener `people_db.models.Role`): 1 Attorney to be noticed · 2 Lead attorney · 3 Attorney in sealed group · 4 Pro hac vice · 5 Self-terminated · 6 Terminated · 7 Suspended · 8 Inactive · 9 Disbarred · 10 Unknown.
Nothing is inferred: a missing attorney record gives `name=null, note='attorney record not collected yet'`; a caption comes only from a source that prints one.

### 6.1 `sw_matters_v1` [live, ready] — grain: one MDL matter
* `id`: `sw-matter:<mdl>` · `category`: `sw_matter` · `title`: caption as printed (institutional MDL caption)
* `item.cells`: `mdl_number`, `status`, `tier`, `transferee_court`, `judge_as_printed`, `jpml_pending`, `jpml_total`, `registry_members` (rows), `registry_actions`, `entries_captured`, `entries_total` (CourtListener scope: captured vs provider total), `entries_published` / `entries_withheld` (rows of `sw_docket_entries_v1` for the matter / of those without description), `parties_published` (rows of `sw_matter_parties_v1`), `counsel_links` (counsel entries on those rows), `masters` (count); the `*_published`/`*_withheld`/`counsel_links` cells are `null` until the entries/parties projection has run for the matter
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
* `title` (v1.3): `<caption> — <docket_number> (<court_id>)` when a publishable caption exists, else `<docket_number> (<court_id>) — <role label>`. The caption is the first publishable one in this source order: CourtListener docket header (`courtlistener_header`: master dockets, and member dockets whose CourtListener id is known or resolved by exact court + docket key from headers already in the lake) → DocketBird case title (`docketbird`, `docketbird_jpml` for the JPML panel docket) → the JPML order schedule as printed (`jpml_schedule`, printed in capitals). Captions matching the §6.0 exclusion text are skipped. **JPML schedule captions are text extracted from PDF tables** (a wrapped row can mix in the neighbouring row, and a font-encoded "Opposed" marker shows up as `2SSRVHG`): one is published only when it is a single well-formed caption (no garbled marker, one "X v. Y", does not start or end mid-phrase, ≤ 170 characters, no docket number inside); otherwise it is **withheld, never repaired** (`caption_unreliable_count` in `detail.registry`; fact `Caption: Not shown: the JPML schedule text for this row could not be read reliably`). At v1.3: 719 of 722 Schedule A captions and 504 of 672 CTO-table captions pass. Every master row additionally carries the fact `MDL caption (JPML report)`.
* `item.cells`: `mdl`, `role`, `route`, `docket_number`, `court_id`, `caption` (string|null), `caption_source` (`courtlistener_header|docketbird|docketbird_jpml|jpml_schedule|null`), `filed`, `terminated`, `status`, `basis` (comma list), `evidence_count`, `action_id`, `counts_as_action`
* `detail.registry`:
```json
{ "docket_key": "cand:4:2022-cv-00401", "native_case_ids": [ { "provider": "courtlistener", "source_system": "courtlistener", "id": "62613213", "resolution_basis": "…" } ],
  "role": "member", "route": "transferred", "membership_basis": ["docketbird_relationship", "jpml_schedule_a"],
  "evidence": [ { "kind": "jpml_schedule_a", "label": "JPML order, Schedule A", "source_url": "…", "source_sha256": "…", "locator": { "page": 3, "row": 14 }, "quote": null, "retrieved_at": "…" } ],
  "action_id": "act:…", "counts_as_action": true, "linked_dockets": [ { "docket_key": "…", "role": "transferee" } ],
  "judges": [ ], "caption": "SMITH v. ACME CORP", "captions": [ { "value": "SMITH v. ACME CORP", "source": "jpml_schedule" } ], "caption_withheld": false, "caption_excluded_count": 0, "held": [ ] }
```
  (`caption_withheld=true` means no publishable caption exists: none printed by any source, or every printed one matched the exclusion text — then `caption_excluded_count>0`.)
* `filters`: `mdl`, `role`, `route`, `basis` (array), `court_id`, `year`, `status`, `counts_as_action`, `tier`, `native_case_id` (array: every provider id string — lets the UI find a row from a PDF row's `native_case_id`), `conflict`, `has_caption` (`'true'|'false'`), `_listing`, `native_id`. Searching `p_q` also matches the caption words.
* Listing columns: docket number, court, role, route, basis, filed, evidence count.
* Also upserts **`public.corpus_workspace_docket_links`** rows (`source_dataset='sw_matter_dockets_v1'`, `source_record_id=<id>`, `mdl`, `cl_docket_id`, `court_id`, `docket_number`, `event_date`=filed, `date_basis='case_filed_date'`, `evidence_url`, `linkage_basis` = the basis list text) for rows that have a CL id.

### 6.3 `sw_docket_entries_v1` [live, ready] — grain: one CourtListener docket entry of a registry master docket
Source: `corpus_ingest.entities` (`courtlistener`, `docket-entries`) of the master's CourtListener docket ids (exact-join ids only, never a `*header_conflicts*` id, never a blocked docket), read through `public.corpus_sw_registry_read_v1` (service_role). Coverage per docket is whatever the quota-bound collection has captured (`sw_matters_v1.item.cells.entries_captured` vs `entries_total`).
* `id`: `sw-entry:courtlistener:<native entry id>` · `category`: `sw_docket_entry` · `state` null · `county_geoids` `{}`
* `title`: `Entry <n> — <description, first 110 characters>` (`Unnumbered entry — …` when the entry has no number; `Entry <n> — description withheld` when withheld) · `source_url`: the CourtListener document/entry page of the first document (none when a document is sealed), else the docket page
* `ordinal` (gapped, stable when more entries are collected; **not** contiguous): `mdl × 10^12 + daysSince1970(date_filed) × 10^6 + min(entry_number, 99999) × 10` (undated entries use day 99999); `corpus_query_bounded` orders by `(ordinal, id)`, so a filter on `mdl` or `docket_key` returns the timeline in filing order.
* `item.cells`: `mdl`, `docket_key`, `docket_number`, `court_id`, `provider` (`courtlistener`), `native_entry_id`, `native_docket_id`, `entry_number` (int|null), `date_filed` (`YYYY-MM-DD`|null), `time_filed` (`HH:MM:SS`|null), **`description`** (string ≤ 500 characters | null), `description_chars` (length before clipping), `description_truncated` (bool; clipped text ends with `…`), **`description_withheld`** (`null|'sealed_document'|'sealed_or_restricted_text'`), `documents` (int), `documents_available` (is_available=true and not sealed), `documents_sealed` (is_sealed=true), `availability` (`no_documents|recap_available|recap_partly_available|recap_unavailable|unknown|includes_sealed`, and `official_pdf|provider_pdf` for external entries; RECAP = CourtListener's archive of PACER documents, **not** the firm's PDF store), `document_ids` (string[]: exact provider document ids — CourtListener RECAP document ids, or the PDF URL for an external entry; only documents that are not sealed; `[]` for a held entry — this is the join key to the PDF read API), `held` (bool, `true` when `description_withheld` is set: no text and no `document_ids`), `source_url` (the same link as the row's `source_url`)
* `item.badges`: `Docket entry`, one of `Free PDF in RECAP|Some PDFs in RECAP|Metadata only` (when there are documents), `Description withheld`; `item.links`: CourtListener entry · `#record/sw_matter_dockets_v1/<enc id>` (master docket) · `#record/sw_matters_v1/<enc id>` (matter)
* `detail.facts` ([label, value]), `detail.sections[0]` = `Documents` table (`Number, Attachment, Description, Pages, PDF in RECAP, CourtListener document id`; absent for `sealed_document`), `detail.registry`:
```json
{ "schema": "sw-matter-registry/1", "mdl": "3047", "docket_key": "cand:4:2022-md-03047",
  "native_case_ids": [ { "provider": "courtlistener", "source_system": "courtlistener", "id": "65407433" } ],
  "entry": { "provider": "courtlistener", "native_entry_id": "…", "entry_number": 8664, "date_filed": "2026-05-29", "time_filed": "13:27:49", "recap_sequence_number": "2026-05-29.024", "pacer_sequence_number": 40633 },
  "description_withheld": null,
  "documents": [ { "native_document_id": "480906135", "document_number": "8664", "attachment_number": null, "description": "Notice (Other)", "description_withheld": null, "page_count": null, "is_available": false, "is_sealed": null } ] }
```
  `detail.provenance` = `{source_system:'courtlistener', source_entity_type:'docket-entries', source_native_id, source_record_sha256 (lake payload hash), retrieved_at, run_ids, projection_schema, projection_row_sha256}`. A document's PDF is read through the PDF read API by `native_document_id` (`corpus_matter_pdf_documents_v1`), never through this dataset.
* `filters` (all single strings): `_listing`, `native_id`, `mdl`, `docket_key`, `native_docket_id`, `provider`, `year` (`''` when undated), `availability`, `has_documents` (`'true'|'false'`), `description_withheld` (`'true'|'false'`). `text` = description + entry number + docket number + date, so `p_q` searches descriptions.
* Listing columns: Entry, Filed, Description, Documents, PDF in RECAP, Docket · select filters: `mdl`, `year`, `availability`.
* Query: `POST rpc/corpus_query_bounded {p_dataset:'sw_docket_entries_v1', p_filters:{mdl:'3047'}, p_q:'', p_limit:100, p_offset:0}` (timeline); add `p_filters.description_withheld:'false'` to hide withheld rows.
* **External entries** (v1.3): for a master docket that CourtListener blocks at the source (MDL 2738, CL 6245245) the dataset holds the entries of the routes that remain, stored privately as registry `external-entry` entities (source_system `sw-matter-registry`; `database/contracts/corpus-registry-intake-v1.sql` mode `sw-registry`, written by `scripts/ingest/members-ingest-external.mjs`) and projected with the same shape: `provider` = `govinfo` (GovInfo USCOURTS package MODS: the court's published opinions; the granule subtitle is the docket text; `entry_number=null`) · `official-court` (the court's own MDL page: Orders list with date and description, minutes) · `docketbird` (DocketBird docket-sheet rows; none yet). Id `sw-entry:<provider>:<native id>` (official-court uses the first 16 hex of the sha256 of the PDF URL); `native_docket_id` is `null`/`''`; `availability` is `official_pdf` (free PDF on govinfo.gov or the court site; `item.links` carries it) or `no_documents`; `title` starts `Docket text —` when the source prints no entry number; `item.subtitle` names the source. `detail.provenance.source_system='sw-matter-registry'`, `source_entity_type='external-entry'`. The list is **partial by construction** (it holds what the source publishes, not the whole docket; for 2738 DocketBird indexes ≥ 45,883 entries, see §7) and its `qualification` text says so. No account ids or signed links are ever stored (DocketBird `user_id` is stripped; signed S3 links are not kept). Verification SQL §13–§14. Currently 21 rows: 13 GovInfo, 8 court page.

### 6.4 `sw_matter_parties_v1` [live, ready] — grain: one party on a registry master docket, with its counsel
Source: `corpus_ingest.entities` (`courtlistener`, `parties`, association `party_types[].docket_id` = the master's CourtListener docket id; the party's `attorneys[]` associations on that docket) plus `attorneys` by id (name and first two lines of the block only). One row per (party, docket); a party with several party types on the docket is one row.
* `id`: `sw-party:courtlistener:<cl docket id>:<party id>` · `category`: `sw_matter_party` · `ordinal` = `mdl × 10^9 + party id` (gapped, stable)
* `title`: `<party name> — <party types joined by " / ">` (`Name withheld — …` when withheld) · `source_url`: CourtListener docket page
* `item.cells`: `mdl`, `docket_key`, `docket_number`, `court_id`, `provider`, `native_party_id`, `native_docket_id`, `party_name` (string|null), `party_types` (string), `extra_info` (string|null — the court-record note, e.g. a related case number or "TERMINATED: …"), `date_terminated` (date|null), `name_withheld` (bool), `counsel_count`, `lead_counsel_count`, `counsel_sealed_omitted`, `kind` (always `'party'` at v1.3; reserved so attorney-level rows can be added without a new dataset), `name` (same value as `party_name`)
* `detail.registry`:
```json
{ "schema": "sw-matter-registry/1", "mdl": "3166", "docket_key": "cand:3:2025-md-03166",
  "native_case_ids": [ { "provider": "courtlistener", "source_system": "courtlistener", "id": "72030009" } ],
  "party": { "provider": "courtlistener", "native_party_id": "16877530", "name": "Jane Doe", "name_withheld": false, "party_types": ["Plaintiff"], "extra_info": "3:26-cv-03513-JD TERMINATED: 07/30/2026", "date_terminated": "2026-07-30" },
  "counsel": [ { "native_attorney_id": "10966830", "name": "Aaron Freedman", "firm": "Weitz & Luxenberg, P.C.", "roles": ["Attorney to be noticed", "Lead attorney"], "role_codes": [1, 2], "terminated": false } ],
  "counsel_sealed_omitted": 0, "counsel_unresolved": 0 }
```
  A counsel entry whose attorney record is not collected yet has `name:null, firm:null, note:'attorney record not collected yet'`. `terminated=true` when role 5 or 6 is present. `detail.sections[0]` = `Counsel` table (`Name, Firm, Role`).
* `filters`: `_listing`, `native_id`, `mdl`, `docket_key`, `native_docket_id`, `provider`, `kind` (`'party'`), `party_type` (array of strings), `has_counsel`, `name_withheld` (`'true'|'false'`), `counsel_native_id` (array of CourtListener attorney ids — find the parties an attorney appears for), `counsel_firm` (array of firm strings as printed). `text` = party name, types, note, counsel names and firms (search).
* Listing columns: Party, Type, Counsel, Docket, MDL · select filters: `mdl`, `party_type`, `has_counsel`. Query: `POST rpc/corpus_query_bounded {p_dataset:'sw_matter_parties_v1', p_filters:{mdl:'3047', party_type:'Plaintiff'}, p_limit:50}`.

### 6.5 RPCs (service_role only; `SECURITY DEFINER`, `search_path=''`) [live]
`public.corpus_sw_matter_case_ids_v1(p_mdl text, p_roles text[] default null, p_limit int default 500, p_offset int default 0) → jsonb`
`{ matter, total, rows:[{role, docket_key, court_id, docket_number, route, basis[], evidence_count, native_case_ids:[{provider, source_system, id, resolution_basis, pdf_lookup}]}] }` — reads `sw_matter_dockets_v1` only when its dataset is `ready`. `pdf_lookup=false` marks an id whose own provider header conflicts with the master identity (`resolution_basis` contains `header_conflicts`, e.g. MDL 3014 CourtListener 63571952): shown for transparency, not to be passed to `corpus_matter_pdf_documents_v1` as the matter's PDFs. SQL: `database/contracts/corpus-sw-matter-case-ids-v1.sql`.
Revoked from `public, anon, authenticated`; granted to `service_role`.
Projection internals (same security posture, **not for the app**): `public.corpus_sw_registry_read_v1(p_kind, p_docket_ids, p_ids, p_after, p_limit)` pages the lake's docket entries / parties / attorney names (`database/contracts/corpus-sw-registry-read-v1.sql`); `public.corpus_sw_docket_headers_v1(p_mode 'by-id'|'by-key', p_ids)` reads CourtListener docket headers already in the lake (`corpus-sw-docket-headers-v1.sql`).

### 6.6 Query recipes (PostgREST via the server key)
```
matter page      GET corpus_records?select=id,title,item,detail&dataset=eq.sw_matters_v1&id=eq.sw-matter:3140
matter list      POST rpc/corpus_query_bounded {p_dataset:'sw_matters_v1', p_filters:{tier:'tier1'}, p_limit:50}
members (page)   POST rpc/corpus_query_bounded {p_dataset:'sw_matter_dockets_v1', p_filters:{mdl:'3140', role:'transferee'}, p_limit:50, p_offset:0}
by evidence      … p_filters:{mdl:'3140', basis:'jpml_schedule_a'}
from a PDF row   GET corpus_records?select=id,item&dataset=eq.sw_matter_dockets_v1&filters->native_case_id=cs.%5B%22cand-4%3A2022-md-03047%22%5D
exact ids        POST rpc/corpus_sw_matter_case_ids_v1 {p_mdl:'3140', p_roles:['master','jpml_panel']}  →  pass native_case_ids[].id to rpc/corpus_matter_pdf_documents_v1
entries timeline POST rpc/corpus_query_bounded {p_dataset:'sw_docket_entries_v1', p_filters:{mdl:'3047'}, p_limit:100, p_offset:0}        (order = filing order)
entry search     … {p_dataset:'sw_docket_entries_v1', p_filters:{mdl:'3047'}, p_q:'motion to dismiss', p_limit:50}
parties tab      POST rpc/corpus_query_bounded {p_dataset:'sw_matter_parties_v1', p_filters:{mdl:'3047', party_type:'Defendant'}, p_limit:50}
by counsel       … {p_dataset:'sw_matter_parties_v1', p_filters:{counsel_native_id:'10966821'}}        (CourtListener attorney id)
caption search   … {p_dataset:'sw_matter_dockets_v1', p_filters:{mdl:'3047'}, p_q:'school district'}
```

## 7. Where the data comes from, what is partial (read before trusting counts)

* CourtListener REST is quota-limited. **Observed 2026-10-03: the Usage API reports 25/min, 300/hour, 1,400/day** (the Oct 2 run verified 50/600/2,800). The service honours the lower, live values and the persisted rolling ledger. `page_size=100` is **not honoured** by `docket-entries` (1 request tested on docket 67678440: 20 rows returned).
* DocketBird `get_docket_sheet` returns at most ~1,000 entries per sort order (recent + chronological views); middle gaps are possible beyond ~2,000 entries and are recorded in `entry-capture.complete=false`.
* DocketBird graph totals (`total_members`) are provider-indexed and far below JPML counts for new MDLs (e.g. 3047: 20 vs JPML 3,824 pending). They are evidence, not a census.
* JPML posts only some orders as free PDFs (hearing-session transfer orders, some tag-along transfer/vacate/deny orders). CTO schedules are otherwise on PACER; the registry therefore records CTO *docket entries* as `docket_transfer_entry` and parses a CTO schedule only when the PDF is freely available (JPML site, or a RECAP document the PDF backfill already stored).
* FJC IDB associations are historical administrative (tape years ≤ 2021 plus 2099 pending markers) and never a current census.
* **The CourtListener daily limit (1,400 requests per rolling 24 h) is the binding constraint for entries, parties and attorneys.** The service keeps a 10 % reserve (270 per hour), so a docket with thousands of entries takes days: `entries_published` < `entries_total` is normal, not an error. Order of collection: counts → Tier-1 small dockets → party/attorney scopes (10 pages each) → large entry scopes. Every list endpoint returns 20 rows per request (`page_size` ignored).
  Remaining Tier-1 volume at 2026-10-03 16:30Z (requests ≈ rows / 20): entries 2741 23,135 · 3081 12,087 more · 2873 5,828 more · 3014 3,654 more (1,140 of 4,794 already fetched, import pending); parties 2846 21,559 more · 3060 14,328 · 2741 7,957 · 3081 4,705 · 3047 1,855 · 3043 1,409 · 3014 1,193 · 2804 808 · 3026 639 · 2873 183; attorneys 2741 1,865 · 3014 513 · 2804 562 · 3060 371 · 2846 237 · 3047 221 · 3081 107 · 3026 95 — about 5,200 requests (more for the parties of 3080, 3149 and 3125, whose totals are not counted yet), i.e. four service days at the 1,400/day limit. The window frees from 2026-10-04 10:47Z (the service waits and resumes by itself).
  The Usage API is the source of truth for what is left: at the service restart (16:19Z) it reported 66 of 1,400/day remaining while the service's own ledger counted 109, so other consumers of the same key exist; the client baseline uses the API value. A 429 (`Retry-After: 1`, four requests inside one second) stopped the service at 15:56Z (by design a 429 stops it and keeps the queue); `CL_MIN_GAP_MS=2500` now spaces requests (≤ 24 per minute).
* **Blocked dockets** (CourtListener `blocked=true`): MDL 2738 (6245245), 2885 (14916674), 2921 (16684846), 2800 (6239202). Their CourtListener entries/parties are not collected or published; the only routes are DocketBird (signed PDF links that expire after about 7 days), GovInfo (the court's published opinions) and the court's own MDL page.
  **MDL 2738 (talc) at 2026-10-03 16:20Z**: published = 13 GovInfo opinions (package USCOURTS-njd-3_16-md-02738) + 8 documents from the D.N.J. MDL pages (`sw_docket_entries_v1`, provider `govinfo` / `official-court`); 10 court-page PDFs are in the pdf-backfill queue (frozen batches a-0011/a-0012); parties/attorneys: none (CourtListener blocks them; DocketBird's party list is not read by any tool). **DocketBird `get_docket_sheet` for `njd-3:2016-md-02738` fails ("The connector's server isn't responding") for both sort orders (retried 2026-10-03 16:20Z; the docket is far larger than the ~1,000-per-sort window); `get_case` and `search_documents` answer.** `search_documents(case_id=njd-3:2016-md-02738)` reports 42,265 indexed documents and its newest document is entry 45883 (2026-10-01): the master docket therefore has at least 45,883 entries, the large majority "Notice of Filing Short Form Complaint, for member case …" filings. That is a size fact about DocketBird's index, not a capture; the entries themselves are not enumerated (a document-search hit costs ≈1,000 tokens including the signed links, so 40,000+ rows cannot be transcribed through the connector). When a script credential is available again, `members-ingest-external.mjs` already accepts DocketBird sheet parts (`db-results/2738-sheet-<sort>-part<N>.json` + summary) and the dataset fills without a contract change.
* Counsel for large dockets is resolved as the attorney scopes are collected; until then a counsel entry has `name:null` (`counsel_unresolved`). The attorney block is read only for its first two lines (firm derivation); the full block (address, phone, email) stays in the private lake.
* The exclusion pattern (§6.0) is applied to entry text and document descriptions: roughly 5–15 % of entries on active dockets are withheld by it (they mention sealing or redaction), e.g. MDL 2804 959 of 7,605. Withheld rows keep their number, date, document counts and links to the master docket.

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
* 2026-10-03 16:45Z — **v1.3 (owner decision "show as published", round 2 items 1–3)**: four datasets live and `ready=true`, each read back through PostgREST after projection (`metadata.projection_validation.verified=true`, validated 16:37–16:38Z): `sw_matters_v1` 24 · `sw_matter_dockets_v1` 2,617 (1,674 with a published caption; 628 workspace links) · `sw_docket_entries_v1` **37,600** (37,579 CourtListener entries of 22 master dockets, equal to the lake row for row, + 21 external entries of blocked MDL 2738) · `sw_matter_parties_v1` **4,670** parties with **15,289** counsel links (equal to the lake's party associations; 3,228 distinct attorneys named, 1,746 distinct firm strings; 1,375 counsel links wait for their attorney record).
  Changes vs v1.2 (additive within `/1`, except the caption rule which is superseded as stated):
  * **§6.0 publication rules** replace the v1.2 privacy rule: entry descriptions (≤ 500 characters), member-case captions, party names and counsel name + firm + role are published as the record shows them; excluded: text matching `/seal|restricted|in[\s-]*camera|ex[\s-]*parte|redact/i` (3,019 entry descriptions withheld by it, 2 party names), entries with a sealed RECAP document (140, no description and no document list), blocked CourtListener dockets (6245245, 14916674, 16684846, 6239202), attorney role 3 (0 present), all contact fields. Counts: 31,268 entries carry a description, 3,475 are clipped at 499 characters + `…`, 2,253 have none recorded.
  * **Captions** (`sw_matter_dockets_v1`): `item.cells.caption` / `caption_source`, `title = <caption> — <docket_number> (<court>)`, filter `has_caption`. The v1.2 institutional-caption rule applies to the matter-level caption only; member captions are shown as published, including "X v. Y" (1,598 rows). JPML-schedule captions pass a quality gate before they are shown (719 of 722 Schedule A, 504 of 672 CTO captions; 105 dockets caption-withheld; never repaired). Source order: CourtListener header → DocketBird → JPML schedule. 40 further member dockets got a CourtListener id by exact court + docket-key match against the 187,900-docket header snapshot in the lake (564 ids already known all found, 1 ambiguous key left unresolved, 1,966 keys have no header in the lake).
  * **Entries and parties** projections (§6.3, §6.4) with `ordinal` rules, `document_ids` / `held` / `source_url` cells on entries and `kind` / `name` cells and `kind` filter on parties (added 16:35Z at ui-integration's request, `_work/contracts/ui-round2-needs-20261003.md`). Row-hash diffed upserts (`detail.provenance.projection_row_sha256`); datasets stay `ready=true` during re-projection.
  * **External entries** for MDL 2738 (§6.3): 13 GovInfo opinions + 8 documents from the D.N.J. MDL pages as registry `external-entry` entities; `corpus_registry_intake_v1` accepts the new entity type. DocketBird `get_docket_sheet` is failing for that docket (see §7); 10 court-page PDFs had been queued before the `official-mdl` ownership note (see pdf-queue-additions/_PRIORITY-mdl-members.md).
  * **Matter cells and registry block**: `entries_published`, `entries_withheld`, `parties_published`, `counsel_links`; `detail.registry.entries[]` and `gaps[]` state per-docket coverage, blocked dockets and external coverage.
  * New RPCs (service_role only, `SECURITY DEFINER`, `search_path=''`): `public.corpus_sw_registry_read_v1` (kinds `docket-entries`, `parties`, `attorneys` [name + first two block lines only], `external-entries`), `public.corpus_sw_docket_headers_v1` (by-id / by-key lake header reads; 180 s statement timeout); migrations `corpus_sw_registry_read_v1`, `corpus_sw_registry_read_v1_external_entries`, `corpus_sw_docket_headers_v1`, `corpus_sw_docket_headers_v1_timeout`, `corpus_registry_intake_v1_external_entry`. Verification SQL `sw-matter-registry-verify-v1.sql` §1–§14 (all counters 0 at 16:38Z; §2 and §4 narrowed for v1.3; §6 shows 0 versions without edges after the incremental edge writer, `native-live-api-relationships-v4-members.sql` (A)–(E)).
  * Lake at this version (run b62bf1fc): CourtListener versions dockets 29, docket-entries 15,706+, recap-documents 20,000+, parties 3,965, attorneys 4,103; 368,161 native edges, 110,448 unresolved (attorney → party edges whose party is not collected yet; they flip when the party is imported).
  Coverage facts at this version: CourtListener entries complete for 3047, 3140, 3094, 3163, 3180, 3166, 3080, 3113, 3108, 3149, 3114, 3185, 3125, 3144, 2846, 2804, 3043, 3060, 3026; partial for 3081 (4,720 of 16,807), 2873 (6,040 of 11,868), 3014 (1,140 of 4,794 after the 16:35Z import); not collected for 2741 (0 of 23,135); 2738 blocked. Parties/attorneys: first 200 collected for every Tier-1 master (complete for the small ones); the large dockets continue (§7, ≈ 5,200 requests). Judges 3113 / 3125: CourtListener `assigned_to` is null on both dockets (header refreshed 15:39Z), so the judge stays the JPML-printed source string, unlinked.
