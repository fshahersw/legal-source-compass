"""Independent re-derivation of the wave-1026 datasets from the raw files (second path: pyarrow's CSV reader and its own
group-bys over the original bz2 files; raw API responses read straight from the gzip archive, not through cl_api).

    python3 -I -B verify_clb_1026.py

Prints one line per check with its failure count and writes private/build/clb_1026/verify.json. Target: 0 failures.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
import urllib.parse
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import pyarrow as pa  # noqa: E402
import pyarrow.csv as pacsv  # noqa: E402

BULK = os.path.join(ROOT, "private", "acq", "clb_1026", "bulk")
RAW = os.path.join(ROOT, "private", "acq", "clb_1026", "api", "raw")
OUT = os.path.join(ROOT, "private", "build", "clb_1026")
VALUE = ["J", "K", "L", "M", "N", "O", "P1", "P2", "P3", "P4", "-1"]


def table(name: str, columns: list[str]) -> pa.Table:
    with pa.input_stream(os.path.join(BULK, name), compression="bz2") as stream:
        return pacsv.read_csv(stream, read_options=pacsv.ReadOptions(block_size=1 << 24),
                              parse_options=pacsv.ParseOptions(quote_char='"', double_quote=False, escape_char="\\", newlines_in_values=True),
                              convert_options=pacsv.ConvertOptions(include_columns=columns, column_types={c: pa.string() for c in columns},
                                                                   strings_can_be_null=False))


def build(ds: str) -> dict:
    return json.load(open(os.path.join(OUT, ds + ".json")))


def raw_json(sha: str):
    with gzip.open(os.path.join(RAW, sha + ".json.gz"), "rb") as h:
        body = h.read()
    if hashlib.sha256(body).hexdigest() != sha:
        raise SystemExit(f"raw {sha} hash mismatch")
    return json.loads(body)


def code(v: str, allowed) -> str:
    v = (v or "").strip()
    return "none" if not v else v if v in allowed else "other"


def verify_disclosures(report: dict) -> None:
    fd = table("financial-disclosures-2026-09-30.csv.bz2", ["id", "person_id", "year"]).to_pydict()
    rep = {i: (p, y) for i, p, y in zip(fd["id"], fd["person_id"], fd["year"])}
    inv = table("financial-disclosure-investments-2026-09-30.csv.bz2", ["financial_disclosure_id", "gross_value_code", "transaction_during_reporting_period"]).to_pydict()
    gross = defaultdict(Counter)
    tx = Counter()
    for fid, g, t in zip(inv["financial_disclosure_id"], inv["gross_value_code"], inv["transaction_during_reporting_period"]):
        if fid in rep and rep[fid][0]:
            key = (int(rep[fid][0]), int(rep[fid][1]) if rep[fid][1] else None)
            gross[key][code(g, VALUE)] += 1
            if " ".join(t.split()):
                tx[key] += 1
    debts = table("financial-disclosures-debts-2026-09-30.csv.bz2", ["financial_disclosure_id", "value_code"]).to_pydict()
    dv = defaultdict(Counter)
    for fid, v in zip(debts["financial_disclosure_id"], debts["value_code"]):
        if fid in rep and rep[fid][0]:
            dv[(int(rep[fid][0]), int(rep[fid][1]) if rep[fid][1] else None)][code(v, VALUE)] += 1
    b = build("clb_judge_disclosure_items")
    fails, checked = [], 0
    seen = set()
    for r in b["rows"]:
        pr = r["item"]["profile"]
        if r["id"].startswith("year:"):
            continue
        pid = pr["person_id"]
        for y in pr.get("years", []):
            key = (pid, y.get("year"))
            seen.add(key)
            checked += 1
            got = {c: n for c, n in (y.get("investments", {}).get("gross_value") or [])}
            if got != dict(gross.get(key, {})):
                fails.append(["gross_value", key, got, dict(gross.get(key, {}))])
            if y.get("investments", {}).get("transactions", 0) != tx.get(key, 0):
                fails.append(["transactions", key, y.get("investments", {}).get("transactions", 0), tx.get(key, 0)])
            gd = {c: n for c, n in (y.get("debts", {}).get("value") or [])}
            if gd != dict(dv.get(key, {})):
                fails.append(["debt_value", key, gd, dict(dv.get(key, {}))])
    unseen = [k for k in set(gross) | set(dv) if k not in seen]
    report["disclosure_items"] = {"person_years_checked": checked, "failures": len(fails) + len(unseen), "examples": fails[:5], "person_years_missing_from_build": len(unseen)}


def verify_people(report: dict) -> None:
    pos = table("people-db-positions-2026-09-30.csv.bz2", ["person_id", "court_id", "date_confirmation"]).to_pydict()
    n_pos, n_court, first_conf = Counter(), Counter(), {}
    for pid, cid, conf in zip(pos["person_id"], pos["court_id"], pos["date_confirmation"]):
        if pid:
            n_pos[int(pid)] += 1
            if cid:
                n_court[int(pid)] += 1
    edu = Counter(int(p) for p in table("people-db-educations-2026-09-30.csv.bz2", ["person_id"]).column("person_id").to_pylist() if p)
    # ABA ratings straight from the archived pages
    man = [json.loads(line) for line in open(os.path.join(ROOT, "private", "acq", "clb_1026", "api", "_manifest.jsonl"))]
    aba = Counter()
    ids = set()
    for m in man:
        if m["http_status"] == 200 and m.get("method", "GET") == "GET" and "/aba-ratings/" in m["url"] and "count=on" not in m["url"]:
            for r in raw_json(m["sha256"])["results"]:
                if r["id"] not in ids:
                    ids.add(r["id"])
                    aba[int(r["person"].rstrip("/").rsplit("/", 1)[-1])] += 1
    oci = table("originating-court-information-2026-09-30.csv.bz2", ["assigned_to_id", "ordering_judge_id"]).to_pydict()
    lower_a = Counter(int(x) for x in oci["assigned_to_id"] if x)
    lower_o = Counter(int(x) for x in oci["ordering_judge_id"] if x)
    b = build("clb_judge_people")
    fails = []
    for r in b["rows"]:
        pr = r["item"]["profile"]
        pid = pr["person_id"]
        if pr.get("positions_total", 0) != n_pos.get(pid, 0):
            fails.append(["positions", pid, pr.get("positions_total", 0), n_pos.get(pid, 0)])
        if pr.get("court_positions", 0) != n_court.get(pid, 0):
            fails.append(["court_positions", pid, pr.get("court_positions", 0), n_court.get(pid, 0)])
        if len(pr.get("education", [])) != edu.get(pid, 0):
            fails.append(["education", pid, len(pr.get("education", [])), edu.get(pid, 0)])
        if len(pr.get("aba_ratings", [])) != aba.get(pid, 0):
            fails.append(["aba", pid, len(pr.get("aba_ratings", [])), aba.get(pid, 0)])
        la = pr.get("lower_court_appeals") or {}
        if la.get("assigned", 0) != lower_a.get(pid, 0) or la.get("ordering", 0) != lower_o.get(pid, 0):
            fails.append(["lower_court_appeals", pid, la, lower_a.get(pid, 0), lower_o.get(pid, 0)])
    expected = {p for p, n in n_court.items() if n} | set(aba)
    built = {r["item"]["profile"]["person_id"] for r in b["rows"]}
    report["judge_people"] = {"people_checked": len(b["rows"]), "aba_rows_in_archive": len(ids), "failures": len(fails) + len(expected ^ built),
                              "selection_difference": len(expected ^ built), "examples": fails[:5]}


def verify_search(report: dict) -> None:
    path = os.path.join(OUT, "clb_search_counts.json")
    if not os.path.exists(path):
        report["search_counts"] = {"skipped": "no build file yet"}
        return
    b = json.load(open(path))
    fails, checked = [], 0

    def check(pt):
        nonlocal checked
        checked += 1
        body = raw_json(pt["sha256"])
        if body.get("count") != pt["count"]:
            fails.append(["count", pt["q"], pt["count"], body.get("count")])
        qs = urllib.parse.parse_qs(pt["api_url"].split("?", 1)[1])
        if pt["q"] is not None and qs.get("q") != [pt["q"]]:
            fails.append(["query", pt["q"], qs.get("q")])
        if pt["search_url"].split("?", 1)[1] != pt["api_url"].split("?", 1)[1]:
            fails.append(["search_url", pt["q"]])

    for r in b["rows"]:
        pr = r["item"]["profile"]
        if pr.get("kind") == "status":
            for pt in pr["points"]:
                for k in ("published", "unpublished", "combined"):
                    if pt.get(k):
                        check(pt[k])
                if pt.get("combined") and (pt["published"]["count"] + pt["unpublished"]["count"] == pt["combined"]["count"]) != pt["sum_equals_combined"]:
                    fails.append(["status_sum_flag", pt["year"]])
            continue
        for pt in pr.get("points", []):
            check(pt)
            if "share_pct" in pt and pt.get("total"):
                if abs(pt["share_pct"] - round(100 * pt["count"] / pt["total"], 3)) > 1e-9:
                    fails.append(["share", pt["q"]])
        if "total" in pr and isinstance(pr["total"], dict):
            check(pr["total"])
        for t in pr.get("topics", []):
            check(t)
    report["search_counts"] = {"points_checked": checked, "failures": len(fails), "examples": fails[:5]}


def verify_appeals(report: dict) -> None:
    e = table("court-appeals-to-2026-09-30.csv.bz2", ["id", "from_court_id", "to_court_id"]).to_pydict()
    edges = {f"edge:{i}": (f, t) for i, f, t in zip(e["id"], e["from_court_id"], e["to_court_id"])}
    b = build("clb_court_appeals_to")
    got = {r["id"]: (r["item"]["profile"]["from"]["court_id"], r["item"]["profile"]["to"]["court_id"]) for r in b["rows"] if r["id"].startswith("edge:")}
    report["court_appeals_to"] = {"edges": len(edges), "failures": sum(1 for k in edges.keys() | got.keys() if edges.get(k) != got.get(k))}


def main() -> None:
    report: dict = {}
    for f in (verify_appeals, verify_people, verify_disclosures, verify_search):
        f(report)
        name = list(report)[-1]
        print(name, json.dumps(report[name])[:400], flush=True)
    with open(os.path.join(OUT, "verify.json"), "w") as h:
        json.dump(report, h, indent=1, default=str)
    total = sum(v.get("failures", 0) for v in report.values())
    print("total failures:", total)


if __name__ == "__main__":
    main()
