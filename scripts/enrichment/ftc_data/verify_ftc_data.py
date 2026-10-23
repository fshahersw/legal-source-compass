"""Independent re-derivation of the ftc_data build files from the stored raw files, by a second code path.

  python3 -I -B scripts/enrichment/ftc_data/verify_ftc_data.py

Nothing here imports the parsers or aggregators the builders use (hsr_parse, dnc_agg, dnc_csv, index_parse): HSR CSVs are read
with the csv module, API pages with json, the Do Not Call files with pandas, listing pages with regular expressions. Every
comparison is counted; the script prints the number of values compared and the number that differ per dataset and exits 1
if any differ. Writes private/build/ftc_data/verify_log.json.
"""
import csv
import glob
import gzip
import html as htmllib
import io
import json
import os
import re
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "ftc_data")
BUILD = os.path.join(ROOT, "private", "build", "ftc_data")
FAILS = []
COMPARED = {}


def load(dataset):
    with open(os.path.join(BUILD, f"{dataset}.json"), encoding="utf-8") as handle:
        return json.load(handle)


def check(group, label, got, want):
    COMPARED[group] = COMPARED.get(group, 0) + 1
    if got != want:
        FAILS.append({"group": group, "what": label, "built": got, "raw": want})


# --------------------------------------------------------------------------------------------------------------------
def verify_hsr_filings():
    d = load("ftc_hsr_filings")
    by_id = {r["id"]: r for r in d["rows"]}
    fy_rows = list(csv.reader(io.StringIO(open(os.path.join(ACQ, "files", "HSR-Transactions-Filings-Second-Requests-by-FY.csv"), encoding="utf-8").read())))
    head = fy_rows[0]
    col = {name: i for i, name in enumerate(head)}
    for r in fy_rows[1:]:
        fy = int(r[col["FY"]])
        item = by_id[f"fy-{fy}"]["item"]["metrics"]
        for name, key in (("TransactionsReported", "transactions_reported"), ("FilingsReceived", "filings_received"), ("AdjustedTransactions", "adjusted_transactions"), ("SecondRequestTotal", "second_requests_total"), ("SecondRequestFTC", "second_requests_ftc"), ("SecondRequestDOJ", "second_requests_doj"), ("EarlyTerminationTransactions", "et_requested"), ("EarlyTerminationTransactionsGranted", "et_granted"), ("EarlyTerminationTransactionsNotGranted", "et_not_granted")):
            check("hsr_filings", f"FY{fy} {key}", item[key], int(r[col[name]]))
        a = by_id[f"fy-{fy}"]["item"]["analytics"]
        sr, adj = int(r[col["SecondRequestTotal"]]), int(r[col["AdjustedTransactions"]])
        check("hsr_filings", f"FY{fy} second_request_rate_pct", a["second_request_rate_pct"], round(sr / adj * 100, 2))
    seen = {}
    with open(os.path.join(ACQ, "files", "HSR-Merger-Transactions-by-Month.csv"), encoding="utf-8") as handle:
        for r in list(csv.reader(handle))[1:]:
            fy, m, n = int(r[0]), int(r[1]), int(r[2])
            seen.setdefault((fy, m), []).append(n)
    months_expected = {k: v[0] for k, v in seen.items() if len(set(v)) == 1}
    month_rows = [r for r in d["rows"] if r["item"].get("kind") == "month"]
    check("hsr_filings", "month row count", len(month_rows), len(months_expected))
    for (fy, m), n in months_expected.items():
        year = fy - 1 if m >= 10 else fy
        row = by_id.get(f"month-{year}-{m:02d}")
        check("hsr_filings", f"month {year}-{m:02d} exists", row is not None, True)
        if row:
            check("hsr_filings", f"month {year}-{m:02d} count", row["item"]["count"], n)


