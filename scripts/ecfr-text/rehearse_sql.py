#!/usr/bin/env python3
"""Offline rehearsal of database/contracts/ecfr-section-text-v1.sql on a throwaway local PostgreSQL.

Never touches the live project. Needs: a running scratch PostgreSQL (--host/--port/--user), a --work directory holding the
packets built by build_packets.py, `sections_full.jsonl` / `citations_full.jsonl` (full public.corpus_records exports of the
two repointed datasets, see --export-fixtures in this directory's README), and targets.json.
Sequence: contract -> setup -> intake -> publish -> finalize -> plan -> dry apply -> apply -> recheck -> rollback -> md5 identity.
"""
import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
import ecfr_text as drv  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTRACTS = os.path.join(REPO, "database", "contracts")

BASE = """
do $$ begin
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create table public.corpus_datasets(id text primary key,label text,ready boolean not null default false,expected_records bigint,
  imported_records bigint,manifest_sha256 text,metadata jsonb not null default '{}',updated_at timestamptz not null default now());
create table public.corpus_records(dataset text not null references public.corpus_datasets(id),id text not null,category text,state text,
  county_geoids text[] not null default '{}',title text,source_url text,ordinal bigint,item jsonb,detail jsonb,text text,filters jsonb,
  search_vector tsvector generated always as (to_tsvector('simple',coalesce(title,'')||' '||coalesce(text,''))) stored,
  primary key(dataset,id));
insert into public.corpus_datasets(id,label,ready,metadata) values
 ('federal_regulations_sections','sections',true,'{}'),('citation_index','citations',true,'{}'),('ecfr_hierarchy','h',true,'{}');
"""


