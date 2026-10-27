"""Dry-run fill of the /judges profile on published judge_cross_profiles records (no network, no writes).

The builder took each judge's profile id from the judge_profiles_fjc record as it stood at build time; 238 judges then had none and their
/judges pages lost the MDL experience panel (getJudgeCrossProfile reads filters.judge_profile). The profile is fixed by exact ids only:
common.profile_ids_by_nid (the id now stored on the FJC record, else the single directory record whose own FJC bridge carries the nid;
any disagreement or many-to-one claim stays unlinked). Existing links are never changed; a disagreement with one is reported.

Inputs (read-only snapshots, private/acq/de-judges-data/snapshots, sha256-checked): judge_cross_profiles, fjc_profiles, crosswalk.
Outputs: private/acq/de-judges-data/judge_cross_relink/{packet.json,preview.sql} and
database/contracts/judge-cross-profiles-relink-20261027-v1.sql (md5-guarded, audited, reversible).

    python -I -B scripts/enrichment/judges_cross/relink_judge_cross_profiles.py
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "judge_xwalk"))
import common as C  # noqa: E402
import patch_sql as Q  # noqa: E402
import snapshot_io as SN  # noqa: E402

DATASET = "judge_cross_profiles"
ISSUE = "dejudges20261027_judge_cross_profile_fill"
CONTRACT = "judge-cross-profiles-relink/2026-10-27.v1"
RUN = Q.run_id(CONTRACT)
OUT = SN.ACQ / "judge_cross_relink"
SQL_PATH = HERE.parents[2] / "database" / "contracts" / "judge-cross-profiles-relink-20261027-v1.sql"


def resolve(snapshot, fjc_rows, crosswalk_rows):
    """(fills, conflicts, summary_fill): judge records to fill, records whose stored id disagrees, and the summary scatter entries to fill."""
    stored = {f["nid"]: (f.get("profiles") or [None])[0] if len(f.get("profiles") or []) == 1 else None for f in fjc_rows}
    xw = [{"id": x["judges_id"], "item": {"profile": {"fjc_nid": x.get("fjc_nid"), "tier": x.get("tier")}}} for x in crosswalk_rows]
    profile_of = C.profile_ids_by_nid(stored, xw)
    photos = snapshot.get("photos") or {}
    fills, conflicts = [], []
    for r in snapshot["records"]:
        if r["kind"] != "judge":
            continue
        want = profile_of.get(r["nid"])
        have = r.get("judge_profile_id")
        if have:
            if want and want != have:
                conflicts.append({"id": r["id"], "name": r["name"], "stored": have, "resolved": want})
            elif r.get("filter_judge_profile") != [have]:
                fills.append({"id": r["id"], "nid": r["nid"], "name": r["name"], "row_md5": r["row_md5"], "profile": have, "photo": r.get("photo"), "kind": "filter_only"})
            continue
        if want:
            fills.append({"id": r["id"], "nid": r["nid"], "name": r["name"], "row_md5": r["row_md5"], "profile": want, "photo": photos.get(want), "kind": "filled"})
    by_nid = {f["nid"]: f for f in fills if f["kind"] == "filled"}
    summary_fill = None
    for r in snapshot["records"]:
        if r["kind"] == "summary" and r.get("scatter"):
            entries = [{"nid": s["nid"], "profile": by_nid[s["nid"]]["profile"], "photo": by_nid[s["nid"]]["photo"]}
                       for s in r["scatter"] if s["nid"] in by_nid and not s.get("judge_profile_id")]
            if entries:
                summary_fill = {"id": r["id"], "row_md5": r["row_md5"], "entries": entries}
    return fills, conflicts, summary_fill


def core_cte(vals):
    return f"""with v(id, row_md5, profile, photo) as (values
    {vals}
  ),
