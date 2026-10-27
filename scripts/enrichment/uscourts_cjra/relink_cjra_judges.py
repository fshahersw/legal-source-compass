"""Dry-run relink of the published court_cjra_judges records to /judges profiles with the fixed FJC lookup (no network, no writes).

The full CJRA build needs the 45 acquired report PDFs (private/acq/uscourts_cjra), which this workstream does not have. The profile
link, however, depends only on each record's identity (court | folded surname | folded given names | suffix) and its listed report
dates, both stored on the published records. This script re-runs the builder's matcher (cjra_judges.FjcIndex over
cjra_judges.lookup_from_snapshots) on read-only snapshots of the published data and writes:

  private/acq/de-judges-data/cjra_relink/packet.json   every record whose link or link filter changes, with before / after and the
                                                      md5 of the live row the change was computed against; before / after counts
  database/contracts/court-cjra-judges-relink-20261027-v1.sql   the in-place patch the lead runs (audit, apply, metadata, verify)

Snapshots (private/acq/de-judges-data/snapshots, sha256-checked): cjra_judges, fjc_profiles, crosswalk; see
scripts/enrichment/judge_xwalk/snapshot_queries/*.sql.

    python -I -B scripts/enrichment/uscourts_cjra/relink_cjra_judges.py [--write-lookup]

--write-lookup also saves the snapshots as private/build/uscourts_cjra/lookups/{fjc_profiles,crosswalk}.json so that a full rebuild
(build_uscourts_cjra.py) uses the same lookup.
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "judge_xwalk"))
import cjra_judges as J  # noqa: E402
import patch_sql as Q  # noqa: E402
import snapshot_io as SN  # noqa: E402

DATASET = "court_cjra_judges"
ISSUE = "dejudges20261027_cjra_profile_relink"
CONTRACT = "court-cjra-judges-relink/2026-10-27.v1"
RUN = Q.run_id(CONTRACT)
OUT = SN.ACQ / "cjra_relink"
SQL_PATH = HERE.parents[2] / "database" / "contracts" / "court-cjra-judges-relink-20261027-v1.sql"
LATEST = "2026-03-31"


def name_from_identity(identity):
    """The parsed-name dict the matcher reads, rebuilt from a stored identity key (None for a raw, unparsed label)."""
    parts = (identity or "").split("|")
    if len(parts) != 4 or parts[1] == "raw":
        return None
    return {"format": "surname_first", "surname": parts[1], "given": parts[2], "suffix": parts[3] or None}


def relink(rows, lookup):
    """[(row, new_status, new_profile, fjc_name)] for every snapshot row."""
    index = J.FjcIndex(lookup)
    out = []
    for r in rows:
        name = name_from_identity(r["identity"])
        match, status = index.match(r["court_id"], name, r.get("listed") or []) if name else (None, "unparsed")
        profile, fjc_name = match if match else (None, None)
        out.append((r, status, profile, fjc_name))
    return out


def counts(results, which):
    """Linked records: all, latest-report district judges (role district, listed in the latest report), and distinct profiles."""
    def linked(r, status, profile):
        return (r["match"]["profile"] if which == "before" else profile) is not None
    rows = [(r, s, p) for r, s, p, _ in results]
    latest = [x for x in rows if x[0]["role"] == "district" and (x[0].get("listed") or [None])[-1] == LATEST]
    status_of = (lambda r, s: r["match"]["status"]) if which == "before" else (lambda r, s: s)
    return {
        "records": len(rows),
        "linked": sum(1 for x in rows if linked(*x)),
        "latest_district_listed": len(latest),
        "latest_district_linked": sum(1 for x in latest if linked(*x)),
        "distinct_profiles": len({(x[0]["match"]["profile"] if which == "before" else x[2]) for x in rows if linked(*x)}),
        "by_status": dict(sorted(Counter(status_of(x[0], x[1]) for x in rows).items())),
    }


def changes(results):
    """Records whose stored match or filters must change: a different status or profile, or a linked record without filters.judge_profile."""
    out = []
    for r, status, profile, fjc_name in results:
        old = r["match"]
        filt = r.get("filter_judge_profile")
        want = [profile] if profile else None
        if old.get("status") == status and old.get("profile") == profile and filt == want:
            continue
        kind = ("filter_only" if old.get("profile") == profile else "linked" if not old.get("profile") else "unlinked" if not profile else "relinked")
        out.append({"id": r["id"], "title": r["title"], "court_id": r["court_id"], "row_md5": r["row_md5"], "kind": kind,
                    "before": {"status": old.get("status"), "profile": old.get("profile")}, "after": {"status": status, "profile": profile},
                    "fjc_name": fjc_name, "listed": [(r.get("listed") or [None])[0], (r.get("listed") or [None])[-1]], "role": r["role"]})
    return out


def render_sql(chs, before, after, inputs):
    vals = Q.values([(c["id"], c["row_md5"], c["after"]["status"], c["after"]["profile"], J.PROFILE_LINK_TEXT[c["after"]["status"]]) for c in chs])
    scope = {"dataset": DATASET, "issue": ISSUE, "inputs": inputs, "method": J.PROFILE_LINKS_SUMMARY}
    tally = {"targets": len(chs), "by_kind": dict(Counter(c["kind"] for c in chs)), "before": before, "after": after}
    head = f"""-- {CONTRACT}  (de-judges-data workstream; built by scripts/enrichment/uscourts_cjra/relink_cjra_judges.py; DO NOT EDIT BY HAND)
