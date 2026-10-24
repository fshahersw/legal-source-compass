"""Independent verification of the wave-1026 JPML series build (no shared parsing code with the builder).

  python3 -I -B scripts/enrichment/jpml_history/verify_series.py

Second path: `pdftotext -raw` (content-stream order, not the layout mode the builder parses) and plain string search.
Checks, each counted:
  totals    every snapshot: the raw text holds 'Report Totals' followed by the stored printed MDL count, pending and
            total (comma-formatted), and the stored computed sums equal them
  rows      every MDL row of every snapshot: the raw-text segment that starts at that MDL's 'MDL -<n>' token holds
            the stored pending and total values in that order
  circuits  every quarter-end report: each stored Circuit Summary appears verbatim in the raw text
  archive   every snapshot dated 2024-10 to 2026-10 equals the published jpml_pending_history_months month row
            (MDLs, pending, total) and every MDL point equals jpml_pending_history_mdls history.series
  derived   district HHI, top-10 share and flows recomputed here with plain loops equal the stored values
  spot      20 figures with the PDF page that prints them (single-page text) for the report
Writes private/build/jpml_reports/verification.json; exits 1 on any failure.
"""
import gzip
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
B = ROOT / "private" / "build" / "jpml_reports"
OLD = ROOT / "private" / "build" / "jpml_history"


def load(p):
    raw = p.read_bytes()
    return json.loads(gzip.decompress(raw) if p.suffix == ".gz" else raw)


def original(path_rel):
    p = ROOT / path_rel
    data = p.read_bytes()
    return gzip.decompress(data) if p.suffix == ".gz" else data


def raw_text(data, first=None, last=None):
    args = ["pdftotext", "-raw"]
    if first:
        args += ["-f", str(first), "-l", str(last)]
    return subprocess.run(args + ["-", "-"], input=data, capture_output=True, check=True).stdout.decode("utf-8", "replace")


def pages(data):
    out = subprocess.run(["pdfinfo", "-"], input=data, capture_output=True, text=False).stdout.decode()
    m = re.search(r"Pages:\s+(\d+)", out)
    return int(m.group(1)) if m else 0


def c(n):
    return f"{n:,}"