# --------------------------------------------------------------------------------------------------------------------
def verify_hsr_notices():
    d = load("ftc_hsr_early_terminations")
    raw = {}
    for path in glob.glob(os.path.join(ACQ, "hsr", "pages", "*.json.gz")):
        doc = json.loads(gzip.open(path).read())
        for rec in doc["data"]:
            raw[rec["id"]] = rec["attributes"]
    notices = [r for r in d["rows"] if r["item"].get("kind") == "notice"]
    by_api = {r["item"]["notice"]["api_id"]: r for r in notices}
    empty = [k for k, a in raw.items() if not any(a.get(x) for x in ("transaction-number", "acquiring-party", "acquired-party", "date"))]
    check("hsr_notices", "distinct raw records = notices + empty records", len(raw), len(notices) + len(empty))
    check("hsr_notices", "empty records set aside", len(empty), d["summary"]["empty_records_excluded"])
    for api_id, row in by_api.items():
        a = raw[api_id]
        n = row["item"]["notice"]
        collapse = lambda v: " ".join(str(v).split()) if v else None  # noqa: E731
        check("hsr_notices", f"{api_id[:8]} transaction", n["transaction_number"], collapse(a.get("transaction-number")))
        check("hsr_notices", f"{api_id[:8]} date", n["date"], collapse(a.get("date")))
        check("hsr_notices", f"{api_id[:8]} acquiring", n["acquiring_party"], collapse(a.get("acquiring-party")))
        check("hsr_notices", f"{api_id[:8]} acquired", n["acquired_party"], collapse(a.get("acquired-party")))
        check("hsr_notices", f"{api_id[:8]} entities", n["acquired_entities"], [collapse(e) for e in a.get("acquired-entities", []) if collapse(e)])
    # the series row is re-counted from the stored rows, not from the raw pages
    series = next(r for r in d["rows"] if r["id"] == "series-by-year")["item"]["series"]
    cal, fy = {}, {}
    for r in notices:
        date = r["item"]["notice"]["date"]
        if date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            y, m = int(date[:4]), int(date[5:7])
            cal[str(y)] = cal.get(str(y), 0) + 1
            f = str(y + 1 if m >= 10 else y)
            fy[f] = fy.get(f, 0) + 1
    check("hsr_notices", "series calendar years", series["calendar_year"], dict(sorted(cal.items())))
    check("hsr_notices", "series fiscal years", series["fiscal_year"], dict(sorted(fy.items())))
    ids = [r["id"] for r in d["rows"]]
    check("hsr_notices", "row ids unique", len(ids), len(set(ids)))


# --------------------------------------------------------------------------------------------------------------------
def verify_dnc():
    d = load("ftc_dnc_reported_calls")
    pop = json.load(open(os.path.join(BUILD, "lookups", "census_pop_state.json")))["population"]
    frames = [pd.read_csv(p, dtype=str, keep_default_na=False) for p in sorted(glob.glob(os.path.join(ACQ, "files", "DNC_Complaint_Numbers_*.csv")))]
    df = pd.concat(frames, ignore_index=True)
    df["day"] = df["Created_Date"].str.slice(0, 10)
    df["month"] = df["Created_Date"].str.slice(0, 7)
    df["flag"] = df["Recorded_Message_Or_Robocall"].str.strip()
    df["state"] = df["Consumer_State"].str.split().str.join(" ")
    df["subject"] = df["Subject"].str.split().str.join(" ")
    rows = {r["id"]: r for r in d["rows"]}
    names = {}
    for r in d["rows"]:
        if r["item"].get("kind") == "state":
            names[r["item"]["usps"]] = r["title"].split(":")[0]
    for month, g in df.groupby("month"):
        us = rows.get(f"US-{month}")
        check("dnc", f"US-{month} exists", us is not None, True)
        if not us:
            continue
        m = us["item"]["metrics"]
        check("dnc", f"US-{month} calls", m["calls"], len(g))
        check("dnc", f"US-{month} robocalls", m["robocalls"], int((g["flag"] == "Y").sum()))
        check("dnc", f"US-{month} not robocalls", m["not_robocalls"], int((g["flag"] == "N").sum()))
        check("dnc", f"US-{month} no flag", m["no_flag"], int((~g["flag"].isin(["Y", "N"])).sum()))
        check("dnc", f"US-{month} days covered", us["item"]["days_covered"], int(g["day"].nunique()))
        subj = g.groupby("subject").size().to_dict()
        check("dnc", f"US-{month} subjects", us["item"]["subjects"], {k: int(v) for k, v in subj.items()})
        y, n = int((g["flag"] == "Y").sum()), int((g["flag"] == "N").sum())
        check("dnc", f"US-{month} robocall share", us["item"]["analytics"]["robocall_share_pct"], round(y / (y + n) * 100, 2))
        by_state = g.groupby("state").size().to_dict()
        in_states = 0
        for usps, name in names.items():
            sg = by_state.get(name, 0)
            row = rows.get(f"{usps}-{month}")
            if sg:
                check("dnc", f"{usps}-{month} exists", row is not None, True)
                if row:
                    check("dnc", f"{usps}-{month} calls", row["item"]["metrics"]["calls"], int(sg))
                    check("dnc", f"{usps}-{month} per100k", row["item"]["analytics"]["per100k"], round(sg / pop[usps] * 100000, 1))
                    in_states += int(sg)
        unassigned = sum(us["item"]["unassigned_state"].values())
        check("dnc", f"US-{month} states + unassigned = national", in_states + unassigned, len(g))


