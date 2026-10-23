"""Case-law stage 2 verification: a random sample of cases checked end to end, independently of the builders.

    cd scripts/enrichment/caselaw
    python3 -I -B verify_caselaw.py [--sample 200] [--seed 20261022]

For every sampled case (stratified over the three tiers, among cases whose text is in the reading store):
  metadata   the Postgres row (caselaw_case_v1) against the local CourtListener tables, queried here directly:
             name, court, tier, date, status, CourtListener citation count, docket number, judges, the set of parallel
             citations, SCDB fields, and the opinion ids (the cluster's unblocked opinions);
  text       every opinion pointer read back with one HTTP Range request (as the site does), decompressed, and compared
             with the stage-1 shard record it came from (downloaded whole, sha256 checked against the stage-1 manifest):
             text sha256 (recomputed on both sides), pages and citation anchors;
  citator    the cited-by member read back by range and compared with counts recomputed here in Python from the raw
             citation-map rows (cited-by opinions and cases, by court, by decade) and the citing list re-ranked here; the
             parenthetical count; the authorities member against the stage-1 records' own citation anchors;
  search     caselaw_search_v1 finds the case by its first citation and by its exact name (with its court and date as
             filters, since a common name can have thousands of namesakes); for the Supreme Court tier
             caselaw_fulltext_v1 finds it by an eight-word phrase quoted from its text.
Writes private/build/caselaw_read/verify_report.json; exit status 1 when anything fails.
"""
from __future__ import annotations

import argparse
import collections
import glob
import gzip
import hashlib
import json
import os
import random
import re
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import citator as ct  # noqa: E402
import load_caselaw as lc  # noqa: E402
import read_store as rs  # noqa: E402

BUILD = os.path.join(ROOT, "private", "build", "caselaw_read")
TIERS = {1: "t1", 2: "t2", 3: "t3"}