t as materialized (
 select r.id, r.item, r.detail, r.filters, v.row_md5, v.profile, v.photo, (md5(to_jsonb(r)::text) = v.row_md5) as unchanged
 from v join public.corpus_records r on r.dataset = '{DATASET}' and r.id = v.id and r.item->>'kind' = 'judge'),
x as (
 select t.*,
  jsonb_build_array(jsonb_build_object('url', '/judges/' || t.profile, 'label', 'Judge profile'))
   || (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(coalesce(t.item->'links', '[]'::jsonb)) with ordinality q(e, o)
        where e->>'label' is distinct from 'Judge profile') as new_links
 from t),
y as (
 select x.*,
  x.item || jsonb_build_object('links', x.new_links,
            'cross', (x.item->'cross') || jsonb_build_object('judge_profile_id', x.profile, 'photo', coalesce(x.photo, x.item->'cross'->>'photo'))) as new_item,
  x.detail || jsonb_build_object('links', x.new_links) as new_detail,
  x.filters || jsonb_build_object('judge_profile', jsonb_build_array(x.profile)) as new_filters
 from x)"""


def render_sql(fills, summary_fill, conflicts, inputs, expected):
    vals = Q.values([(f["id"], f["row_md5"], f["profile"], f["photo"]) for f in fills])
    kinds = {k: sum(1 for f in fills if f["kind"] == k) for k in ("filled", "filter_only")}
    scope = {"dataset": DATASET, "issue": ISSUE, "inputs": inputs, "method": "judge profile by exact FJC nid (stored on the FJC record, else the single directory record bridging that nid)"}
    tally = {"judge_records": len(fills), "by_kind": kinds, "summary_entries": len(summary_fill["entries"]) if summary_fill else 0, "conflicts_reported": len(conflicts)}
    head = f"""-- {CONTRACT}  (de-judges-data workstream; built by scripts/enrichment/judges_cross/relink_judge_cross_profiles.py; DO NOT EDIT BY HAND)
-- Fills the /judges profile of public.corpus_records dataset '{DATASET}' judge records that were published without one, by exact FJC nid only:
--   the profile id now stored on the judge_profiles_fjc record, else the single judges record whose own FJC bridge (judge_cl_crosswalk.profile.fjc_nid)
--   carries the nid; a nid with disagreeing sources, several bridging records, or a profile claimed by two nids stays unlinked. Existing links are kept.
-- Per record: item.cross.judge_profile_id (+ cross.photo from the judges profile where one is recorded), a leading 'Judge profile' link in item.links
--   and detail.links, filters.judge_profile = [id] (the key getJudgeCrossProfile reads). The summary record's scatter entries of the same judges get
--   judge_profile_id / photo.
-- Targets: {json.dumps(tally, sort_keys=True)}
-- Inputs (read-only snapshots, sha256): {json.dumps(inputs, sort_keys=True)}
-- Row guard everywhere: md5(to_jsonb(row)) equals the snapshot value. Execute statements 0, 1, 2, 3 in order, then the verification SELECTs.
--
-- ROLLBACK (exact; restores both the judge records and the summary record):
{Q.rollback_text(DATASET, ISSUE, RUN)}"""
    s0 = "-- ===== statement 0: register the run =====\n" + Q.run_statement(RUN, CONTRACT, scope, tally)
    s1 = "-- ===== statement 1: audit (judge records) =====\n" + core_cte(vals) + f""",
ins as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select '{DATASET}', y.id, '{ISSUE}', 'label_override',
  'Judge profile filled by exact FJC nid (judge_profiles_fjc stored id, else the single judges record bridging that nid); filters.judge_profile added.',
  jsonb_build_object('contract', '{CONTRACT}', 'profile', y.profile),
  jsonb_build_object('id', y.id, 'item', y.item, 'detail', y.detail, 'filters', y.filters, 'row_md5', y.row_md5),
  jsonb_build_object('item', y.new_item, 'detail', y.new_detail, 'filters', y.new_filters),
  '{RUN}'::uuid
 from y where y.unchanged
 on conflict (dataset, record_id, issue) do nothing
 returning record_id)