-- In-place relink of public.corpus_records dataset '{DATASET}' to /judges profiles with the fixed FJC lookup:
--   * every FJC judge of the court counts, whatever the current status (senior and service-ended judges were missing from the lookup);
--   * one FJC judge is one profile (duplicate directory profiles that share one FJC nid collapse to the profile both the FJC directory and the
--     directory record's own FJC bridge name; stub profiles without an nid are never targets);
--   * suffixes (Jr., Sr., III) must not contradict, digits printed after a name are footnote markers, and namesakes of one court are told apart
--     only by service dates overlapping the listings; anything else stays unlinked;
--   * filters.judge_profile = [profile] is added to every linked record (indexed filter key for /judges/<id> pages).
-- Before: {json.dumps(before, sort_keys=True)}
-- After:  {json.dumps(after, sort_keys=True)}
-- Targets: {len(chs)} records {json.dumps(tally['by_kind'], sort_keys=True)}; every other record is untouched.
-- Inputs (read-only snapshots, sha256): {json.dumps(inputs, sort_keys=True)}
-- Row guard everywhere: md5(to_jsonb(row)) equals the snapshot value; a row changed since the snapshot is skipped (statement 1 reports it).
-- Execute statements 0, 1, 2, 3 in order, then the verification SELECTs.
--
-- ROLLBACK (exact):
{Q.rollback_text(DATASET, ISSUE, RUN)}--   update public.corpus_datasets d set metadata = d.metadata - 'relink_2026_10_27' || jsonb_build_object('summary', c.original_record->'summary'), updated_at = now()
--     from corpus_ingest.cleanup_decisions c where c.dataset = 'corpus_datasets' and c.issue = '{ISSUE}' and c.run_id = '{RUN}'::uuid and d.id = c.record_id;
"""
    s0 = "-- ===== statement 0: register the run =====\n" + Q.run_statement(RUN, CONTRACT, scope, tally)
    s1 = "-- ===== statement 1: audit (before-images and replacements of the target records) =====\n" + core_cte(vals) + audit_tail()
    s2 = "-- ===== statement 2: apply from the audited before-images =====\n" + Q.apply_statement(DATASET, ISSUE, RUN)
    s3 = f"""-- ===== statement 3: dataset summary (audit + apply in one statement; runs once) =====
with old as (select d.id, d.metadata from public.corpus_datasets d where d.id = '{DATASET}' and not (d.metadata ? 'relink_2026_10_27')),
ins as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select 'corpus_datasets', old.id, '{ISSUE}', 'label_override', 'court_cjra_judges summary: profile link rule and relink record',
        jsonb_build_object('contract', '{CONTRACT}'), jsonb_build_object('summary', old.metadata->'summary'), null, '{RUN}'::uuid
 from old on conflict (dataset, record_id, issue) do nothing returning record_id),
upd as (
 update public.corpus_datasets d
    set metadata = jsonb_set(d.metadata, '{{summary,profile_links}}', to_jsonb({Q.lit(J.PROFILE_LINKS_SUMMARY)}::text))
                   || jsonb_build_object('relink_2026_10_27', {Q.lit(json.dumps({"contract": CONTRACT, "before": before, "after": after}, sort_keys=True))}::jsonb),
        updated_at = now()
   from old where d.id = old.id and exists (select 1 from ins)
 returning d.id)
