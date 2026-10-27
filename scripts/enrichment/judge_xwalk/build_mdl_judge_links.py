"""Dry-run packet and patch contract for exact MDL transferee-judge links (de-judges-data; rules in mdl_judge_links.py).

    python -I -B scripts/enrichment/judge_xwalk/build_mdl_judge_links.py targets   # MDLs without a bulk docket assignment -> targets.json
    node scripts/enrichment/judge_xwalk/fetch_mdl_dockets.mjs --targets=<acq>/mdl_links/targets.json --output=<acq>/mdl_links --execute
    python -I -B scripts/enrichment/judge_xwalk/build_mdl_judge_links.py build     # packet.json, preview.sql, database/contracts/...sql

Inputs: snapshots mdls_judges and crosswalk (private/acq/de-judges-data/snapshots, sha256-checked) and, when present, the live docket
headers read by fetch_mdl_dockets.mjs (mdl_links/docket-assignments.json; each row carries its source URL, retrieval time and sha256).
A live header is used only when its court + docket number equals the JPML master docket exactly and it is the only such docket.
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mdl_judge_links as L  # noqa: E402
import patch_sql as Q  # noqa: E402
import snapshot_io as SN  # noqa: E402

DATASET = "mdls"
ISSUE = "dejudges20261027_mdls_exact_judge_links"
CONTRACT = "mdls-exact-judge-links/2026-10-27.v1"
RUN = Q.run_id(CONTRACT)
OUT = SN.ACQ / "mdl_links"
SQL_PATH = HERE.parents[2] / "database" / "contracts" / "mdls-exact-judge-links-20261027-v1.sql"
LIVE_KEY_TIERS = ("exact_id",) + L.LINKED_EXACT_TIERS + ("parent_profile_link", "compatible_name_same_court", "compatible_name_same_state")


def targets(snapshot):
    """MDLs with no bulk docket assignment that can be looked up exactly (a recorded docket id, or a court and master docket).
    Order: name-variant links first (the lookup can confirm them), then pending MDLs, then the rest (the API quota is small)."""
    out = []
    snapshot = sorted(snapshot, key=lambda m: (0 if m.get("judge_profile_id") and m.get("judge_match_kind") in L.NAME_VARIANTS else 1 if m.get("status") == "pending" else 2,
                                               str(m["id"]).zfill(6)))
    for m in snapshot:
        if m.get("assigned"):
            continue
        dk = str(m.get("cl_docket_id") or "")
        if dk.isdigit() or (m.get("court_id") and m.get("master_docket")):
            out.append({"mdl": str(m["id"]), "court": m.get("court_id"), "master_docket": m.get("master_docket"), "cl_docket_id": dk if dk.isdigit() else None})
    return out


def merge_live(snapshot, live_rows, crosswalk):
    """Copy of the snapshot where an MDL without a bulk assignment gets the live header's assignee (unique exact docket match only)."""
    by_person = {}
    for x in crosswalk:
        if x.get("cl_person_id"):
            by_person.setdefault(str(x["cl_person_id"]), []).append({"judges_id": x["judges_id"], "tier": x.get("tier"), "fjc_nid": x.get("fjc_nid"),
                                                                    "name": x.get("name"), "entity_id": None})
    rows = {}
    for r in live_rows or []:
        rows.setdefault(str(r["mdl"]), []).append(r)
    out, used = [], []
    for m in snapshot:
        m = dict(m)
        hits = [r for r in rows.get(str(m["id"]), []) if r.get("identity_matches")]
        if not m.get("assigned") and len(hits) == 1 and hits[0].get("assigned_to"):
            h = hits[0]
            m["assigned"] = [{"person": h["assigned_to"], "evidence_sha256": h["source_sha256"], "run_id": None, "source_url": h["source_url"],
                              "retrieved_at": h["retrieved_at"], "name": {"first": h.get("assigned_to_str"), "middle": "", "last": "", "suffix": ""},
                              "profiles": [p for p in by_person.get(str(h["assigned_to"]), []) if p["tier"] in LIVE_KEY_TIERS]}]
            m["assigned_live"] = True
            used.append(str(m["id"]))
        out.append(m)
    return out, used


