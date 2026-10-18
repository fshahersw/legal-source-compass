"""Independent spot-check of the SaferProducts.gov build files against the raw export.

  python3 -I -B scripts/enrichment/saferproducts/verify_saferproducts.py

Deliberately imports NOTHING from spdb_lib / analysis / crosscheck / build_saferproducts: it re-reads the raw
IncidentReports.csv and Recalls.csv members with its own csv code, takes the DISPLAYED figures out of the built
facts/cells (the text a visitor would read), recomputes each from the raw rows, and compares. Results go to
private/build/saferproducts/spot_checks.json; a mismatch must carry an explanation or the run exits non-zero.

It also runs structural checks on every build file (unique ids, source URLs, 'unverified' labelling, link targets,
contact-like text, totals that must add up to the report count).
"""
import collections
import csv
import datetime as dt
import gzip
import io
import json
import math
import os
import re
import statistics
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "saferproducts", "members")
BUILD = os.path.join(ROOT, "private", "build", "saferproducts")
LOOK = os.path.join(BUILD, "lookups")
csv.field_size_limit(10 ** 8)

DS = ["saferproducts_reports_series", "saferproducts_products", "saferproducts_companies", "saferproducts_recalls_crosscheck"]
NR = "Not recorded"


# ------------------------------------------------------------------ raw readers (own code)

def read_text(name):
    raw = gzip.open(os.path.join(ACQ, name + ".gz"), "rb").read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="surrogateescape")
    return text[1:] if text.startswith("﻿") else text


def collapse(s):
    return " ".join((s or "").split())


def mdy(s):
    s = collapse(s).split(" ")[0]
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if not m:
        return None
    try:
        return dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def load_reports():
    rows = csv.reader(io.StringIO(read_text("IncidentReports.csv"), newline=""))
    header, out, seen = None, [], set()
    for row in rows:
        if header is None:
            if row and row[0].strip() == "Report No.":
                header = [c.strip() for c in row]
            continue
        if len(row) != len(header) or not any(c.strip() for c in row):
            continue
        rec = dict(zip(header, row))
        number = collapse(rec["Report No."])
        if number in seen:
            continue
        seen.add(number)
        out.append({
            "no": number, "rep": mdy(rec["Report Date"]), "sent": mdy(rec["Sent to Manufacturer / Importer / Private Labeler"]), "pub": mdy(rec["Publication Date"]),
            "cat": collapse(rec["Product Category"]), "sub": collapse(rec["Product Sub Category"]), "ptype": collapse(rec["Product Type"]), "pcode": collapse(rec["Product Code"]),
            "mfr": collapse(rec["Manufacturer / Importer / Private Labeler Name"]), "brand": collapse(rec["Brand"]), "model": collapse(rec["Model Name or Number"]),
            "retailer": collapse(rec["Retailer"]), "state": collapse(rec["State"]), "sev": collapse(rec["(Primary) Victim Severity"]),
            "age": collapse(rec["(Primary) Victim's Age (years)"]), "comment": bool(collapse(rec["Company Comments"])), "desc": rec["Incident Description"] or "",
            "pdesc": collapse(rec["Product Description"]),
        })
    return out


def load_recalls():
    rows = csv.reader(io.StringIO(read_text("Recalls.csv"), newline=""))
    header, kind, out = None, None, []
    for row in rows:
        if row and row[0].strip() == "Title":
            header, kind = [c.strip() for c in row], row[3].strip()
            continue
        if header is None or len(row) != len(header):
            continue
        rec = dict(zip(header, row))
        out.append({"number": collapse(rec[kind]), "date": mdy(rec["Date"]), "kind": "repair" if kind == "Repair Number" else "recall"})
    return out