def main():
    snaps = load(B / "jpml_pending_snapshots.json")
    inputs = {i["url"]: i["path"] for i in snaps["inputs"]}
    rows = [r for r in snaps["rows"] if r["id"].startswith("report:")]
    res = {"totals": [0, []], "rows": [0, []], "circuits": [0, []], "archive": [0, []], "derived": [0, []], "spot": []}

    def fail(kind, what):
        res[kind][1].append(what)

    texts = {}
    for r in rows:
        st = r["item"]["snapshot"]
        url = st["source_url"]
        data = original(inputs[url])
        t = raw_text(data)
        texts[url] = (data, t)
        flat = " ".join(t.split())
        p = st["printed"]
        res["totals"][0] += 1
        m = re.search(r"Report Totals:\s*" + re.escape(str(p["dockets"])) + r"\s+" + re.escape(c(p["pending"])) + r"\s+" + re.escape(c(p["total"])), flat)
        if not m or st["pending_mdls"] != p["dockets"] or st["pending_actions"] != p["pending"] or st["total_actions"] != p["total"]:
            fail("totals", {"date": st["date"], "printed": p, "computed": [st["pending_mdls"], st["pending_actions"], st["total_actions"]], "found": bool(m)})
        # rows: segment from this MDL token to the next MDL token
        toks = [(mm.start(), int(mm.group(1))) for mm in re.finditer(r"MDL\s*-\s*(\d{1,5})\b", flat)]
        seg = {}
        for i, (pos, n) in enumerate(toks):
            end = toks[i + 1][0] if i + 1 < len(toks) else len(flat)
            seg.setdefault(n, []).append(flat[pos:end])
        for mdl, pend, tot, _d in r["item"]["rows"]:
            res["rows"][0] += 1
            ok = False
            for s in seg.get(mdl, []):
                a = s.find(" " + c(pend) + " ")
                b = s.find(" " + c(tot), a + 1 + len(c(pend))) if a >= 0 else -1
                if a >= 0 and b >= 0:
                    ok = True
                    break
            if not ok:
                fail("rows", {"date": st["date"], "mdl": mdl, "pending": pend, "total": tot})
    # circuits
    q = load(B / "jpml_quarterly_caseload.json")
    qin = {i["url"]: i["path"] for i in q["inputs"]}
    for r in q["rows"]:
        if not r["id"].startswith("quarter:"):
            continue
        flat = " ".join(raw_text(original(qin[r["source_url"]])).split())
        for cc in r["item"]["quarter"]["circuits"]:
            res["circuits"][0] += 1
            pat = f"Circuit Summary: Districts: {cc['districts']}, MDLs: {cc['mdls']} {cc['pending']} {cc['total']}"
            if pat not in flat:
                fail("circuits", {"date": r["item"]["quarter"]["date"], "circuit": cc["name"], "pattern": pat})
    # archive equality with the published datasets
    months = {r["id"]: r for r in load(OLD / "jpml_pending_history_months.json")["rows"] if re.fullmatch(r"\d{4}-\d{2}", r["id"])}
    old_mdls = {r["id"]: r for r in load(OLD / "jpml_pending_history_mdls.json")["rows"]}
    new_mdls = {r["id"]: r for r in load(B / "jpml_mdl_pending_series.json")["rows"]}
    for r in rows:
        st = r["item"]["snapshot"]
        if st["cadence"] != "monthly" or st["date"] < "2024-10-01":
            continue
        res["archive"][0] += 1
        o = months.get(st["date"][:7])
        ms = o["item"]["month_stats"] if o else None
        if not ms or (ms["pending_mdls"], ms["pending_actions"], ms["total_actions"], ms["report_date"]) != (st["pending_mdls"], st["pending_actions"], st["total_actions"], st["date"]):
            fail("archive", {"date": st["date"], "kind": "month"})
    for mid, o in old_mdls.items():
        n = new_mdls.get(f"mdl:{mid}")
        old_pts = {p["report_date"]: (p["pending"], p["total"], p["district"]) for p in o["item"]["history"]["series"]}
        new_pts = {p["date"]: (p["pending"], p["total"], p["district"]) for p in (n["item"]["series"]["points"] if n else []) if p["date"] >= "2024-10-01"}
        res["archive"][0] += 1
        if old_pts != new_pts:
            fail("archive", {"mdl": mid, "only_old": sorted(set(old_pts) - set(new_pts))[:3], "only_new": sorted(set(new_pts) - set(old_pts))[:3],
                             "differ": [d for d in old_pts if d in new_pts and old_pts[d] != new_pts[d]][:3]})
    # derived metrics recomputed with plain loops
    prev = {}
    for r in sorted(rows, key=lambda r: r["item"]["snapshot"]["date"]):
        st = r["item"]["snapshot"]
        data = r["item"]["rows"]
        tot = sum(x[1] for x in data)
        by = {}
        for _m, pend, _t, d in data:
            by[d] = by.get(d, 0) + pend
        hhi = round(sum((100.0 * v / tot) ** 2 for v in by.values()), 1) if tot else None
        top10 = round(100.0 * sum(sorted((x[1] for x in data), reverse=True)[:10]) / tot, 6) if tot else None
        res["derived"][0] += 1
        if hhi != (st["district"] or {}).get("hhi") or top10 != st["top10_share_pct"]:
            fail("derived", {"date": st["date"], "hhi": [hhi, (st["district"] or {}).get("hhi")], "top10": [top10, st["top10_share_pct"]]})
        fam = st["cadence"]
        pv = prev.get(fam)
        if pv is not None:
            a = {x[0]: x for x in pv}
            b = {x[0]: x for x in data}
            both = set(a) & set(b)
            ctc = sum(b[m][2] - a[m][2] for m in both)
            f = st["flows"]
            res["derived"][0] += 1
            if f is None or f["continuing_total_change"] != ctc or sorted(set(b) - set(a)) != f["entered"] or sorted(set(a) - set(b)) != f["left"]:
                fail("derived", {"date": st["date"], "flows": [ctc, f and f["continuing_total_change"]]})
        prev[fam] = data
    # spot checks with page numbers: 20 figures spread over the series
    picks = rows[:: max(1, len(rows) // 10)][:10]
    for r in picks:
        st = r["item"]["snapshot"]
        data, _t = texts[st["source_url"]]
        top = st["top10"][0]
        n_pages = pages(data)
        for label, needle, values in (("national totals", "Report Totals", [st["printed"]["dockets"], st["printed"]["pending"], st["printed"]["total"]]),
                                      (f"MDL {top['mdl']} pending", f"MDL -{top['mdl']}", [top["pending"]])):
            found = None
            for pg in range(1, n_pages + 1):
                pt = " ".join(raw_text(data, pg, pg).split())
                key = needle if needle == "Report Totals" else None
                idx = pt.find(needle) if key else max(pt.find(f"MDL -{top['mdl']}"), pt.find(f"MDL - {top['mdl']}"))
                if idx >= 0:
                    excerpt = pt[idx: idx + 220]
                    found = {"page": pg, "excerpt": excerpt, "match": all(c(v) in excerpt or str(v) in excerpt for v in values)}
                    break
            res["spot"].append({"report": st["source_url"].rsplit("/", 1)[-1], "date": st["date"], "figure": label, "values": values, **(found or {"page": None, "match": False})})
    summary = {k: ({"checked": v[0], "failed": len(v[1]), "failures": v[1][:20]} if k != "spot" else {"checked": len(v), "mismatches": sum(1 for s in v if not s["match"]), "items": v}) for k, v in res.items()}
    (B / "verification.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("checked", "failed", "mismatches")} for k, v in summary.items()}))
    bad = sum(v.get("failed", 0) + v.get("mismatches", 0) for v in summary.values())
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