# --------------------------------------------------------------------------------------------------------------------
def main_region(text):
    """The page's <main> element only: the site footer repeats four 'latest news' views-row blocks on every page."""
    a, b = text.find("<main"), text.rfind("</main>")
    return text[a:b] if a >= 0 and b > a else text


def pages(stem):
    out = []
    for path in sorted(glob.glob(os.path.join(ACQ, "pages", f"{stem}_p*.html.gz"))):
        out.append(main_region(gzip.open(path).read().decode("utf-8", "replace")))
    return out


def verify_index():
    d = load("ftc_publications_index")
    rows = {r["id"]: r for r in d["rows"]}
    counts = {}
    for r in d["rows"]:
        counts[r["item"]["series"]] = counts.get(r["item"]["series"], 0) + 1
    for series, stem in (("spotlight", "data_spotlight"), ("commission-staff", "rep_commission_staff"), ("economic-reports", "rep_economic_reports"), ("economic-issue-papers", "rep_economic_issue_papers")):
        html = pages(stem)
        n = sum(len(re.findall(r'<div class="views-row">', h)) for h in html)
        empty_banners = sum(len(re.findall(r'<div class="views-row">\s*<article[^>]*>\s*<div class="node__content">\s*</div>\s*</article>\s*</div>', h)) for h in html)
        check("index", f"{series} item count", counts.get(series, 0), n - empty_banners)
    # every Data Spotlight title and date shown appears in the stored listing text
    text = " ".join(pages("data_spotlight"))
    plain = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", text)))
    for r in d["rows"]:
        if r["item"]["series"] == "spotlight":
            check("index", f"spotlight title in page: {r['id'][:30]}", r["title"] in plain, True)
            check("index", f"spotlight date in page: {r['id'][:30]}", (r["item"]["published_display"] or "") in plain, True)
    c = load("ftc_sentinel_contributors")
    html = open_gz("csn_data_contributors.html")
    plain = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", html.replace("<br/>", "\n").replace("<br>", "\n"))))
    for r in c["rows"]:
        check("contributors", f"name in page: {r['title'][:30]}", r["title"] in plain, True)
    check("contributors", "row count = contributors + referrers", len(c["rows"]), c["summary"]["contributors"] + c["summary"]["referrers"])


def open_gz(name):
    return gzip.open(os.path.join(ACQ, "pages", name + ".gz")).read().decode("utf-8", "replace")


def verify_catalog():
    d = load("ftc_open_data_catalog")
    views = json.load(open(os.path.join(ACQ, "tableau", "_views.json")))
    dash = [r for r in d["rows"] if r["item"]["kind"] == "dashboard"]
    check("catalog", "dashboard rows = views checked", len(dash), len(views))
    by_url = {r["source_url"]: r for r in dash}
    for v in views:
        r = by_url[v["view_url"]]
        want = "Yes, data returned" if v["status"] == 200 and v["bytes"] > 2 else "Offered, but the download is empty" if v["status"] == 200 else f"No (the download request answered HTTP {v['status']})"
        check("catalog", f"{v['workbook']}/{v['view']} download state", r["item"]["cells"]["download"], want)
        # the stored response bytes still hash to the recorded value
        path = os.path.join(ROOT, v["path"])
        import hashlib

        check("catalog", f"{v['workbook']}/{v['view']} sha256", hashlib.sha256(open(path, "rb").read()).hexdigest(), v["sha256"])
    html = open_gz("open_gov_data_sets.html")
    links = set(re.findall(r'href="(/system/files/[^"]+\.(?:csv|xlsx|xls|zip|pdf))"', html))
    files = [r for r in d["rows"] if r["item"]["kind"] == "download"]
    listed = {re.sub(r"^https://www\.ftc\.gov", "", r["item"]["url"]) for r in files}
    dict_links = {l for l in links if "dictionary" in l.lower()}
    check("catalog", "every downloadable file link on the FTC page is a row (dictionaries are columns of their data set's row)", sorted(links - dict_links - listed), [])


def main():
    steps = [("hsr_filings", verify_hsr_filings), ("hsr_notices", verify_hsr_notices), ("dnc", verify_dnc), ("index", verify_index), ("catalog", verify_catalog)]
    only = set(sys.argv[1:])
    for name, fn in steps:
        if only and name not in only:
            continue
        try:
            fn()
        except FileNotFoundError as err:
            FAILS.append({"group": name, "what": "missing input", "built": str(err), "raw": None})
    log = {"compared": COMPARED, "differences": len(FAILS), "examples": FAILS[:25]}
    with open(os.path.join(BUILD, "verify_log.json"), "w", encoding="utf-8") as handle:
        json.dump(log, handle, indent=1)
    print(json.dumps({"compared": COMPARED, "differences": len(FAILS)}))
    for f in FAILS[:15]:
        print("DIFF", f)
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