def entry_for(d, m):
    """New detail.judge_links for one decision (None = unchanged)."""
    old = (m.get("judge_links") or [None])[0]
    if d["outcome"] == "confirmed":
        e = dict(old or {})
        e.update({"basis": L.BASIS_DOCKET, "cl_person_id": d["person"], "name_match_kind": old.get("match_kind") if old else None,
                  "evidence": "CourtListener docket assigned_to of the master docket -> judge_cl_crosswalk " + (d["person_profile_tier"] or "")})
        return [e]
    if d["outcome"] == "new":
        return [{"display_name": d["person_profile_name"], "entity_id": d["person_profile_entity"], "basis": L.BASIS_DOCKET, "match_kind": L.BASIS_DOCKET,
                 "cl_person_id": d["person"], "relation": "transferee_judge",
                 "evidence": "CourtListener docket assigned_to of the master docket -> judge_cl_crosswalk " + (d["person_profile_tier"] or ""),
                 "links": [{"url": f"#judge/{d['profile']}", "label": "Judge profile"}]}]
    if d["outcome"] in ("review", "conflict"):
        out = []
        if old:
            e = {k: v for k, v in old.items() if k != "links"}
            e.update({"needs_review": True, "review": d["review"], "candidate_profile_id": d["current_profile"]})
            out.append(e)
        if d["outcome"] == "conflict":
            out.append({"display_name": d["person_name"] or d["person_profile_name"], "cl_person_id": d["person"], "basis": L.BASIS_DOCKET,
                        "relation": "courtlistener_docket_assignment", "needs_review": True, "review": d["review"], "candidate_profile_id": d["person_profile"],
                        "evidence": "CourtListener docket assigned_to of the master docket; differs from the judge printed in the JPML report"})
        return out
    return None


def item_patch(d, m):
    """Item fields to set (merged into item and detail.summary)."""
    linked = d["profile"] is not None
    p = {"judge_profile_id": d["profile"], "judge_link_exact": linked, "judge_link_evidence": d["link_evidence"], "judge_link_review": d["review"],
         "judge_cl_person_id": d["cl_person"], "judge_cl_person_basis": d["cl_person_basis"]}
    if d["person"]:  # an MDL without a docket assignment keeps whatever cl_assigned_to_id it had
        p.update(cl_assigned_to_id=d["person"], cl_assigned_to_as_of=(d.get("live_retrieved_at") or "")[:10] if d.get("live") else L.ASSIGNED_AS_OF)
    if d["outcome"] in ("confirmed", "new"):
        p["judge_link_basis"] = L.BASIS_DOCKET
    if d["outcome"] == "new":
        p.update(judge_entity_id=d["person_profile_entity"], judge_resolved=True, judge_relation="transferee_judge")
    if d["outcome"] in ("review", "conflict"):
        p.update(judge_link_basis=None, judge_entity_id=None, judge_entity_id_candidate=m.get("judge_entity_id"), judge_resolved=False)
    return p


def decisions(snapshot):
    ds = []
    for m in snapshot:
        d = L.classify(m)
        a = (m.get("assigned") or [{}])[0]
        d["live"] = bool(m.get("assigned_live"))
        d["live_retrieved_at"] = a.get("retrieved_at")
        d["source_url"] = a.get("source_url")
        d["old_cl_assigned_to_id"] = m.get("cl_assigned_to_id")
        d["item_patch"] = item_patch(d, m)
        d["judge_links"] = entry_for(d, m)
        d["entity"] = d["item_patch"].get("judge_entity_id", m.get("judge_entity_id"))
        ds.append(d)
    return ds


def core_cte(vals):
    return f"""with v(id, row_md5, patch, links, entity) as (values
    {vals}
  ),
t as materialized (
 select r.id, r.item, r.detail, r.filters, v.row_md5, v.patch::jsonb as patch, v.links::jsonb as links, v.entity, (md5(to_jsonb(r)::text) = v.row_md5) as unchanged
 from v join public.corpus_records r on r.dataset = '{DATASET}' and r.id = v.id),
y as (
 select t.*,
  t.item || t.patch as new_item,
  jsonb_set(t.detail, '{{summary}}', coalesce(t.detail->'summary', t.item) || t.patch)
    || case when t.links is null then '{{}}'::jsonb else jsonb_build_object('judge_links', t.links) end as new_detail,
  t.filters || jsonb_build_object('cl_person_id', coalesce(t.patch->>'judge_cl_person_id', ''),
                                  'entity_id', case when t.entity is null then '[]'::jsonb else jsonb_build_array(t.entity) end)
            || case when t.patch ? 'judge_resolved' then jsonb_build_object('judge_resolved', t.patch->>'judge_resolved') else '{{}}'::jsonb end as new_filters
 from t)"""