select (select count(*) from v) as targets, (select count(*) from t) as found, (select count(*) from t where not unchanged) as changed_since_snapshot,
       (select count(*) from ins) as audit_rows_written;
"""
    s3 = ""
    if summary_fill:
        svals = Q.values([(e["nid"], e["profile"], e["photo"]) for e in summary_fill["entries"]])
        s3 = f"""-- ===== statement 2: audit (summary record scatter entries) =====
with v(nid, profile, photo) as (values
    {svals}
  ),
t as materialized (
 select r.id, r.item, r.detail, r.filters, (md5(to_jsonb(r)::text) = {Q.lit(summary_fill['row_md5'])}) as unchanged
 from public.corpus_records r where r.dataset = '{DATASET}' and r.id = {Q.lit(summary_fill['id'])}),
y as (
 select t.*, jsonb_set(t.item, '{{summary,scatter}}',
   (select coalesce(jsonb_agg(case when v.nid is not null and (s->>'judge_profile_id') is null
                                   then s || jsonb_build_object('judge_profile_id', v.profile, 'photo', coalesce(v.photo, s->>'photo')) else s end order by o), '[]'::jsonb)
      from jsonb_array_elements(t.item->'summary'->'scatter') with ordinality q(s, o) left join v on v.nid = s->>'nid')) as new_item
 from t),
ins as (
 insert into corpus_ingest.cleanup_decisions (dataset, record_id, issue, disposition, reason, evidence, original_record, replacement, run_id)
 select '{DATASET}', y.id, '{ISSUE}', 'label_override', 'Summary scatter: judge_profile_id / photo filled for the same judges.',
  jsonb_build_object('contract', '{CONTRACT}', 'entries', (select count(*) from v)),
  jsonb_build_object('id', y.id, 'item', y.item, 'detail', y.detail, 'filters', y.filters, 'row_md5', {Q.lit(summary_fill['row_md5'])}),
  jsonb_build_object('item', y.new_item, 'detail', y.detail, 'filters', y.filters),
  '{RUN}'::uuid
 from y where y.unchanged
 on conflict (dataset, record_id, issue) do nothing
 returning record_id)
select (select count(*) from t where unchanged) as summary_unchanged, (select count(*) from ins) as audit_rows_written;
"""
    s4 = ("-- ===== statement 3: apply (judge records and summary) from the audited before-images =====\n" + Q.apply_statement(DATASET, ISSUE, RUN))
    filled = [f for f in fills if f["kind"] == "filled"]
    sample = filled[0]["profile"] if filled else ""
    verify = f"""-- ===== verification (read-only) =====
-- V1 expected after apply: judges = {expected['judge_records']}, with_profile_filter = {expected['with_profile_filter']}, without_profile = {expected['judge_records'] - expected['with_profile']}
select count(*) filter (where item->>'kind' = 'judge') as judges,
       count(*) filter (where item->>'kind' = 'judge' and jsonb_array_length(coalesce(filters->'judge_profile', '[]'::jsonb)) = 1) as with_profile_filter,
       count(*) filter (where item->>'kind' = 'judge' and item->'cross'->>'judge_profile_id' is null) as without_profile
from public.corpus_records where dataset = '{DATASET}';
-- V2 consistency (expected 0 rows): cross.judge_profile_id, filters.judge_profile and the leading Judge profile link agree
select id from public.corpus_records where dataset = '{DATASET}' and item->>'kind' = 'judge' and (
  (item->'cross'->>'judge_profile_id') is distinct from (filters->'judge_profile'->>0)
  or (item->'cross'->>'judge_profile_id' is not null and (item->'links'->0->>'url') is distinct from '/judges/' || (item->'cross'->>'judge_profile_id')));