class Psql:
    def __init__(self, a):
        self.base = ["psql", "-h", a.host, "-p", str(a.port), "-U", a.user, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At"]
        self.db = a.db

    def run(self, sql, db=None, file=None):
        cmd = self.base + ["-d", db or self.db] + (["-f", file] if file else ["-c", sql])
        t0 = time.monotonic()
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            raise SystemExit("psql failed: " + r.stderr[-1500:])
        dt = time.monotonic() - t0
        if sql and dt > 1.5 and "corpus_ecfr_text" in sql:
            print(f"  [{dt:.1f}s] {sql[:60]}")
        return r.stdout.strip()


def jsonl_to_stage(ps, table, path, column="j"):
    ps.run(f"create table {table}({column} jsonb)")
    cmd = ps.base + ["-d", ps.db, "-c", f"\\copy {table} from '{path}' csv quote e'\\x01' delimiter e'\\x02'"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit("copy failed: " + r.stderr[-800:])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--work", required=True)
    ap.add_argument("--host", default="/tmp")
    ap.add_argument("--port", type=int, default=55432)
    ap.add_argument("--user", default="postgres")
    ap.add_argument("--db", default="rehearsal")
    a = ap.parse_args()
    ps = Psql(a)
    ps.run(f"drop database if exists {a.db}", db="postgres")
    ps.run(f"create database {a.db}", db="postgres")
    ps.run(BASE)
    for f in ("corpus-ingest-v1.sql", "canonical-integer-jsonb-v1.sql", "ecfr-section-text-v1.sql", "ecfr-section-text-setup-v1.sql"):
        ps.run(None, file=os.path.join(CONTRACTS, f))
    ps.run(f"select 1 from corpus_ingest.runs where id='{drv.RUN_ID}'")

    # live-shaped fixtures
    for name, ds in (("sections_full.jsonl", "federal_regulations_sections"), ("citations_full.jsonl", "citation_index")):
        jsonl_to_stage(ps, "stage_" + ds, os.path.join(a.work, name))
        ps.run(f"""insert into public.corpus_records(dataset,id,category,state,county_geoids,title,source_url,ordinal,item,detail,text,filters)
          select '{ds}',j->>'id',j->>'category',j->>'state',coalesce(array(select jsonb_array_elements_text(j->'county_geoids')),'{{}}'),j->>'title',j->>'source_url',
                 (j->>'ordinal')::bigint,j->'item',j->'detail',j->>'text',j->'filters' from stage_{ds}""")
    before = ps.run("select dataset, count(*), md5(string_agg(md5(to_jsonb(r)::text), '' order by id)) from public.corpus_records r group by dataset order by 1")

    batches = [b for b, _ in drv.batches(a.work)]
    for b, body in drv.batches(a.work):
        path = os.path.join(a.work, "rehearsal_batch.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        ps.run("drop table if exists stage_batch")
        jsonl_to_stage(ps, "stage_batch", path)
        res = ps.run(f"select public.corpus_ecfr_text_intake_v1('{drv.RUN_ID}', j)::text from stage_batch")
        assert json.loads(res)["received"] == b["records"], res
    print("intake batches:", len(batches))
    status = json.loads(ps.run(f"select public.corpus_ecfr_text_status_v1('{drv.RUN_ID}', null, 5000)::text"))
    print("status:", json.dumps({k: status[k] for k in ("entities", "versions_first_seen_in_run", "observations", "relationships")}),
          "hash mismatches:", status["page"]["hash_mismatches"], status["page"]["text_hash_mismatches"], status["page"]["storage_mismatches"])

    pending = 1
    while pending:
        r = json.loads(ps.run(f"select public.corpus_ecfr_text_publish_v1('{drv.RUN_ID}', 1000, false)::text"))
        pending = r["pending_before"] - r["written"]
    after = "null"
    while True:
        v = json.loads(ps.run(f"select public.corpus_ecfr_text_verify_v1('{drv.RUN_ID}', {after}, 1000)::text"))
        assert not v["missing"] and not v["mismatched"], v
        if v["entities"] < 1000:
            break
        after = "'" + v["last"].replace("'", "''") + "'"
    fin = json.loads(ps.run(f"select public.corpus_ecfr_text_finalize_v1('{drv.RUN_ID}')::text"))
    print("finalize:", fin)
    assert fin["verified"]

    items, counts = drv.build_plan_items(a.work)
    print("plan counts:", counts)
    planned = 0
    for i in range(0, len(items), 500):
        path = os.path.join(a.work, "rehearsal_plan.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(items[i:i + 500]))
        ps.run("drop table if exists stage_plan")
        jsonl_to_stage(ps, "stage_plan", path)
        r = json.loads(ps.run(f"select public.corpus_ecfr_text_plan_v1('{drv.RUN_ID}', j)::text from stage_plan"))
        assert not r["rejected"], r["rejected"][:3]
        planned += r["planned"]
    print("planned:", planned)
    print("recheck before:", ps.run("select public.corpus_ecfr_text_recheck_v1(false)::text"))
    print("dry:", ps.run(f"select public.corpus_ecfr_text_apply_v1('{drv.RUN_ID}', 1000, true)::text"))
    while True:
        r = json.loads(ps.run(f"select public.corpus_ecfr_text_apply_v1('{drv.RUN_ID}', 500, false)::text"))
        if r["remaining_planned"] == 0 or r["applied"] + r["skipped"] == 0:
            print("apply last:", r)
            break
    print("plan status:", ps.run(f"select status, count(*) from corpus_ingest.ecfr_text_plan_v1 where run_id='{drv.RUN_ID}' group by 1 order by 1"))
    print("recheck after:", ps.run("select public.corpus_ecfr_text_recheck_v1(false)::text"))
    print("recheck after (deep):", ps.run("select public.corpus_ecfr_text_recheck_v1(true)::text"))
    after_md5 = ps.run("select dataset, count(*) from public.corpus_records group by 1 order by 1")
    print("datasets:", after_md5.replace("\n", "; "))
    while True:
        r = json.loads(ps.run(f"select public.corpus_ecfr_text_rollback_v1('{drv.RUN_ID}', 500, false)::text"))
        if r["remaining_applied"] == 0 or r["restored"] + r["skipped"] == 0:
            print("rollback last:", r)
            break
    back = ps.run("select dataset, count(*), md5(string_agg(md5(to_jsonb(r)::text), '' order by id)) from public.corpus_records r where dataset in ('federal_regulations_sections','citation_index') group by dataset order by 1")
    want = "\n".join(l for l in before.split("\n") if l.split("|")[0] in ("citation_index", "federal_regulations_sections"))
    print("rollback identical:", back == want)
    assert back == want, (back, want)
    print("OK")


if __name__ == "__main__":
    main()