def sample_cases(n: int, seed: int) -> list[dict]:
    """Stratified random sample of case rows (from the metadata build) that have at least one stored opinion."""
    by_tier = collections.defaultdict(list)
    for path in sorted(glob.glob(os.path.join(BUILD, "meta", "cases-p*.jsonl.gz"))):
        with gzip.open(path, "rt", encoding="utf-8") as h:
            for line in h:
                r = json.loads(line)
                if any("key" in o for o in r["opinions"]):
                    by_tier[r["tier"]].append(r["cluster_id"])
    rnd = random.Random(seed)
    per = {1: n - 2 * (n // 3), 2: n // 3, 3: n // 3}
    out = []
    for t, k in per.items():
        ids = sorted(by_tier[t])
        out.extend({"cluster_id": c, "tier": t} for c in rnd.sample(ids, min(k, len(ids))))
    return out


def norm(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class Verifier:
    def __init__(self):
        import store

        self.st = store.Storage()
        self.rpc = lc.Rpc()
        self.con = ct.connect(memory="2GB", threads=2)
        self.con.execute(f"CREATE TEMP TABLE sel AS SELECT * FROM read_parquet('{rs.SELECTION}')")
        self.manifest = {}
        with open(rs.STAGE1_MANIFEST) as h:
            for line in h:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self.manifest[e["path"]] = e
        self.shards: dict[str, dict[int, dict]] = {}
        self.fail: list[dict] = []
        self.counts = collections.Counter()

    def check(self, cid: int, what: str, ok: bool, detail=None):
        self.counts[f"{what}_checked"] += 1
        if not ok:
            self.counts[f"{what}_failed"] += 1
            self.fail.append({"cluster_id": cid, "check": what, "detail": detail})

    # ------------------------------------------------------------------------------------------------ helpers
    def stage1_record(self, key: str, oid: int) -> dict | None:
        if key not in self.shards:
            e = self.manifest[key]
            data = rs._download(self.st, key, e["sha256"], e["bytes"])
            self.shards[key] = {r["opinion_id"]: r for r in rs.iter_jsonl(data)}
            if len(self.shards) > 40:
                self.shards.pop(next(iter(self.shards)))
        return self.shards[key].get(oid)

    def ranged(self, key: str, off: int, n: int) -> bytes:
        r = self.st.s.get(self.st._object_url(key, False), headers={**self.st.h, "Range": f"bytes={off}-{off + n - 1}"}, timeout=60)
        if r.status_code != 206 or len(r.content) != n:
            raise RuntimeError(f"range read of {key} returned {r.status_code} / {len(r.content)} bytes")
        return r.content

    # ------------------------------------------------------------------------------------------------ checks
    def metadata(self, cid: int, row: dict) -> None:
        q = self.con.execute("""
            SELECT k.case_name, d.court_id, CAST(k.date_filed AS VARCHAR), k.precedential_status, k.citation_count, d.docket_number,
                   k.judges, k.scdb_id, k.scdb_decision_direction, k.scdb_votes_majority, k.scdb_votes_minority,
                   coalesce(k.blocked, false) OR coalesce(d.blocked, false)
            FROM cluster.cluster k JOIN docket.docket d ON d.id = k.docket_id WHERE k.id = ?""", [cid]).fetchone()
        cites = sorted(f"{v} {r} {p}" for v, r, p in self.con.execute(
            "SELECT volume, reporter, page FROM citation.citation WHERE cluster_id = ?", [cid]).fetchall())
        ops = sorted(r[0] for r in self.con.execute("SELECT opinion_id FROM sel WHERE cluster_id = ? AND NOT blocked", [cid]).fetchall())
        tier = self.con.execute("SELECT any_value(tier) FROM sel WHERE cluster_id = ?", [cid]).fetchone()[0]
        name, court, date, status, ccount, docket, judges, scdb_id, sdir, smaj, smin, blocked = q
        exp = {"case_name": norm(name) or "Not recorded", "court_id": court, "date_filed": date, "precedential_status": norm(status),
               "citation_count": ccount, "docket_number": norm(docket), "judges": norm(judges), "tier": int(tier[1]),
               "citations": cites, "opinions": ops, "blocked": blocked,
               "scdb": {"id": norm(scdb_id), "decision_direction": sdir, "votes_majority": smaj, "votes_minority": smin} if norm(scdb_id) else None}
        got = {"case_name": row["case_name"], "court_id": row["court_id"], "date_filed": row["date_filed"],
               "precedential_status": row["precedential_status"], "citation_count": row["citation_count"],
               "docket_number": row["docket_number"], "judges": row["judges"], "tier": row["tier"],
               "citations": sorted(row["citations"]), "opinions": sorted(o["id"] for o in row["opinions"]), "blocked": False,
               "scdb": row["scdb"]}
        diff = {k: (exp[k], got[k]) for k in exp if exp[k] != got[k]}
        self.check(cid, "metadata", not diff, diff)

    def text(self, cid: int, row: dict) -> dict[int, dict]:
        stage1 = {}
        for o in row["opinions"]:
            if "key" not in o or not o.get("key"):
                continue
            blob = self.ranged(o["key"], o["s"], o["n"])
            rec = json.loads(zlib.decompress(blob, 31).decode("utf-8"))
            s1 = self.stage1_record(rec["stage1"]["key"], o["id"])
            problems = []
            if s1 is None:
                problems.append("opinion not in its stage-1 shard")
            else:
                stage1[o["id"]] = s1
                h_read = hashlib.sha256(rec["text"].encode("utf-8")).hexdigest()
                h_s1 = hashlib.sha256(s1["text"].encode("utf-8")).hexdigest()
                if not (h_read == h_s1 == s1["text_sha256"] == rec["text_sha256"]):
                    problems.append("text sha256 differs")
                if rec["pages"] != [[p["page"], p.get("citation_index"), p["offset"]] for p in s1.get("pages") or []]:
                    problems.append("pages differ")
                if [c[:4] for c in rec["citations"]] != [[c["start"], c["end"], c.get("cluster_id"), c.get("opinion_id")] for c in s1.get("citations") or []]:
                    problems.append("citation anchors differ")
                if rec["opinion_id"] != o["id"] or rec["cluster_id"] != cid:
                    problems.append("ids differ")
            self.check(cid, "text", not problems, {"opinion_id": o["id"], "problems": problems})
        return stage1

    def citator(self, cid: int, row: dict, stage1: dict[int, dict]) -> None:
        # independent recomputation from raw citation-map rows
        ops = [r[0] for r in self.con.execute("SELECT opinion_id FROM sel WHERE cluster_id = ? AND NOT blocked", [cid]).fetchall()]
        edges = self.con.execute(f"""
            SELECT m.citing_opinion_id, o.cluster_id, m.depth, d.court_id, k.date_filed, k.citation_count,
                   coalesce(k.blocked, false) OR coalesce(d.blocked, false)
            FROM cmap.cmap m JOIN opinion.opinion o ON o.id = m.citing_opinion_id
            JOIN cluster.cluster k ON k.id = o.cluster_id LEFT JOIN docket.docket d ON d.id = k.docket_id
            WHERE m.cited_opinion_id IN ({",".join(map(str, ops)) or "NULL"})""").fetchall()
        kept = [e for e in edges if e[1] != cid and not e[6]]
        exp_ops = {e[0] for e in kept}
        exp_cases = {e[1] for e in kept}
        by_court = collections.Counter()
        by_decade = collections.Counter()
        seen = set()
        for e in kept:
            if e[0] in seen:
                continue
            seen.add(e[0])
            by_court[e[3]] += 1
            by_decade[None if e[4] is None else e[4].year // 10 * 10] += 1
        depth = collections.Counter()
        info = {}
        for e in kept:
            depth[e[1]] += e[2]
            info[e[1]] = (e[5], e[4])
        ranked = sorted(depth, key=lambda c: (-(info[c][0] if info[c][0] is not None else -1), -depth[c],
                                              -(info[c][1].toordinal() if info[c][1] else -10**9), c))[:ct.CITING_TOP]
        problems = []
        if row["cited_by"] != len(exp_ops) or row["cited_by_cases"] != len(exp_cases):
            problems.append(f"row counts {row['cited_by']}/{row['cited_by_cases']} vs {len(exp_ops)}/{len(exp_cases)}")
        cit = None
        if row.get("citator"):
            c = row["citator"]
            cit = json.loads(zlib.decompress(self.ranged(c["key"], c["offset"], c["length"]), 31).decode("utf-8"))
            if cit["cluster_id"] != cid:
                problems.append("citator member for another case")
            if (cit["cited_by"]["opinions"], cit["cited_by"]["cases"]) != (len(exp_ops), len(exp_cases)):
                problems.append("citator counts differ")
            if dict((k, n) for k, n in cit["by_court"]) != dict(by_court):
                problems.append("by_court differs")
            if dict((d, n) for d, n in cit["by_decade"]) != dict(by_decade):
                problems.append("by_decade differs")
            if [x["cluster_id"] for x in cit["citing"]] != ranked:
                problems.append("citing list order differs")
        elif exp_ops:
            problems.append("no citator member although the case is cited")
        # authorities, recomputed from the stage-1 anchors of this case's opinions
        sep, comb = collections.Counter(), collections.Counter()
        types = {o["id"]: o["type"] for o in row["opinions"]}
        dual = "010combined" in types.values() and any(t != "010combined" for t in types.values())
        for oid, s1 in stage1.items():
            bucket = comb if dual and types.get(oid) == "010combined" else sep
            for a in s1.get("citations") or []:
                bucket[a.get("cluster_id")] += 1
        exp_auth = collections.Counter({k: max(sep.get(k, 0), comb.get(k, 0)) for k in set(sep) | set(comb)})
        exp_auth.pop(cid, None)
        got_list = []
        if row.get("authorities_ref"):
            r = row["authorities_ref"]
            au = json.loads(zlib.decompress(self.ranged(r["key"], r["offset"], r["length"]), 31).decode("utf-8"))
            if au["cluster_id"] != cid:
                problems.append("authorities member for another case")
            got_list = au["authorities"]
        got_auth = collections.Counter({a["cluster_id"]: a["anchors"] for a in got_list if a["cluster_id"] is not None})
        if len(stage1) == len([o for o in row["opinions"] if o.get("key")]):
            blocked = self.blocked_clusters([k for k in exp_auth if k is not None])
            exp_known = {k: v for k, v in exp_auth.items() if k is not None and k not in blocked}
            # links whose cluster id was missing are resolved through the opinion table by the builder
            resolved_extra = {k: v for k, v in got_auth.items() if k not in exp_known}
            if any(got_auth.get(k) != v for k, v in exp_known.items()) or sum(resolved_extra.values()) > exp_auth.get(None, 0):
                problems.append("authorities differ")
            if row["authorities"] != len(got_list):
                problems.append("authorities count in the row differs from the member")
        paren = self.con.execute(f"SELECT max(total) FROM read_parquet('{ct.PAREN}') WHERE described_cluster_id = ?", [cid]).fetchone()[0] or 0
        if row["parentheticals"] != paren:
            problems.append(f"parenthetical count {row['parentheticals']} vs {paren}")
        self.check(cid, "citator", not problems, problems)

    def blocked_clusters(self, ids: list[int]) -> set[int]:
        if not ids:
            return set()
        rows = self.con.execute(f"""SELECT k.id FROM cluster.cluster k LEFT JOIN docket.docket d ON d.id = k.docket_id
            WHERE k.id IN ({",".join(map(str, ids))}) AND (coalesce(k.blocked, false) OR coalesce(d.blocked, false))""").fetchall()
        return {r[0] for r in rows}

    def search(self, cid: int, row: dict, stage1: dict[int, dict]) -> None:
        problems = []
        if row["citations"]:
            cite = row["citations"][0]
            found = False
            for page in range(4):
                res = self.rpc.call("caselaw_search_v1", {"p_q": cite, "p_limit": 25, "p_offset": 25 * page})
                if any(r["cluster_id"] == cid for r in res["rows"]):
                    found = True
                    break
                if not res["has_more"]:
                    break
            if not found:
                problems.append(f"citation search {cite!r} misses the case")
        name = row["case_name"]
        res = self.rpc.call("caselaw_search_v1", {"p_q": name[:300], "p_court": row["court_id"], "p_from": row["date_filed"],
                                                  "p_to": row["date_filed"], "p_limit": 100})
        if not any(r["cluster_id"] == cid for r in res["rows"]):
            problems.append(f"name search {name[:80]!r} misses the case")
        unfiltered = self.rpc.call("caselaw_search_v1", {"p_q": name[:300], "p_limit": 25})
        self.counts["name_found_unfiltered_top25"] += any(r["cluster_id"] == cid for r in unfiltered["rows"])
        if row["tier"] == 1 and stage1:
            text = max((s["text"] for s in stage1.values()), key=len)
            words = re.findall(r"[A-Za-z]{4,}", text)
            if len(words) >= 40:
                mid = len(words) // 2
                phrase = " ".join(words[mid:mid + 8])
                fts = self.rpc.call("caselaw_fulltext_v1", {"p_q": f'"{phrase}"', "p_limit": 50})
                self.counts["fulltext_checked"] += 1
                if not any(r["cluster_id"] == cid for r in fts["rows"]):
                    # a phrase built from words alone may straddle punctuation; fall back to the words without quotes
                    fts2 = self.rpc.call("caselaw_fulltext_v1", {"p_q": phrase, "p_limit": 50})
                    if not any(r["cluster_id"] == cid for r in fts2["rows"]):
                        problems.append(f"full-text search misses the case ({phrase!r})")
        self.check(cid, "search", not problems, problems)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20261022)
    a = ap.parse_args(argv)
    t0 = time.time()
    v = Verifier()
    cases = sample_cases(a.sample, a.seed)
    for i, c in enumerate(cases):
        cid = c["cluster_id"]
        row = v.rpc.call("caselaw_case_v1", {"p_cluster_id": cid})
        if not row:
            v.check(cid, "row", False, "no Postgres row")
            continue
        v.check(cid, "row", True)
        try:
            v.metadata(cid, row)
            stage1 = v.text(cid, row)
            v.citator(cid, row, stage1)
            v.search(cid, row, stage1)
        except Exception as exc:  # noqa: BLE001 - recorded as a failure of this case
            v.check(cid, "exception", False, f"{type(exc).__name__}: {exc}"[:300])
        if (i + 1) % 25 == 0:
            print(f"[verify] {i + 1}/{len(cases)} cases, {len(v.fail)} failures ({time.time() - t0:.0f}s)", flush=True)
    report = {"sample": len(cases), "seed": a.seed, "tiers": dict(collections.Counter(c["tier"] for c in cases)),
              "counts": dict(v.counts), "failures": len(v.fail), "failure_detail": v.fail[:200],
              "seconds": round(time.time() - t0, 1), "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    with open(os.path.join(BUILD, "verify_report.json"), "w") as h:
        json.dump(report, h, indent=1, default=str)
    print(json.dumps({k: report[k] for k in ("sample", "tiers", "counts", "failures", "seconds")}, indent=1))
    return 1 if v.fail else 0


if __name__ == "__main__":
    sys.exit(main())
