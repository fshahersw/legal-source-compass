"""Spot checks for REPORT.md: displayed figures compared with the raw source, one row per check.

  python3 -I -B scripts/enrichment/enforcement_actions/spot_checks.py > private/build/enforcement_actions/spot_checks.md

Deterministic picks (sha256 order) across the datasets: DOJ resolution figures, SEC civil action numbers and courts,
FTC ordered amounts, FTC case docket numbers and settlement deadlines/amounts. Each value is looked up in the raw file
it came from (BeautifulSoup text of the raw HTML/JSON body, or the CSV/XLSX cell) and the location is printed.
"""
import gzip
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402
import verify_enforcement_actions as v  # noqa: E402


def pick(rows, n, key="id"):
    return sorted(rows, key=lambda r: hashlib.sha256(r[key].encode()).hexdigest())[:n]


def context(text, needle, width=60):
    i = text.find(needle)
    if i < 0:
        return None
    return "…" + text[max(0, i - width):i + len(needle) + width].replace("|", "/") + "…"


def main():
    out = ["| # | dataset | record | field | displayed value | where in the source | match |", "|---|---|---|---|---|---|---|"]
    n = 0

    def add(ds, rid, field, value, where, ok):
        nonlocal n
        n += 1
        out.append(f"| {n} | {ds} | {rid} | {field} | {value} | {where or 'not found'} | {'yes' if ok else 'NO'} |")

    # DOJ: releases with a resolution figure
    pages = os.path.join(ec.ACQ, "doj", "pages")
    index = v.load_build("doj_press_releases")
    overview = next(r for r in index["rows"] if r["id"] == "doj-index:overview")["item"]["overview"]
    cands = []
    for p in overview["partitions"][-6:]:
        b = v.load_build(p["dataset"])
        cands += pick([r for r in b["rows"] if r["item"]["release"]["max_resolution_amount_usd"]], 6)
        del b
    chosen = pick(cands, 6)
    wanted = {r["item"]["release"]["uuid"] for r in chosen}
    raw = {}
    for fname in sorted(os.listdir(pages)):
        for r in json.loads(gzip.open(os.path.join(pages, fname)).read()).get("results") or []:
            if r.get("uuid") in wanted and (r["uuid"] not in raw or (r.get("changed") or "") > (raw[r["uuid"]][1].get("changed") or "")):
                raw[r["uuid"]] = (fname, r)
    for r in chosen:
        rel = r["item"]["release"]
        a = next(x for x in rel["amounts"] if x.get("value_usd") == rel["max_resolution_amount_usd"]) if any(x.get("value_usd") == rel["max_resolution_amount_usd"] for x in rel["amounts"]) else rel["amounts"][0]
        fname, rec = raw[rel["uuid"]]
        text = v.soup_text(rec["body"])
        add("doj_press_releases_" + rel["date"][:4], r["id"], f"resolution figure ({a.get('keyword')})", a["as_written"],
            f"{fname} uuid {rel['uuid'][:8]}: {context(text, a['as_written'])}", a["as_written"] in text)
    # SEC litigation releases with a civil action number
    sec = v.load_build("sec_enforcement_actions")
    lr = ec.PackReader(os.path.join(ec.ACQ, "sec", "releases"))
    rows = [r for r in sec["rows"] if r["id"].startswith("sec-lr:") and r["item"]["sec_action"]["civil_actions"]]
    for r in pick(rows, 4):
        s = r["item"]["sec_action"]
        text = v.soup_text(lr.get(s["url"]).decode("utf-8", "replace"))
        c = s["civil_actions"][0]["as_written"]
        add("sec_enforcement_actions", r["id"], "civil action number", c, f"{s['url']}: {context(text, c)}", c in text)
        if s["courts"]:
            ct = s["courts"][0]
            add("sec_enforcement_actions", r["id"], f"court ({ct.get('court_id')})", ct["as_written"], f"{s['url']}: {context(text, ct['as_written'])}", v.squash(ct["as_written"]) in text)
    # FTC consumer-protection penalties: workbook cells
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(gzip.open(os.path.join(ec.ACQ, "ftc", "files", "civil_penalty_cases_fy2000-2026.xlsx.gz")).read()), read_only=True, data_only=True)
    cells = list(wb.worksheets[0].iter_rows(values_only=True))
    ftc = v.load_build("ftc_enforcement_actions")
    pen = [r for r in ftc["rows"] if r["item"]["ftc_action"]["kind"] == "bcp_penalty" and r["item"]["ftc_action"]["ordered_amount"]]
    for r in pick(pen, 3):
        a = r["item"]["ftc_action"]
        row = cells[a["line"] - 1]
        add("ftc_enforcement_actions", r["id"], "ordered amount", f"{a['ordered_amount']:,.2f}",
            f"civil_penalty_cases_fy2000-2026.xlsx row {a['line']}: {row[0]} / {row[1]} / {row[3]}", abs(float(row[3]) - a["ordered_amount"]) < 0.01 and str(row[1]).strip() == a["name"])
    # FTC cases: docket / civil action numbers
    cases = v.load_build("ftc_cases")
    creader = ec.PackReader(os.path.join(ec.ACQ, "ftc", "cases"))
    read = [r for r in cases["rows"] if r["item"]["ftc_case"]["page_read"] and (r["item"]["ftc_case"]["civil_action_numbers"] or r["item"]["ftc_case"]["docket_numbers"])]
    for r in pick(read, 3):
        c = r["item"]["ftc_case"]
        val = (c["civil_action_numbers"] or c["docket_numbers"])[0]
        text = v.soup_text(creader.get(c["url"]).decode("utf-8", "replace"))
        add("ftc_cases", r["id"], "civil action / docket number", val, f"{c['url']}: {context(text, val)}", val in text)
    # settlements: deadlines and amounts on the official page
    st = v.load_build("settlement_claims_official")
    sreader = ec.PackReader(os.path.join(ec.ACQ, "settlesignal", "official_pages"))
    rows = [r for r in st["rows"] if r["item"]["settlement"]["deadline"].get("status") == "confirmed"]
    for r in pick(rows, 3):
        s = r["item"]["settlement"]
        text = v.soup_text(sreader.get(s["official_url"]).decode("utf-8", "replace"))
        d = s["deadline"]["as_written"]
        add("settlement_claims_official", r["id"], f"claim deadline {s['deadline']['date']}", d, f"{s['official_url']}: {context(text, d)}", d in text)
    rows = [r for r in st["rows"] if r["item"]["settlement"]["amounts"]]
    for r in pick(rows, 2):
        s = r["item"]["settlement"]
        text = v.soup_text(sreader.get(s["official_url"]).decode("utf-8", "replace"))
        a = s["amounts"][0]["page_as_written"]
        add("settlement_claims_official", r["id"], "dollar figure", a, f"{s['official_url']}: {context(text, a)}", a in text)
    print("\n".join(out))
    print(f"\n{n} spot checks, {sum(1 for line in out[2:] if line.endswith('| NO |'))} mismatches")


if __name__ == "__main__":
    main()
