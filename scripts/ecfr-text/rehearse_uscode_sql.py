#!/usr/bin/env python3
"""Offline rehearsal of database/contracts/uscode-section-text-v1.sql on a throwaway local PostgreSQL (never the live project).

Needs the work directory built by uscode_build_packets.py plus citations_full.jsonl (public.corpus_records export of citation_index).
Sequence: contracts -> intake -> publish -> verify/finalize -> plan -> dry apply -> apply -> recheck -> rollback -> md5 identity.
Items whose section was not acquired yet are skipped unless they resolve to an `unavailable` outcome.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import ecfr_text as drv  # noqa: E402
import rehearse_sql as rs  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    ap.add_argument("--host", default="/tmp")
    ap.add_argument("--port", type=int, default=55432)
    ap.add_argument("--user", default="postgres")
    ap.add_argument("--db", default="rehearsal_usc")
    a = ap.parse_args()
    drv.FAMILY.update({"name": "uscode", "packets": "usc_packets"})
    run = drv.USC_RUN_ID
    ps = rs.Psql(a)
    ps.run(f"drop database if exists {a.db}", db="postgres")
    ps.run(f"create database {a.db}", db="postgres")
    ps.run(rs.BASE)
    for f in ("corpus-ingest-v1.sql", "canonical-integer-jsonb-v1.sql", "ecfr-section-text-v1.sql", "ecfr-section-text-setup-v1.sql",
              "uscode-section-text-v1.sql", "uscode-section-text-setup-v1.sql"):
        ps.run(None, file=os.path.join(rs.CONTRACTS, f))
    rs.jsonl_to_stage(ps, "stage_citation_index", os.path.join(a.work, "citations_full.jsonl"))
    ps.run("""insert into public.corpus_records(dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters)
      select 'citation_index',j->>'id',j->>'category',j->>'state',coalesce(array(select jsonb_array_elements_text(j->'county_geoids')),'{}'),j->>'title',j->>'source_url',
             (j->>'ordinal')::bigint,j->'item',j->'detail',j->>'text',j->'filters' from stage_citation_index""")
    before = ps.run("select count(*), md5(string_agg(md5(to_jsonb(r)::text), '' order by id)) from public.corpus_records r where dataset='citation_index'")
    n_batches = 0
    for b, body in drv.batches(a.work):
        path = os.path.join(a.work, "rehearsal_usc_batch.json")
        open(path, "w", encoding="utf-8").write(body)
        ps.run("drop table if exists stage_batch")
        rs.jsonl_to_stage(ps, "stage_batch", path)
        res = json.loads(ps.run(f"select public.corpus_uscode_text_intake_v1('{run}', j)::text from stage_batch"))
        assert res["received"] == b["records"], res
        n_batches += 1
    st = json.loads(ps.run(f"select public.corpus_uscode_text_status_v1('{run}', null, 5000)::text"))
    print("intake batches", n_batches, "status", {k: st[k] for k in ("entities", "versions_first_seen_in_run", "observations")}, st["page"])
    assert st["page"]["hash_mismatches"] == 0 and st["page"]["text_hash_mismatches"] == 0 and st["page"]["storage_mismatches"] == 0
    while True:
        r = json.loads(ps.run(f"select public.corpus_uscode_text_publish_v1('{run}', 500, false)::text"))
        if r["pending_before"] <= r["written"]:
            break
    after = "null"
    while True:
        v = json.loads(ps.run(f"select public.corpus_uscode_text_verify_v1('{run}', {after}, 500)::text"))
        assert not v["missing"] and not v["mismatched"], v
        if v["entities"] < 500:
            break
        after = "'" + v["last"].replace("'", "''") + "'"
    fin = json.loads(ps.run(f"select public.corpus_uscode_text_finalize_v1('{run}')::text"))
    print("finalize", fin)
    assert fin["verified"]
    items, counts = drv.build_usc_plan_items(a.work)
    resolved = json.load(open(os.path.join(a.work, "usc_packets", "resolution.json")))
    pending = {(r["title"], r["section"]) for r in resolved if r["status"] == "not_acquired"}
    links = json.load(open(os.path.join(a.work, "targets.json")))["citation_links"]
    items = [i for i in items if (links[i["record_id"]]["title"], links[i["record_id"]]["section"]) not in pending]
    print("plan counts", counts, "rehearsed items", len(items))
    planned = 0
    for i in range(0, len(items), 500):
        path = os.path.join(a.work, "rehearsal_usc_plan.json")
        open(path, "w", encoding="utf-8").write(json.dumps(items[i:i + 500]))
        ps.run("drop table if exists stage_plan")
        rs.jsonl_to_stage(ps, "stage_plan", path)
        r = json.loads(ps.run(f"select public.corpus_uscode_text_plan_v1('{run}', j)::text from stage_plan"))
        assert not r["rejected"], r["rejected"][:3]
        planned += r["planned"]
    print("planned", planned)
    print("recheck before", ps.run("select public.corpus_ecfr_text_recheck_v1(false,'citation_index')::text"))
    print("dry", ps.run(f"select public.corpus_uscode_text_apply_v1('{run}', 500, true)::text"))
    while True:
        r = json.loads(ps.run(f"select public.corpus_uscode_text_apply_v1('{run}', 500, false)::text"))
        if r["remaining_planned"] == 0 or r["applied"] + r["skipped"] == 0:
            print("apply last", r)
            break
    print("recheck after", ps.run("select public.corpus_ecfr_text_recheck_v1(false,'citation_index')::text"))
    print("sample", ps.run(f"select (item->'links')::text, (item->'cells'->>'where') from public.corpus_records r join corpus_ingest.uscode_text_plan_v1 p on p.record_id=r.id and p.run_id='{run}' where r.dataset='citation_index' and p.native_id is not null limit 1"))
    while True:
        r = json.loads(ps.run(f"select public.corpus_uscode_text_rollback_v1('{run}', 500, false)::text"))
        if r["remaining_applied"] == 0 or r["restored"] + r["skipped"] == 0:
            print("rollback last", r)
            break
    back = ps.run("select count(*), md5(string_agg(md5(to_jsonb(r)::text), '' order by id)) from public.corpus_records r where dataset='citation_index'")
    print("rollback identical:", back == before)
    assert back == before
    print("OK")


if __name__ == "__main__":
    main()