select count(*) as metadata_updated from upd;
"""
    verify = verify_sql(len(chs), after)
    return "\n".join([head, s0, s1, s2, s3, verify])


def preview_sql(chs, per_kind=4):
    """Read-only check of statement 1 on a few targets of each kind: the computed replacement next to the live row (no writes)."""
    pick = []
    for kind in sorted({c["kind"] for c in chs}):
        pick += [c for c in chs if c["kind"] == kind][:per_kind]
    vals = Q.values([(c["id"], c["row_md5"], c["after"]["status"], c["after"]["profile"], J.PROFILE_LINK_TEXT[c["after"]["status"]]) for c in pick])
    return ("-- read-only preview of statement 1 (no writes)\n" + core_cte(vals) + """
select y.id, y.unchanged, y.item->'match' as old_match, y.new_item->'match' as new_match, y.new_filters, y.new_item->'links' as new_links,
       y.new_item->'badges' as new_badges, (select f from jsonb_array_elements(y.new_detail->'facts') f where f->>0 = 'Profile link') as profile_fact,
       (y.new_detail->'links') = (y.new_item->'links') as links_equal
from y order by y.id;
""")


def core_cte(vals):
    return f"""with v(id, row_md5, status, profile, fact) as (values
    {vals}
  ),
t as materialized (
 select r.id, r.item, r.detail, r.filters, v.row_md5, v.status, v.profile, v.fact,
        (md5(to_jsonb(r)::text) = v.row_md5) as unchanged
 from v join public.corpus_records r on r.dataset = '{DATASET}' and r.id = v.id),
n as (
 select t.*,
  case when t.profile is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('url', '/judges/' || t.profile, 'label', 'Judge profile')) end as jlink
 from t),
x as (
 select n.*,
  (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from (
     select e, case when o = 1 then 1 else o + 1 end as o from jsonb_array_elements(coalesce(n.item->'links', '[]'::jsonb)) with ordinality q(e, o) where e->>'label' is distinct from 'Judge profile'
     union all select e, 2 from jsonb_array_elements(n.jlink) e) z) as new_links,
  (case when n.profile is null then '[]'::jsonb else '["Judge profile linked"]'::jsonb end)
    || (select coalesce(jsonb_agg(b order by o), '[]'::jsonb) from jsonb_array_elements(coalesce(n.item->'badges', '[]'::jsonb)) with ordinality q(b, o) where b #>> '{{}}' <> 'Judge profile linked') as new_badges,
  (select coalesce(jsonb_agg(case when f->>0 = 'Profile link' then jsonb_build_array('Profile link', n.fact) else f end order by o), '[]'::jsonb)
     from jsonb_array_elements(coalesce(n.detail->'facts', '[]'::jsonb)) with ordinality q(f, o)) as new_facts
 from n),
y as (
 select x.*,
  x.item || jsonb_build_object('match', jsonb_build_object('status', x.status, 'profile', x.profile), 'links', x.new_links, 'badges', x.new_badges) as new_item,
  x.detail || jsonb_build_object('links', x.new_links, 'facts', x.new_facts) as new_detail,
  case when x.profile is null then (x.filters - 'judge_profile') || jsonb_build_object('profile', jsonb_build_array('unlinked'))
       else x.filters || jsonb_build_object('profile', jsonb_build_array('linked'), 'judge_profile', jsonb_build_array(x.profile)) end as new_filters
 from x)"""


def audit_tail():
    return f""",
ins as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select '{DATASET}', y.id, '{ISSUE}', 'label_override',
  'Judge profile link recomputed with the fixed FJC lookup (all FJC statuses, one profile per FJC nid, suffix and service-date guards); filters.judge_profile added for linked records.',
  jsonb_build_object('contract', '{CONTRACT}', 'status', y.status, 'profile', y.profile, 'previous', y.item->'match'),
  jsonb_build_object('id', y.id, 'item', y.item, 'detail', y.detail, 'filters', y.filters, 'row_md5', y.row_md5),
  jsonb_build_object('item', y.new_item, 'detail', y.new_detail, 'filters', y.new_filters),
  '{RUN}'::uuid
 from y where y.unchanged
 on conflict (dataset, record_id, issue) do nothing
 returning record_id)