-- V3 one judge_cross_profiles record per profile (expected 0 rows) and every profile exists in judges (expected 0 rows)
select filters->'judge_profile'->>0 as profile, count(*) from public.corpus_records where dataset = '{DATASET}' and filters ? 'judge_profile' and jsonb_array_length(filters->'judge_profile') = 1 group by 1 having count(*) > 1;
select c.id from public.corpus_records c where c.dataset = '{DATASET}' and c.filters->'judge_profile'->>0 is not null
   and not exists (select 1 from public.corpus_records j where j.dataset = 'judges' and j.id = c.filters->'judge_profile'->>0);
-- V4 the page lookup now finds a filled judge (expected 1 row)
select id, title from public.corpus_records where dataset = '{DATASET}' and filters @> '{{"judge_profile":["{sample}"]}}';
-- V5 audit rows of this contract (expected {len(fills)} judge rows + {1 if summary_fill else 0} summary row)
select count(*) from corpus_ingest.cleanup_decisions where issue = '{ISSUE}' and run_id = '{RUN}'::uuid;
"""
    return "\n".join(x for x in [head, s0, s1, s3, s4, verify] if x)


def preview_sql(fills, n=6):
    vals = Q.values([(f["id"], f["row_md5"], f["profile"], f["photo"]) for f in fills[:n]])
    return ("-- read-only preview of statement 1 (no writes)\n" + core_cte(vals) + """
select y.id, y.unchanged, y.item->'cross'->>'judge_profile_id' as old_profile, y.new_item->'cross'->>'judge_profile_id' as new_profile,
       y.new_item->'cross'->>'photo' as photo, y.new_filters->'judge_profile' as filter, y.new_item->'links'->0 as first_link,
       jsonb_array_length(y.new_item->'links') - jsonb_array_length(y.item->'links') as links_added
from y order by y.id;
""")


def main():
    snap = SN.load("judge_cross_profiles")
    fjc = SN.load("fjc_profiles")
    xw = SN.load("crosswalk")
    manifest = json.loads((SN.SNAP / "_manifest.json").read_text(encoding="utf-8"))
    inputs = {k: manifest[k]["sha256"] for k in ("judge_cross_profiles", "fjc_profiles", "crosswalk")}
    fills, conflicts, summary_fill = resolve(snap, fjc, xw)
    judges = [r for r in snap["records"] if r["kind"] == "judge"]
    before = {"judge_records": len(judges), "with_profile": sum(1 for r in judges if r.get("judge_profile_id")),
              "with_profile_filter": sum(1 for r in judges if r.get("filter_judge_profile"))}
    filled = sum(1 for f in fills if f["kind"] == "filled")
    after = {"judge_records": len(judges), "with_profile": before["with_profile"] + filled,
             "with_profile_filter": before["with_profile_filter"] + len(fills)}
    OUT.mkdir(parents=True, exist_ok=True)
    packet = {"contract": CONTRACT, "dataset": DATASET, "issue": ISSUE, "run_id": RUN, "inputs": inputs, "before": before, "after": after,
              "fills": fills, "conflicts": conflicts, "summary_fill": summary_fill}
    data = json.dumps(packet, indent=1, sort_keys=True, ensure_ascii=False).encode("utf-8")
    (OUT / "packet.json").write_bytes(data)
    SQL_PATH.write_text(render_sql(fills, summary_fill, conflicts, inputs, after), encoding="utf-8", newline="\n")
    (OUT / "preview.sql").write_text(preview_sql(fills), encoding="utf-8", newline="\n")
    print(json.dumps({"before": before, "after": after, "fills": len(fills), "filled": filled, "conflicts": conflicts,
                      "summary_entries": len(summary_fill["entries"]) if summary_fill else 0, "photos_filled": sum(1 for f in fills if f["photo"]),
                      "packet_sha256": hashlib.sha256(data).hexdigest(), "sql": str(SQL_PATH)}, indent=1))


if __name__ == "__main__":
    main()