def values_of(ds):
    rows = []
    for d in ds:
        rows.append((d["id"], d["row_md5"], json.dumps(d["item_patch"], sort_keys=True), json.dumps(d["judge_links"], sort_keys=True) if d["judge_links"] is not None else None, d["entity"]))
    return Q.values(rows)


def judges_block_sql(ds):
    """judges.detail.mdls: drop the MDLs that lost their link from the candidate profile's block, add the new links (audit + apply)."""
    drop = sorted({(d["current_profile"], d["id"]) for d in ds if d["outcome"] in ("review", "conflict") and d["current_profile"]})
    add = sorted({(d["profile"], d["id"]) for d in ds if d["outcome"] == "new"})
    if not drop and not add:
        return ""
    vals = Q.values([(p, m, "drop") for p, m in drop] + [(p, m, "add") for p, m in add])
    issue = ISSUE + "_judges_block"
    return f"""-- ===== statement 4: audit (judges profile MDL block: remove MDLs that are no longer linked, add new links) =====
with v(profile, mdl, op) as (values
    {vals}
  ),
mm as materialized (
 select r.id as mdl_id, r.title, r.item->>'status' as status, (r.item->>'mdl_number')::int as mdl_no, r.item->>'court_name' as court_name,
        r.item->'actions_pending' as actions_pending, r.item->'total_actions' as total_actions
 from public.corpus_records r where r.dataset = 'mdls' and r.id in (select mdl from v)),
tgt as materialized (
 select j.id, j.detail, md5(to_jsonb(j)::text) as row_md5 from public.corpus_records j where j.dataset = 'judges' and j.id in (select profile from v)),
res as (
 select t.id, t.detail, t.row_md5,
  (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(coalesce(t.detail->'mdls'->'results', '[]'::jsonb)) with ordinality q(e, o)
    where not exists (select 1 from v where v.profile = t.id and v.op = 'drop' and e->>'id' = 'mdl:' || v.mdl)
      and not exists (select 1 from v where v.profile = t.id and v.op = 'add' and e->>'id' = 'mdl:' || v.mdl))
  || (select coalesce(jsonb_agg(jsonb_build_object('id', 'mdl:' || mm.mdl_id, 'title', mm.title, 'status', mm.status,
          'subtitle', 'MDL ' || mm.mdl_no || ' · ' || mm.status || coalesce(' · ' || mm.court_name, ''), 'mdl_number', mm.mdl_no, 'court_name', mm.court_name,
          'actions_pending', mm.actions_pending, 'total_actions', mm.total_actions,
          'links', jsonb_build_array(jsonb_build_object('url', '#mdl/' || mm.mdl_id, 'label', 'MDL ' || mm.mdl_no)))), '[]'::jsonb)
      from v join mm on mm.mdl_id = v.mdl where v.profile = t.id and v.op = 'add') as results
 from tgt t),
fx as (
 select r.id, r.detail as old_detail, r.row_md5,
  jsonb_set(r.detail, '{{mdls}}', coalesce(r.detail->'mdls', '{{}}'::jsonb) || jsonb_build_object('results', r.results, 'total', jsonb_array_length(r.results),
     'pending_total', (select count(*) from jsonb_array_elements(r.results) e where e->>'status' = 'pending'), 'available', true,
     'basis', 'mdls directory: MDLs whose transferee judge is linked to this profile by an exact identifier or a unique exact name (judge_link_exact); name-variant matches are listed on the MDL as needs review')) as new_detail
 from res r),
ins as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select 'judges', x.id, '{issue}', 'label_override', 'Profile MDL block follows the exact MDL judge links of {CONTRACT}.',
  jsonb_build_object('contract', '{CONTRACT}', 'ops', (select jsonb_agg(jsonb_build_object('mdl', v.mdl, 'op', v.op)) from v where v.profile = x.id)),
  jsonb_build_object('id', x.id, 'detail', x.old_detail, 'row_md5', x.row_md5), jsonb_build_object('detail', x.new_detail), '{RUN}'::uuid
 from fx x on conflict (dataset, record_id, issue) do nothing returning record_id)
select (select count(*) from tgt) as profiles, (select count(*) from ins) as audit_rows_written;

-- ===== statement 5: apply (judges profile MDL block) =====
with u as (
 update public.corpus_records r set detail = c.replacement->'detail'
   from corpus_ingest.cleanup_decisions c
  where c.dataset = 'judges' and c.issue = '{issue}' and c.run_id = '{RUN}'::uuid
    and r.dataset = 'judges' and r.id = c.record_id and md5(to_jsonb(r)::text) = c.original_record->>'row_md5'
 returning r.id)
select count(*) as updated from u;
"""