def load_build(ds):
    with open(os.path.join(BUILD, ds + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


# ------------------------------------------------------------------ helpers over the build files

def index(build):
    return {r["id"]: r for r in build["rows"]}


def fact(row, key):
    for k, v in row["detail"]["facts"]:
        if k == key:
            return v
    raise KeyError("%s: no fact %r" % (row["id"], key))


def num(text):
    return int(text.replace(",", ""))


def first_num(text):
    return num(re.search(r"\d[\d,]*", text).group(0))


def pctval(text):
    return float(re.search(r"([+-]?\d+(?:\.\d+)?)%", text).group(1))


def text_key(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").casefold()).strip()


class Checks:
    def __init__(self):
        self.rows = []

    def add(self, cid, what, where_displayed, where_raw, displayed, recomputed, explain=None):
        if isinstance(displayed, float) or isinstance(recomputed, float):
            ok = displayed is not None and recomputed is not None and round(float(displayed), 2) == round(float(recomputed), 2)
        else:
            ok = displayed == recomputed
        self.rows.append({"id": cid, "figure": what, "displayed_in": where_displayed, "recomputed_from": where_raw,
                          "displayed": displayed, "recomputed": recomputed, "match": bool(ok), "explanation": explain if not ok else None})
        return ok


def main():
    t0 = dt.datetime.now()
    reports = load_reports()
    recalls = load_recalls()
    built = {ds: load_build(ds) for ds in DS}
    series, products, companies, xcheck = (index(built[d]) for d in DS)
    C = Checks()
    N = len(reports)
    pub_max = max(r["pub"] for r in reports if r["pub"])
    cutoff = (pub_max.month, pub_max.day)
    by_pub_year = collections.Counter(r["pub"].year for r in reports if r["pub"])
    by_rep_year = collections.Counter(r["rep"].year for r in reports if r["rep"])

    # ---------------------------------------------------------------- series
    s = series["saferproducts-summary"]
    C.add("S01", "all published reports", "series summary > Reports in the export", "IncidentReports.csv data rows (unique Report No.)", first_num(fact(s, "Reports in the export")), N)
    pk = re.search(r"(\d{4}) with ([\d,]+) reports", fact(s, "Peak publication year (complete years)"))
    complete_years = [y for y in by_pub_year if y < pub_max.year]
    top_year = max(complete_years, key=lambda y: (by_pub_year[y], -y))
    C.add("S02", "peak publication year among complete years", "series summary > Peak publication year", "count by year of Publication Date", (int(pk.group(1)), num(pk.group(2))), (top_year, by_pub_year[top_year]))
    p19 = series["sp-pub-2019"]
    C.add("S03", "reports published in 2019", "sp-pub-2019 > Reports", "Publication Date year 2019", first_num(fact(p19, "Reports")), by_pub_year[2019])
    C.add("S04", "YoY 2019 vs 2018 (published)", "sp-pub-2019 > Reports", "(3028 - 2018 count) / 2018 count", pctval(fact(p19, "Reports")), round(100.0 * (by_pub_year[2019] - by_pub_year[2018]) / by_pub_year[2018], 2))
    p25 = series["sp-pub-2025"]
    C.add("S05", "reports published in 2025 and YoY", "sp-pub-2025 > Reports", "Publication Date year 2025 vs 2024",
          (first_num(fact(p25, "Reports")), pctval(fact(p25, "Reports"))), (by_pub_year[2025], round(100.0 * (by_pub_year[2025] - by_pub_year[2024]) / by_pub_year[2024], 2)))
    p26 = series["sp-pub-2026"]
    ytd = fact(p26, "Year to date")
    mm = re.match(r"([\d,]+) through (\d\d)-(\d\d) vs ([\d,]+) same window 2025 \(([+-][\d.]+)%\); vs ([\d,]+) in 2019 \(([+-][\d.]+)%\)", ytd)
    in_win = lambda r, y: r["pub"] and r["pub"].year == y and (r["pub"].month, r["pub"].day) <= cutoff  # noqa: E731
    y26, y25, y19 = (sum(1 for r in reports if in_win(r, y)) for y in (2026, 2025, 2019))
    C.add("S06", "2026 year-to-date vs same window 2025 and 2019", "sp-pub-2026 > Year to date", "Publication Date on/before the latest publication month-day (%02d-%02d)" % cutoff,
          (num(mm.group(1)), mm.group(2) + "-" + mm.group(3), num(mm.group(4)), float(mm.group(5)), num(mm.group(6)), float(mm.group(7))),
          (y26, "%02d-%02d" % cutoff, y25, round(100.0 * (y26 - y25) / y25, 2), y19, round(100.0 * (y26 - y19) / y19, 2)))
    ex = re.match(r"Excluding (.+?) \(([\d,]+) reports this year\): ([\d,]+) vs ([\d,]+) in the same window of (\d{4}) \(([+-][\d.]+)%\)", fact(p26, "Year to date without the largest manufacturer string"))
    name = ex.group(1)
    removed = sum(1 for r in reports if in_win(r, 2026) and r["mfr"] == name)
    top26 = collections.Counter(r["mfr"] for r in reports if in_win(r, 2026) and r["mfr"].lower() not in ("", "unknown", "n/a")).most_common(1)[0]
    prior_wo = sum(1 for r in reports if in_win(r, 2025) and r["mfr"] != name)
    C.add("S07", "2026 year-to-date without the largest manufacturer string", "sp-pub-2026 > Year to date without the largest manufacturer string", "same window, mfr != largest 2026 string",
          (name, num(ex.group(2)), num(ex.group(3)), num(ex.group(4))), (top26[0], removed, y26 - removed, prior_wo))
    deaths = sum(1 for r in reports if r["sev"] == "Death")
    inj = sum(1 for r in reports if r["sev"].startswith("Injury,"))
    C.add("S08", "reports with a Death primary victim", "series summary > Deaths", "(Primary) Victim Severity == Death", first_num(fact(s, "Deaths")), deaths)
    C.add("S09", "reports with an Injury primary victim (six levels)", "series summary > Injuries", "(Primary) Victim Severity starts 'Injury,'", first_num(fact(s, "Injuries")), inj)
    kit = sum(1 for r in reports if r["cat"] == "Kitchen")
    cat_text = fact(s, "Product categories")
    C.add("S10", "Kitchen category reports", "series summary > Product categories", "Product Category == Kitchen", num(re.search(r"Kitchen ([\d,]+)", cat_text).group(1)), kit)
    commented = sum(1 for r in reports if r["comment"])
    mc = re.match(r"([\d.]+)% \(([\d,]+) of ([\d,]+)", fact(s, "Manufacturer comment rate"))
    C.add("S11", "manufacturer comment rate overall", "series summary > Manufacturer comment rate", "Company Comments non-blank", (float(mc.group(1)), num(mc.group(2))), (round(100.0 * commented / N, 2), commented))
    lags = sorted((r["pub"] - r["rep"]).days for r in reports if r["pub"] and r["rep"] and r["pub"] >= r["rep"])
    lg = re.match(r"median ([\d.]+) days, p90 (\d+) days \(n = ([\d,]+)", fact(s, "Report to publication lag"))
    p90 = lags[max(1, math.ceil(0.9 * len(lags))) - 1]
    med = statistics.median(lags)
    C.add("S12", "report-to-publication lag median, p90, n", "series summary > Report to publication lag", "Publication Date - Report Date; nearest-rank p90",
          (float(lg.group(1)), int(lg.group(2)), num(lg.group(3))), (float(med), p90, len(lags)))
    r26 = series["sp-rep-2026"]
    C.add("S13", "reports submitted in 2026", "sp-rep-2026 > Reports", "Report Date year 2026", first_num(fact(r26, "Reports")), by_rep_year[2026])
    ca = sum(1 for r in reports if r["state"] == "California")
    C.add("S14", "California reports", "series summary > Top states", "State == California", num(re.search(r"California ([\d,]+)", fact(s, "Top states")).group(1)), ca)

    def band(age):
        if not re.fullmatch(r"\d{1,3}(\.\d+)?", age):
            return None
        a = float(age)
        return None if a > 120 else math.floor(a)
    under1 = sum(1 for r in reports if band(r["age"]) is not None and band(r["age"]) < 1)
    C.add("S15", "victim age under 1 year", "series summary > Victim age bands", "(Primary) Victim's Age < 1", num(re.search(r"Under 1 year ([\d,]+)", fact(s, "Victim age bands")).group(1)), under1)
    c19 = sum(1 for r in reports if r["pub"] and r["pub"].year == 2019 and r["comment"])
    m19 = re.match(r"([\d.]+)% \(([\d,]+) of ([\d,]+)\)", fact(p19, "Manufacturer comment rate"))
    C.add("S16", "2019 manufacturer comment rate", "sp-pub-2019 > Manufacturer comment rate", "2019 publications with Company Comments", (float(m19.group(1)), num(m19.group(2))), (round(100.0 * c19 / by_pub_year[2019], 2), c19))
    sent_missing = sum(1 for r in reports if not r["sent"])
    sm = re.search(r"; ([\d,]+) reports have no sent date", fact(s, "Report to sent-to-manufacturer lag"))
    C.add("S17", "reports with no sent-to-manufacturer date", "series summary > Report to sent-to-manufacturer lag", "Sent to Manufacturer blank or unparseable", num(sm.group(1)), sent_missing)

    # hazard-theme counts: regex taken from the build's own theme_definitions, applied WITHOUT the builder's stem pre-filter
    defs = {d["theme"]: re.compile(d["regex"]) for d in built[DS[0]]["summary"]["theme_definitions"]}
    lowered = [r["desc"].lower().replace("’", "'") for r in reports]
    shown_themes = {t["theme"]: t["reports"] for t in s["item"]["safer"]["themes"]}
    theme_counts = {}
    for tid, rx in defs.items():
        theme_counts[tid] = sum(1 for text in lowered if text and rx.search(text))
    for i, tid in enumerate(defs, 1):
        C.add("T%02d" % i, "hazard-theme count: %s (regex hits over all descriptions, no stem pre-filter)" % tid, "series summary > themes[%s]" % tid, "regex from summary.theme_definitions over lower-cased Incident Description",
              shown_themes[tid], theme_counts[tid])

    # ---------------------------------------------------------------- products
    kit_row = products["sp-cat-kitchen"]
    kr = re.match(r"([\d,]+) \(([\d.]+)% of all ([\d,]+) reports\)", fact(kit_row, "Reports"))
    C.add("P01", "Kitchen reports and share of all", "sp-cat-kitchen > Reports", "Product Category == Kitchen", (num(kr.group(1)), float(kr.group(2)), num(kr.group(3))), (kit, round(100.0 * kit / N, 2), N))
    kd = re.match(r"([\d,]+) death reports, ([\d,]+) injury reports", fact(kit_row, "Deaths and injuries"))
    C.add("P02", "Kitchen death and injury reports", "sp-cat-kitchen > Deaths and injuries", "category Kitchen x severity",
          (num(kd.group(1)), num(kd.group(2))), (sum(1 for r in reports if r["cat"] == "Kitchen" and r["sev"] == "Death"), sum(1 for r in reports if r["cat"] == "Kitchen" and r["sev"].startswith("Injury,"))))
    kb = num(re.search(r"Kenmore ([\d,]+)", fact(kit_row, "Top brands (exact strings as recorded)")).group(1))
    C.add("P03", "Kenmore brand reports within Kitchen", "sp-cat-kitchen > Top brands", "Kitchen rows with Brand == Kenmore", kb, sum(1 for r in reports if r["cat"] == "Kitchen" and r["brand"] == "Kenmore"))
    t278 = next(r for r in products.values() if r["item"]["safer"].get("code") == "278")
    C.add("P04", "product type code 278 reports", "%s > Reports" % t278["id"], "Product Code == 278", first_num(fact(t278, "Reports")), sum(1 for r in reports if r["pcode"] == "278"))
    pc = products["sp-cat-personal-care"]
    g = re.match(r"([+-][\d.]+)% \((\d{4})–(\d{4}): ([\d,]+) reports vs (\d{4})–(\d{4}): ([\d,]+) reports", fact(pc, "Change, recent vs prior 3 complete years"))
    rec_n = sum(1 for r in reports if r["cat"] == "Personal Care" and r["pub"] and int(g.group(2)) <= r["pub"].year <= int(g.group(3)))
    pri_n = sum(1 for r in reports if r["cat"] == "Personal Care" and r["pub"] and int(g.group(5)) <= r["pub"].year <= int(g.group(6)))
    C.add("P05", "Personal Care recent vs prior 3 complete years", "sp-cat-personal-care > Change, recent vs prior", "Personal Care by Publication year windows", (float(g.group(1)), num(g.group(4)), num(g.group(7))), (round(100.0 * (rec_n - pri_n) / pri_n, 2), rec_n, pri_n))
    cl = re.search(r"largest: ([^;]+?) / ([^;]+?) ([\d,]+);", fact(kit_row, "Same-model repeat reports"))
    cl_n = sum(1 for r in reports if r["cat"] == "Kitchen" and r["brand"] == cl.group(1) and r["model"] == cl.group(2))
    C.add("P06", "largest Kitchen same-model cluster (exact brand + model strings)", "sp-cat-kitchen > Same-model repeat reports", "Kitchen rows with identical Brand and Model", (cl.group(1), cl.group(2), num(cl.group(3))), (cl.group(1), cl.group(2), cl_n))
    cats = collections.Counter(r["cat"] for r in reports)
    C.add("P07", "number of product categories", "products summary > counts.category", "distinct Product Category", built[DS[1]]["summary"]["counts"]["category"], len(cats))
    subs = collections.Counter((r["cat"], r["sub"]) for r in reports)
    C.add("P08", "number of sub-category records", "products summary > counts.subcategory", "distinct (Category, Sub Category)", built[DS[1]]["summary"]["counts"]["subcategory"], len(subs))
    types = collections.Counter(r["pcode"] for r in reports)
    C.add("P09", "number of product-type records", "products summary > counts.type", "distinct Product Code", built[DS[1]]["summary"]["counts"]["type"], len(types))

    # ---------------------------------------------------------------- companies
    def company_row(role, name):
        for r in companies.values():
            sf = r["item"]["safer"]
            if sf["role"] == role and sf["name"] == name:
                return r
        raise KeyError(name)
    for i, (role, name, field) in enumerate([("manufacturer", "Sears Holdings Management Corporation", "mfr"), ("manufacturer", "WHIRLPOOL CORPORATION", "mfr"), ("retailer", "Walmart", "retailer")], 1):
        row = company_row(role, name)
        n_raw = sum(1 for r in reports if r[field] == name)
        d_raw = sum(1 for r in reports if r[field] == name and r["sev"] == "Death")
        C.add("C%02da" % i, "%s %s: reports" % (role, name), "%s > Reports" % row["id"], "%s == %r" % ("Manufacturer / Importer / Private Labeler Name" if field == "mfr" else "Retailer", name), first_num(fact(row, "Reports")), n_raw)
        dd = re.match(r"([\d,]+) death reports", fact(row, "Deaths and injuries"))
        C.add("C%02db" % i, "%s %s: death reports" % (role, name), "%s > Deaths and injuries" % row["id"], "same rows with Death severity", num(dd.group(1)), d_raw)
    for role, field in (("manufacturer", "mfr"), ("retailer", "retailer")):
        counts = collections.Counter(r[field] for r in reports)
        raw_names = {n for n, c in counts.items() if c >= 25}
        built_names = {r["item"]["safer"]["name"] for r in companies.values() if r["item"]["safer"]["role"] == role}
        missing = sorted(raw_names - built_names)
        placeholder_like = [n for n in missing if re.fullmatch(r"(?i)(unknown.*|n/?a|none|gift|other|various|multiple|\[?redacted\]?|not (?:known|sure|applicable)|i (?:do ?n[o'’]?t|do not) know|don[' ’]?t know|\?*|-*|\.*|unk|na|no|no brand|nothing|amazon seller|\[contact details withheld\])", n)]
        C.add("C0%s" % ("4" if role == "manufacturer" else "5"), "%s name strings with at least 25 reports (placeholders excluded)" % role, "companies summary > ranking.%s.names_at_threshold" % role,
              "distinct raw strings with count >= 25, minus placeholders", built[DS[2]]["summary"]["ranking"][role]["names_at_threshold"], len(raw_names) - len(placeholder_like),
              explain="raw strings missing from the build: %s" % missing[:10])
        if missing:
            print("  note: %s names >= 25 reports not in build (expected placeholders only): %s" % (role, missing[:10]))
    sec = {}
    for line in open(os.path.join(LOOK, "company_sec_profiles.psv"), encoding="utf-8"):
        line = line.rstrip("\n")
        if "|" in line:
            cik, title = line.split("|", 1)
            sec[cik] = title

    def simple_key(n):
        t = re.sub(r"[.'`]", "", n.casefold().replace("&", " and "))
        t = re.sub(r"[^a-z0-9]+", " ", t).strip().split()
        while len(t) > 1 and t[-1] in {"inc", "llc", "corp", "corporation", "co", "company", "ltd", "plc"}:
            t.pop()
        return " ".join(t)
    sk = company_row("manufacturer", "Skechers USA, Inc.")
    cik = sk["item"]["safer"]["sec_match"]["cik"]
    same_key = [c for c, t in sec.items() if simple_key(t) == simple_key("Skechers USA, Inc.")]
    C.add("C06", "Skechers SEC profile link is the unique exact-key match", "%s > SEC company profile match" % sk["id"], "company_sec_profiles.psv titles whose normalised key equals the name's key", (cik, 1), (same_key[0] if same_key else None, len(same_key)))
    C.add("C07", "Skechers reports", "%s > Reports" % sk["id"], "Manufacturer == Skechers USA, Inc.", first_num(fact(sk, "Reports")), sum(1 for r in reports if r["mfr"] == "Skechers USA, Inc."))

    # ---------------------------------------------------------------- recall cross-check
    corpus = json.load(open(os.path.join(LOOK, "corpus_recalls_api.json"), encoding="utf-8"))["rows"]
    corp_by = {c["recall_number"]: c for c in corpus}
    s4 = xcheck["sp-xc-summary"]
    exp_rows = len(recalls)
    n_rec, n_rep = sum(1 for r in recalls if r["kind"] == "recall"), sum(1 for r in recalls if r["kind"] == "repair")
    ex = re.match(r"([\d,]+) rows in Recalls.csv: ([\d,]+) recalls .* and ([\d,]+) repair entry", fact(s4, "Export recall entries"))
    C.add("X01", "Recalls.csv rows, recalls and repairs", "recalls cross-check summary > Export recall entries", "Recalls.csv data rows under each header block", (num(ex.group(1)), num(ex.group(2)), num(ex.group(3))), (exp_rows, n_rec, n_rep))
    nums = {r["number"] for r in recalls}
    exp_only = sorted(nums - corp_by.keys())
    C.add("X02", "recall numbers in the export but not in the corpus lookup", "recalls cross-check summary > In the export only", "set difference of recall numbers", (first_num(fact(s4, "In the export only")), sorted(re.findall(r"\b\w+\b", fact(s4, "In the export only").split(":", 1)[1]))), (len(exp_only), exp_only))
    mism = [n for n in nums & corp_by.keys() if next(r for r in recalls if r["number"] == n)["date"].isoformat() != corp_by[n]["date"]]
    md = re.match(r"([\d,]+) differ in date", fact(s4, "Matched rows that differ"))
    C.add("X03", "matched recalls whose date differs", "recalls cross-check summary > Matched rows that differ", "Recalls.csv Date vs corpus lookup date by recall number", num(md.group(1)), len(mism))
    C.add("X04", "exact recall-number matches", "recalls cross-check summary > Exact recall-number matches", "intersection of recall numbers", first_num(fact(s4, "Exact recall-number matches")), len(nums & corp_by.keys()))

    def firm_names_to_nums(names):
        got = set()
        wanted = set(names)
        for c in corpus:
            if wanted & {collapse(x) for x in (c["manufacturers"] + c["importers"] + c["distributors"])}:
                got.add(c["recall_number"])
        return got
    sears = next(r for r in xcheck.values() if r["item"]["safer"].get("name") == "Sears Holdings Management Corporation")
    sp = sears["item"]["safer"]
    sn = firm_names_to_nums([f["name"] for f in sp["recall_firm_names"]])
    first = min(corp_by[n]["date"] for n in sn)
    before = sum(1 for r in reports if r["mfr"] == sp["name"] and r["pub"] and r["pub"].isoformat() < first)
    C.add("X05", "Sears: recalls, first recall date, reports published before it", "%s > Recalls with an exact company-name match / Reports published before the first matched recall" % sears["id"], "recall firm names -> corpus recalls; reports with that Manufacturer string",
          (sp["recalls"], sp["first_recall"], sp["reports_before_first_recall"]), (len(sn), first, before))
    zuru = next(r for r in xcheck.values() if r["item"]["safer"].get("name") == "Zuru Inc.")
    zp = zuru["item"]["safer"]
    zn = firm_names_to_nums([f["name"] for f in zp["recall_firm_names"]])
    zfirst = min(corp_by[n]["date"] for n in zn)
    C.add("X06", "Zuru Inc.: recalls, first recall date, reports before it", "%s > Reports published before the first matched recall" % zuru["id"], "recall firm names -> corpus recalls; Manufacturer == Zuru Inc.",
          (zp["recalls"], zp["first_recall"], zp["reports_before_first_recall"]), (len(zn), zfirst, sum(1 for r in reports if r["mfr"] == "Zuru Inc." and r["pub"] and r["pub"].isoformat() < zfirst)))
    pairs_total = 0
    pair_row = None
    for r in xcheck.values():
        sf = r["item"]["safer"]
        if sf.get("kind") == "company":
            pairs_total += sf["product_linked_pairs"]
            if sf["name"] == "Vornado Air LLC":
                pair_row = r
    C.add("X07", "report-recall exact product-text pairs, summed over company records", "recalls cross-check summary > product_pairs.report_recall_pairs", "sum of product_linked_pairs on company records", built[DS[3]]["summary"]["product_pairs"]["report_recall_pairs"], pairs_total)
    vp = pair_row["item"]["safer"]
    vnums = firm_names_to_nums([f["name"] for f in vp["recall_firm_names"]])
    keys = collections.defaultdict(set)
    for n in vnums:
        for p in corp_by[n]["products"]:
            k = text_key(p["name"])
            if len(k) >= 4:
                keys[k].add(n)
    pair_count = 0
    for r in reports:
        if r["mfr"] != vp["name"]:
            continue
        for k in {text_key(r["pdesc"]), text_key((r["brand"] + " " + r["model"]).strip())}:
            pair_count += len(keys.get(k, ()))
    C.add("X08", "Vornado Air LLC: exact product-text pairs with its matched recalls", "%s > Time from report to recall" % pair_row["id"], "report Product Description or Brand+Model == recall product name (casefold, punctuation folded)", vp["product_linked_pairs"], pair_count)

    # ---------------------------------------------------------------- structural checks
    S = []

    def structural(name, ok, detail=""):
        S.append({"check": name, "ok": bool(ok), "detail": detail})
    ids_ok = all(len({r["id"] for r in built[d]["rows"]}) == len(built[d]["rows"]) for d in DS)
    structural("record ids unique within each dataset", ids_ok)
    structural("every row has a non-empty source_url", all(r["source_url"] for d in DS for r in built[d]["rows"]))
    unv = [(d, r["id"]) for d in DS for r in built[d]["rows"] if not any(k == "Units" and "unverified" in v.lower() for k, v in r["detail"]["facts"])]
    structural("every row's Units fact says the reports are unverified", not unv, str(unv[:3]))
    badge_missing = [(d, r["id"]) for d in DS[:3] for r in built[d]["rows"] if "Unverified consumer reports" not in r["item"]["badges"]]
    structural("every series/products/companies row carries the 'Unverified consumer reports' badge", not badge_missing, str(badge_missing[:3]))
    structural("every dataset label says 'unverified' or is the recall cross-check", all(("unverified" in built[d]["label"].lower()) or d == DS[3] for d in DS))
    cat_sum = sum(r["item"]["safer"]["reports"] for r in products.values() if r["item"]["safer"]["kind"] == "category")
    sub_sum = sum(r["item"]["safer"]["reports"] for r in products.values() if r["item"]["safer"]["kind"] == "subcategory")
    type_sum = sum(r["item"]["safer"]["reports"] for r in products.values() if r["item"]["safer"]["kind"] == "type")
    structural("category, sub-category and product-type record counts each add up to the report total", cat_sum == sub_sum == type_sum == N, "%s / %s / %s vs %s" % (cat_sum, sub_sum, type_sum, N))
    pub_sum = sum(r["item"]["safer"]["reports"] for r in series.values() if r["item"]["safer"]["kind"] == "published")
    rep_sum = sum(r["item"]["safer"]["reports"] for r in series.values() if r["item"]["safer"]["kind"] == "reported")
    structural("publication-year and report-year records each add up to the report total", pub_sum == rep_sum == N, "%s / %s vs %s" % (pub_sum, rep_sum, N))
    sev_sum = sum(s["item"]["safer"]["severity"].values())
    structural("severity groups add up to the report total", sev_sum == N, str(sev_sum))
    sec_ciks = set(sec)
    usps = {"AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"}
    own_ids = {d: {r["id"] for r in built[d]["rows"]} for d in DS}
    bad_links = []
    n_links = collections.Counter()
    for d in DS:
        for r in built[d]["rows"]:
            for ln in r["item"]["links"]:
                u = ln["url"]
                if u.startswith("https://"):
                    n_links["external"] += 1
                    continue
                m = re.match(r"/(companies|places|matters/lens|records|data)/(.+)$", u)
                if not m:
                    bad_links.append((r["id"], u))
                    continue
                kind, rest = m.groups()
                n_links[kind] += 1
                if kind == "companies" and rest not in sec_ciks:
                    bad_links.append((r["id"], u))
                elif kind == "places" and rest not in usps:
                    bad_links.append((r["id"], u))
                elif kind == "records":
                    ds, rid = rest.split("/", 1)
                    if ds.startswith("saferproducts") and rid not in own_ids.get(ds, set()):
                        bad_links.append((r["id"], u))
                    elif ds == "agency_safety_cpsc_recalls_api" and rid.split(":", 1)[-1] not in corp_by:
                        bad_links.append((r["id"], u))
    structural("every root-relative link resolves (CIK in company_sec_profiles, USPS valid, own record ids exist, recall ids in the corpus lookup)", not bad_links, "%s; links by kind %s" % (bad_links[:3], dict(n_links)))
    pii = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)")
    hits = []
    for d in DS:
        blob = json.dumps(built[d], ensure_ascii=False)
        hits += pii.findall(blob)
    structural("no email address or phone number anywhere in the four build files", not hits, str(hits[:3]))
    fields = set()
    for d in DS:
        for r in built[d]["rows"]:
            fields |= set(r["item"].keys())
    banned = {"description", "incident_description", "victim", "submitter_name", "address", "email", "phone", "zip"}
    structural("no free-text or contact fields in item payloads", not (fields & banned), str(sorted(fields & banned)))
    ds_ok = all(re.fullmatch(r"[a-z0-9_]{1,80}", d) for d in DS)
    structural("dataset ids match ^[a-z0-9_]{1,80}$", ds_ok)

    # ---------------------------------------------------------------- report
    bad = [c for c in C.rows if not c["match"]]
    unexplained = [c for c in bad if not c["explanation"]]
    out = {"verified_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "raw_reports_read": N, "checks": len(C.rows), "mismatches": len(bad),
           "unexplained_mismatches": len(unexplained), "spot_checks": C.rows, "structural": S, "structural_failures": sum(1 for x in S if not x["ok"]),
           "elapsed_s": round((dt.datetime.now() - t0).total_seconds(), 1)}
    for _ in range(60):
        try:
            with open(os.path.join(BUILD, "spot_checks.json"), "w", encoding="utf-8") as fh:
                json.dump(out, fh, ensure_ascii=False, indent=1, default=str)
            break
        except OSError:
            import time
            time.sleep(1)
    for c in C.rows:
        print("%-5s %-5s %s | shown=%s | raw=%s" % (c["id"], "OK" if c["match"] else "DIFF", c["figure"][:70], str(c["displayed"])[:60], str(c["recomputed"])[:60]))
    for x in S:
        print("STRUCT %-4s %s %s" % ("OK" if x["ok"] else "FAIL", x["check"], x["detail"][:140] if not x["ok"] or "links by kind" in x["detail"] else ""))
    print("checks %d, mismatches %d, unexplained %d, structural failures %d, %.1fs" % (len(C.rows), len(bad), len(unexplained), out["structural_failures"], out["elapsed_s"]))
    return 0 if not unexplained and not out["structural_failures"] else 1


if __name__ == "__main__":
    sys.exit(main())
