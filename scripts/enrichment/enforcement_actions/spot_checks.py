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
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import enf_common as ec  # noqa: E402
import extract as ex  # noqa: E402
import verify_enforcement_actions as v  # noqa: E402


def pick(rows, n, key="id"):
    return sorted(rows, key=lambda r: hashlib.sha256(r[key].encode()).hexdigest())[:n]


def squash(s):
    return re.sub(r"\s+", " ", s)


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
        # the amount the builder used: equal value, resolution keyword, not a stock paragraph (another figure in the
        # release can state the same value in a different sentence, e.g. an alleged loss equal to the forfeiture)
        same = [x for x in rel["amounts"] if x.get("value_usd") == rel["max_resolution_amount_usd"]]
        a = next((x for x in same if x.get("keyword") in ex.RESOLUTION_KINDS and not x.get("boilerplate")),
                 same[0] if same else rel["amounts"][0])
        fname, rec = raw[rel["uuid"]]
        text = squash(v.soup_text(rec["body"]))
        sentence = squash(a.get("sentence") or "")
        i = sentence.find(a["as_written"])
        needle = sentence[max(0, i - 40):i + len(a["as_written"])] if i >= 0 else a["as_written"]
        add("doj_press_releases_" + rel["date"][:4], r["id"], f"resolution figure ({a.get('keyword')})", a["as_written"],
            f"{fname} uuid {rel['uuid'][:8]}: {context(text, needle)}", needle in text)
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
    headline_checks(pages, overview)


DETROL = "doj-pr:a3f68cd2-6d87-4358-b700-eb02ab7a5da4"  # "Pfizer to Pay $14.5 Million ..." (2011-10-21)
HEADLINE_PICKS = [("title", True, 6), ("first resolution sentence", True, 5), ("title", False, 4),
                  ("first resolution sentence", False, 4)]


def headline_checks(pages, overview):
    """20 DOJ headline figures (the Detrol release plus deterministic picks across all years: title / first resolution
    sentence, differing from the largest figure or not), each located in the raw release (title or body text)."""
    picks = {k: [] for k in HEADLINE_PICKS}
    fixed = []
    for p in overview["partitions"]:
        b = v.load_build(p["dataset"])
        for r in b["rows"]:
            rel = r["item"]["release"]
            h = rel.get("headline_figure")
            if r["id"] == DETROL:
                fixed.append(r)
            if not h or r["id"] == DETROL:
                continue
            for key in HEADLINE_PICKS:
                if h["source"] == key[0] and bool(h.get("differs_from_largest")) == key[1]:
                    picks[key].append((hashlib.sha256(r["id"].encode()).hexdigest(), r))
                    picks[key] = sorted(picks[key], key=lambda x: x[0])[:key[2]]
        del b
    chosen = fixed + [r for key in HEADLINE_PICKS for _, r in picks[key]]
    wanted = {r["item"]["release"]["uuid"] for r in chosen}
    raw = {}
    for fname in sorted(os.listdir(pages)):
        for r in json.loads(gzip.open(os.path.join(pages, fname)).read()).get("results") or []:
            if r.get("uuid") in wanted and (r["uuid"] not in raw or (r.get("changed") or "") > (raw[r["uuid"]][1].get("changed") or "")):
                raw[r["uuid"]] = (fname, r)
    out = ["", "Headline figures (DOJ)", "",
           "| # | record | title | headline figure (source) | largest resolution figure stated | where in the source | match |",
           "|---|---|---|---|---|---|---|"]
    bad = 0
    for i, r in enumerate(chosen, 1):
        rel = r["item"]["release"]
        h = rel["headline_figure"]
        fname, rec = raw[rel["uuid"]]
        if h["source"] == "title":
            title = squash(v.BeautifulSoup(rec.get("title") or "", "html.parser").get_text())
            ok = h["as_written"] in title
            where = f"{fname} title: {title}"
        else:
            body = squash(v.soup_text(rec.get("body")))
            sentence = squash(h.get("sentence") or "")
            ok = h["as_written"] in sentence and sentence in body
            where = f"{fname} body: {context(body, sentence[:160]) or 'sentence not found'}"
        bad += not ok
        largest = rel["max_resolution_amount_usd"]
        out.append(f"| {i} | {r['id']} | {r['title'].replace('|', '/')} | {h['as_written']} ({h['source']}) | "
                   f"{'$' + format(largest, ',.2f') if largest is not None else 'none'}{' (differs)' if h.get('differs_from_largest') else ''} | "
                   f"{where.replace('|', '/')} | {'yes' if ok else 'NO'} |")
    print("\n".join(out))
    print(f"\n{len(chosen)} headline spot checks, {bad} not found verbatim")


if __name__ == "__main__":
    main()