def render_sql(ds, tally_, inputs):
    vals = values_of(ds)  # every record gets the judge_link_* fields, so consumers can rely on them
    scope = {"dataset": DATASET, "issue": ISSUE, "inputs": inputs}
    head = f"""-- {CONTRACT}  (de-judges-data workstream; built by scripts/enrichment/judge_xwalk/build_mdl_judge_links.py; DO NOT EDIT BY HAND)
-- Exact transferee-judge links for public.corpus_records dataset 'mdls' (rules: scripts/enrichment/judge_xwalk/mdl_judge_links.py):
--   the master docket's CourtListener assigned_to person (corpus_ingest.relationships, bulk 2026-09-30; or a live docket header whose court + docket
--   number equals the JPML master docket exactly) -> judges profile through a unique judge_cl_crosswalk exact_id row (else a unique exact-name row).
--   Name-variant links (middle initial, omitted middle name, first initial) that no identifier confirms are kept only as candidates marked needs review;
--   a docket assignment that differs from the JPML-printed judge is shown beside it and neither is linked.
-- New item fields (also in detail.summary): judge_link_exact, judge_link_evidence, judge_link_review, cl_assigned_to_as_of, judge_entity_id_candidate.
-- judge_match_kind is unchanged (it records how the printed name was joined); consumers should read judge_link_exact.
-- Counts: {json.dumps(tally_, sort_keys=True)}
-- Inputs (sha256): {json.dumps(inputs, sort_keys=True)}
-- Row guard everywhere: md5(to_jsonb(row)) equals the snapshot value. Execute statements 0-5 in order, then the verification SELECTs.
--
-- ROLLBACK (exact; mdls records, the mdls metadata copies, then the judges blocks):
{Q.rollback_text(DATASET, ISSUE, RUN)}--   update public.corpus_datasets d set metadata = jsonb_set(jsonb_set(d.metadata - 'exact_judge_links_2026_10_27', '{{listing,results}}', c.original_record->'listing_results'), '{{filter_index}}', c.original_record->'filter_index'), updated_at = now()
--     from corpus_ingest.cleanup_decisions c where c.dataset = 'corpus_datasets' and c.issue = '{ISSUE}' and c.run_id = '{RUN}'::uuid and d.id = c.record_id;
--   update public.corpus_records r set detail = c.original_record->'detail' from corpus_ingest.cleanup_decisions c
--    where c.dataset = 'judges' and c.issue = '{ISSUE}_judges_block' and c.run_id = '{RUN}'::uuid and r.dataset = 'judges' and r.id = c.record_id;
"""
    s0 = "-- ===== statement 0: register the run =====\n" + Q.run_statement(RUN, CONTRACT, scope, tally_)
    s1 = "-- ===== statement 1: audit (mdls records) =====\n" + core_cte(vals) + f""",
ins as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select '{DATASET}', y.id, '{ISSUE}', 'label_override',
  'Transferee-judge link re-derived from the CourtListener docket assignment (exact ids); unconfirmed name-variant links kept as needs-review candidates.',
  jsonb_build_object('contract', '{CONTRACT}', 'patch', y.patch),
  jsonb_build_object('id', y.id, 'item', y.item, 'detail', y.detail, 'filters', y.filters, 'row_md5', y.row_md5),
  jsonb_build_object('item', y.new_item, 'detail', y.new_detail, 'filters', y.new_filters),
  '{RUN}'::uuid
 from y where y.unchanged
 on conflict (dataset, record_id, issue) do nothing
 returning record_id)
select (select count(*) from v) as targets, (select count(*) from t) as found, (select count(*) from t where not unchanged) as changed_since_snapshot,
       (select count(*) from ins) as audit_rows_written;
"""
    s2 = "-- ===== statement 2: apply (mdls records) =====\n" + Q.apply_statement(DATASET, ISSUE, RUN)
    s3 = f"""-- ===== statement 3: regenerate the mdls metadata copies of item / filters (listing.results, filter_index) and record the run =====
with old as (select d.id, d.metadata from public.corpus_datasets d where d.id = 'mdls' and not (d.metadata ? 'exact_judge_links_2026_10_27')),
live as (select r.id, r.title, r.ordinal, r.item, r.filters from public.corpus_records r where r.dataset = 'mdls'),
oldfi as (select f.value->>'id' as id, f.value->>'search' as search from old, jsonb_array_elements(old.metadata->'filter_index') f),
newres as (select jsonb_agg(l.item order by l.ordinal) as o from live l),
newfi as (
 select jsonb_agg(jsonb_build_object('id', l.id, 'item', l.item, 'filters', l.filters,
          'search', coalesce(o.search, lower(l.title) || ' ' || l.id || ' mdl-' || l.id || ' mdl ' || l.id)) order by l.ordinal) as o
 from live l left join oldfi o on o.id = l.id),
aud as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select 'corpus_datasets', 'mdls', '{ISSUE}', 'label_override', 'listing.results and filter_index are exact copies of the live item/filters; regenerated after the exact judge links.',
  jsonb_build_object('contract', '{CONTRACT}'),
  jsonb_build_object('id', 'mdls', 'listing_results', o.metadata->'listing'->'results', 'filter_index', o.metadata->'filter_index'), null, '{RUN}'::uuid
 from old o on conflict (dataset, record_id, issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(jsonb_set(o.metadata, '{{listing,results}}', nr.o), '{{filter_index}}', nf.o)
                   || jsonb_build_object('exact_judge_links_2026_10_27', {Q.lit(json.dumps({"contract": CONTRACT, "run_id": RUN, **tally_}, sort_keys=True))}::jsonb),
        updated_at = now()
   from old o, newres nr, newfi nf, aud a
  where d.id = 'mdls'
 returning d.id)
select (select count(*) from aud) as audit_rows, (select count(*) from upd) as datasets_updated;
"""
    s5 = judges_block_sql(ds)
    verify = f"""-- ===== verification (read-only) =====
-- V1 expected after apply: linked = {tally_['linked_after']}, exact = {tally_['linked_after']}, needs_review = {sum(tally_['needs_review'].values())} {json.dumps(tally_['needs_review'], sort_keys=True)}
select count(*) as mdls, count(*) filter (where item->>'judge_profile_id' is not null) as linked,
       count(*) filter (where (item->>'judge_link_exact')::boolean) as exact,
       count(*) filter (where item->>'judge_link_review' is not null) as needs_review,
       count(*) filter (where item->>'cl_assigned_to_id' is not null) as with_docket_assignee
from public.corpus_records where dataset = 'mdls';
-- V2 consistency (expected 0 rows): a linked MDL is exact, has one #judge link equal to judge_profile_id, and summary equals item
select id from public.corpus_records where dataset = 'mdls' and (
  (item->>'judge_profile_id' is not null and not coalesce((item->>'judge_link_exact')::boolean, false))
  or (item->>'judge_profile_id' is not null and not jsonb_path_exists(detail, '$.judge_links[*].links[*].url ? (@ == $u)', jsonb_build_object('u', '#judge/' || (item->>'judge_profile_id'))))
  or (item->>'judge_profile_id' is null and jsonb_path_exists(detail, '$.judge_links[*].links[*].url ? (@ starts with "#judge/")'))
  or (detail->'summary') is distinct from item);
-- V3 the metadata copies equal the live rows (expected 0)
select count(*) from public.corpus_datasets d, jsonb_array_elements(d.metadata->'filter_index') f
 where d.id = 'mdls' and (f.value->'item') is distinct from (select r.item from public.corpus_records r where r.dataset = 'mdls' and r.id = f.value->>'id');
-- V4 judges blocks: no profile lists an MDL that does not link to it (expected 0 rows)
select j.id, e->>'id' from public.corpus_records j, jsonb_array_elements(j.detail->'mdls'->'results') e
 where j.dataset = 'judges' and e->>'id' like 'mdl:%'
   and exists (select 1 from corpus_ingest.cleanup_decisions c where c.issue = '{ISSUE}_judges_block' and c.record_id = j.id)
   and not exists (select 1 from public.corpus_records m where m.dataset = 'mdls' and 'mdl:' || m.id = e->>'id' and m.item->>'judge_profile_id' = j.id);
-- V5 MDL 3051 (JPML prints Thomas W. Thrash, Jr; the docket names Eleanor Louise Ross): not linked, both candidates listed
select id, item->>'judge_profile_id', item->>'judge_link_review', jsonb_array_length(detail->'judge_links') from public.corpus_records where dataset = 'mdls' and id = '3051';
"""
    return "\n".join(x for x in [head, s0, s1, s2, s3, s5, verify] if x)