select (select count(*) from v) as targets, (select count(*) from t) as found, (select count(*) from t where not unchanged) as changed_since_snapshot,
       (select count(*) from ins) as audit_rows_written;
"""


def verify_sql(n_targets, after):
    return f"""-- ===== verification (read-only) =====
-- V1 link counts; expected after apply: linked = {after['linked']}, latest_district_linked = {after['latest_district_linked']} of {after['latest_district_listed']}
select count(*) as records,
       count(*) filter (where item->'match'->>'profile' is not null) as linked,
       count(*) filter (where filters ? 'judge_profile') as with_judge_profile_filter,
       count(*) filter (where filters->'role'->>0 = 'district' and filters->'active'->>0 = 'yes') as latest_district_listed,
       count(*) filter (where filters->'role'->>0 = 'district' and filters->'active'->>0 = 'yes' and item->'match'->>'profile' is not null) as latest_district_linked
from public.corpus_records where dataset = '{DATASET}';
-- V2 consistency (expected 0 rows): match.profile, filters.judge_profile, filters.profile and the Judge profile link agree on every record
select id from public.corpus_records where dataset = '{DATASET}' and (
  (item->'match'->>'profile') is distinct from (filters->'judge_profile'->>0)
  or (filters->'profile'->>0) <> case when item->'match'->>'profile' is null then 'unlinked' else 'linked' end
  or (item->'match'->>'profile' is not null and not (item->'links' @> jsonb_build_array(jsonb_build_object('url', '/judges/' || (item->'match'->>'profile'), 'label', 'Judge profile')))));
-- V3 every linked profile exists in the judges directory (expected 0 rows)
select c.id, c.item->'match'->>'profile' from public.corpus_records c
 where c.dataset = '{DATASET}' and c.item->'match'->>'profile' is not null
   and not exists (select 1 from public.corpus_records j where j.dataset = 'judges' and j.id = c.item->'match'->>'profile');
-- V4 indexed lookup used by the judge page: one record for Hellerstein (S.D.N.Y., senior), expected id nysd-hellerstein-alvin-k
select id from public.corpus_records where dataset = '{DATASET}' and filters @> '{{"judge_profile":["cc3aef8ffa937a319a7fe82bd970a25b"]}}';
-- V5 audit rows written by this contract (expected {n_targets} record rows + 1 dataset row)
select dataset, count(*) from corpus_ingest.cleanup_decisions where issue = '{ISSUE}' and run_id = '{RUN}'::uuid group by 1;
"""


def main(argv):
    rows = SN.load("cjra_judges")
    fjc = SN.load("fjc_profiles")
    xw = SN.load("crosswalk")
    manifest = json.loads((SN.SNAP / "_manifest.json").read_text(encoding="utf-8"))
    inputs = {k: manifest[k]["sha256"] for k in ("cjra_judges", "fjc_profiles", "crosswalk")}
    lookup = J.lookup_from_snapshots(fjc, xw)
    results = relink(rows, lookup)
    before, after = counts(results, "before"), counts(results, "after")
    chs = changes(results)
    OUT.mkdir(parents=True, exist_ok=True)
    packet = {"contract": CONTRACT, "dataset": DATASET, "issue": ISSUE, "run_id": RUN, "inputs": inputs, "before": before, "after": after,
              "profile_conflicts": lookup["profile_conflicts"], "changes": chs}
    data = json.dumps(packet, indent=1, sort_keys=True, ensure_ascii=False).encode("utf-8")
    (OUT / "packet.json").write_bytes(data)
    sql = render_sql(chs, before, after, inputs)
    SQL_PATH.write_text(sql, encoding="utf-8", newline="\n")
    (OUT / "preview.sql").write_text(preview_sql(chs), encoding="utf-8", newline="\n")
    if "--write-lookup" in argv:
        lk = SN.ROOT / "private" / "build" / "uscourts_cjra" / "lookups"
        lk.mkdir(parents=True, exist_ok=True)
        (lk / "fjc_profiles.json").write_text(json.dumps(fjc), encoding="utf-8")
        (lk / "crosswalk.json").write_text(json.dumps(xw), encoding="utf-8")
    print(json.dumps({"before": before, "after": after, "changes": len(chs), "by_kind": dict(Counter(c["kind"] for c in chs)),
                      "packet": str(OUT / "packet.json"), "packet_sha256": hashlib.sha256(data).hexdigest(), "sql": str(SQL_PATH)}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