def preview_sql(ds, per=2):
    pick = []
    for o in L.OUTCOMES:
        pick += [d for d in ds if d["outcome"] == o][:per]
    return ("-- read-only preview of statement 1 (no writes)\n" + core_cte(values_of(pick)) + """
select y.id, y.unchanged, y.item->>'judge_profile_id' as old_profile, y.new_item->>'judge_profile_id' as new_profile, y.new_item->>'judge_link_evidence' as evidence,
       y.new_item->>'judge_link_review' as review, y.new_filters->>'cl_person_id' as cl_person, y.new_filters->'entity_id' as entity,
       jsonb_array_length(y.new_detail->'judge_links') as judge_links, (y.new_detail->'summary') = y.new_item as summary_equals_item
from y order by y.id;
""")


def load_live():
    path = OUT / "docket-assignments.json"
    if not path.exists():
        return None, None
    data = path.read_bytes()
    return json.loads(data.decode("utf-8")), hashlib.sha256(data).hexdigest()


def main(argv):
    cmd = argv[0] if argv else "build"
    snapshot = SN.load("mdls_judges")
    OUT.mkdir(parents=True, exist_ok=True)
    if cmd == "targets":
        t = targets(snapshot)
        (OUT / "targets.json").write_text(json.dumps(t, indent=1), encoding="utf-8")
        print(json.dumps({"targets": len(t), "file": str(OUT / "targets.json")}))
        return
    crosswalk = SN.load("crosswalk")
    manifest = json.loads((SN.SNAP / "_manifest.json").read_text(encoding="utf-8"))
    inputs = {k: manifest[k]["sha256"] for k in ("mdls_judges", "crosswalk")}
    live, live_sha = load_live()
    used = []
    if live:
        inputs["docket_assignments_live"] = live_sha
        snapshot, used = merge_live(snapshot, live["rows"], crosswalk)
    ds = decisions(snapshot)
    t = L.tally(ds, snapshot)
    t["live_docket_headers_used"] = len(used)
    t["recorded_cl_assigned_to_id_differs"] = sorted(d["id"] for d in ds if d["old_cl_assigned_to_id"] and d["person"] and str(d["old_cl_assigned_to_id"]) != str(d["person"]))
    packet = {"contract": CONTRACT, "dataset": DATASET, "issue": ISSUE, "run_id": RUN, "inputs": inputs, "tally": t, "live_used": used,
              "decisions": [{k: v for k, v in d.items()} for d in ds]}
    data = json.dumps(packet, indent=1, sort_keys=True, ensure_ascii=False).encode("utf-8")
    (OUT / "packet.json").write_bytes(data)
    SQL_PATH.write_text(render_sql(ds, t, inputs), encoding="utf-8", newline="\n")
    (OUT / "preview.sql").write_text(preview_sql(ds), encoding="utf-8", newline="\n")
    print(json.dumps({"tally": t, "packet_sha256": hashlib.sha256(data).hexdigest(), "sql": str(SQL_PATH)}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
