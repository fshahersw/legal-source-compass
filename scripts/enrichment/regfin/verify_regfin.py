"""Independent verification of the built regulatory-finance datasets (run after build_regfin.py).

For each dataset, 30 random records are re-fetched from the publisher (fresh GET, cache bypassed) and compared exactly with
the build file, using parsing code that does not import the builders' parsers (stdlib / pandas only). Every cross-reference is
then re-derived from scratch with a second implementation of the documented name key and compared with what was stored.

Usage: python3 -I -B scripts/enrichment/regfin/verify_regfin.py [--seed N]
Writes private/build/regfin/verify.json and prints failure counts (target: 0).
"""
import collections
import gzip
import html
import io
import json
import random
import re
import sys
import time
import unicodedata
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import regfin_http as h  # noqa: E402

ROOT = h.ROOT
BUILD = ROOT / "private" / "build" / "regfin"
ACQ = h.ACQ
SAMPLE = 30
SECURL = "https://www.sec.gov"
FRB_FILES = "https://www.federalreserve.gov/supervisionreg/files/"


def load(dataset):
    return json.loads((BUILD / f"{dataset}.json").read_text(encoding="utf-8"))


def pick(rows, rng, n=SAMPLE):
    body = [r for r in rows if r["id"] != "summary:overview"]
    return rng.sample(body, min(n, len(body)))


def squash(text):
    return " ".join((text or "").split())


class Report:
    def __init__(self, dataset):
        self.dataset, self.checked, self.failures, self.fields = dataset, 0, [], 0

    def cmp(self, rid, field, stored, source):
        self.fields += 1
        if stored != source:
            self.failures.append({"id": rid, "field": field, "stored": stored, "source": source})

    def done(self, extra=None):
        out = {"dataset": self.dataset, "records_checked": self.checked, "fields_compared": self.fields,
               "failures": len(self.failures), "failure_detail": self.failures[:20]}
        out.update(extra or {})
        return out


# ------------------------------------------------------------------------------------------------ second-implementation key


def key2(name):
    """Second implementation of the documented name key (no reuse of names.normalize_company)."""
    s = unicodedata.normalize("NFC", name or "")
    s = re.sub(r"\s*/(?:[A-Za-z]{2,4})?/?\s*$", "", s).lower().replace("&", " and ")
    words = re.sub(r"[^\w\s]", " ", s).split()
    drop = {"inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited", "plc", "sa", "ag", "nv"}
    if words and words[0] == "the":
        words = words[1:]
    while words and words[-1] in drop | {"the"}:
        words.pop()
    return " ".join(words)


def profile_index():
    data = json.loads((BUILD / "lookups" / "company_sec_profiles.json").read_text())
    by_key = collections.defaultdict(set)
    for cik, title in data["rows"]:
        by_key[key2(title)].add(cik)
    return {cik for cik, _ in data["rows"]}, by_key


# -------------------------------------------------------------------------------------------------------------------- BD


def bd_text(raw):
    text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig")
    out = {}
    for line in text.splitlines():
        cols = line.split("\t")
        if len(cols) >= 8 and re.fullmatch(r"\d{10}", cols[0].strip()):
            out[cols[0].strip()] = [squash(c) for c in cols[:8]]
    return out


def verify_bd(rng, profiles, by_key):
    ds = load("sec_broker_dealers")
    rep = Report("sec_broker_dealers")
    index = json.loads((ACQ / "sec" / "bd_index.json").read_text())
    path_for = {}
    for it in index:
        m = re.fullmatch(r"\s*([A-Za-z]+)\s+(\d{4})\s*", it["month_label"])
        months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        path_for[f"{int(m.group(2)):04d}-{months.index(m.group(1)) + 1:02d}"] = it
    cache = {}

    def fresh(month):
        if month not in cache:
            it = path_for[month]
            status, body = h.fetch(SECURL + it["path"], "verify/sec/bd/" + it["file"], refresh=True, method="verify re-fetch")
            if status != 200:
                raise SystemExit(f"re-fetch {it['path']} -> {status}")
            cache[month] = bd_text(body)
        return cache[month]

    cached_all = {}
    for month, it in path_for.items():
        raw = gzip.open(ACQ / "sec" / "bd" / (it["file"] + ".gz"), "rb").read()
        cached_all[month] = bd_text(raw)
    order = sorted(path_for)
    for r in pick(ds["rows"], rng):
        rep.checked += 1
        item = r["item"]["broker_dealer"]
        cik = item["cik"]
        last = fresh(item["last_listed"]).get(cik)
        rep.cmp(r["id"], "present in re-fetched last-listed file", last is not None, True)
        if last:
            for field, i in (("name", 1), ("file_number", 2), ("address1", 3), ("address2", 4), ("city", 5), ("state", 6), ("zip", 7)):
                rep.cmp(r["id"], field, item.get(field), last[i] or None)
        first = fresh(item["first_listed"]).get(cik)
        rep.cmp(r["id"], "present in re-fetched first-listed file", first is not None, True)
        listed = [m for m in order if cik in cached_all[m]]
        rep.cmp(r["id"], "first_listed", item["first_listed"], listed[0])
        rep.cmp(r["id"], "last_listed", item["last_listed"], listed[-1])
        rep.cmp(r["id"], "months_listed", item["months_listed"], len(listed))
        rep.cmp(r["id"], "in_latest_file", item["in_latest_file"], listed[-1] == order[-1])
        rep.cmp(r["id"], "source_url", r["source_url"], SECURL + path_for[item["last_listed"]]["path"])
    # series counts for 30 random months, re-fetched
    ov = ds["rows"][0]["item"]["overview"]
    series_checked = 0
    for s in rng.sample(ov["series"], min(SAMPLE, len(ov["series"]))):
        rep.cmp(s["month"], "monthly count", s["count"], len(fresh(s["month"])))
        series_checked += 1
    keys = [r for r in ds["rows"] if r["id"] != "summary:overview"]
    matched = [r["id"] for r in keys if r["item"]["broker_dealer"]["cik"] in profiles]
    stored = [r["id"] for r in keys if any(l["url"].startswith("/companies/") for l in r["item"]["links"])]
    rep.cmp("all", "records whose CIK is a company_sec_profiles CIK (re-derived)", sorted(stored), sorted(matched))
    return rep.done({"series_months_refetched": series_checked, "profile_matches": len(matched)})


# -------------------------------------------------------------------------------------------------------------------- IA


def verify_ia(rng, profiles, by_key):
    import pandas as pd

    ds = load("sec_investment_advisers")
    rep = Report("sec_investment_advisers")
    frames = {}
    for firm_type, name in (("Registered", "ia100226.zip"), ("ERA", "ia100226-exempt.zip")):
        url = SECURL + "/files/investment/data/other/information-about-registered-investment-advisers-exempt-reporting-advisers/" + name
        status, body = h.fetch(url, "verify/sec/ia/" + name, refresh=True, method="verify re-fetch")
        if status != 200:
            raise SystemExit(f"re-fetch {url} -> {status}")
        zf = zipfile.ZipFile(io.BytesIO(body))
        inner = zf.infolist()[0]
        frames[firm_type] = pd.read_csv(io.BytesIO(zf.read(inner)), dtype=str, keep_default_na=False, encoding="cp1252").set_index("Organization CRD#", drop=False)

    def date_iso(v):
        m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", v.strip())
        return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None

    def num(v):
        v = v.replace(",", "").replace("$", "").strip()
        try:
            return float(v) if v else None
        except ValueError:
            return None

    for r in pick(ds["rows"], rng):
        rep.checked += 1
        rec = r["item"]["investment_adviser"]
        src = frames[rec["firm_type"]].loc[rec["crd"]]
        rid = r["id"]
        rep.cmp(rid, "legal_name", rec["legal_name"], squash(src["Legal Name"]))
        rep.cmp(rid, "primary_business_name", rec.get("primary_business_name"), squash(src["Primary Business Name"]) or None)
        rep.cmp(rid, "sec_number", rec.get("sec_number"), squash(src["SEC#"]) or None)
        rep.cmp(rid, "cik_published", rec.get("cik_published"), squash(src["CIK#"]) or None)
        rep.cmp(rid, "status", rec.get("status"), squash(src["SEC Current Status"]) or None)
        rep.cmp(rid, "status_effective_date", rec.get("status_effective_date"), date_iso(src["SEC Status Effective Date"]))
        rep.cmp(rid, "latest_adv_filing_date", rec.get("latest_adv_filing_date"), date_iso(src["Latest ADV Filing Date"]))
        rep.cmp(rid, "main city", rec["main_office"].get("city"), squash(src["Main Office City"]) or None)
        rep.cmp(rid, "main state", rec["main_office"].get("state"), squash(src["Main Office State"]) or None)
        rep.cmp(rid, "main postal", rec["main_office"].get("postal"), squash(src["Main Office Postal Code"]) or None)
        withheld = src["Main Office Private Residence Flag"].strip() == "Y"
        rep.cmp(rid, "main street1 (withheld when private residence)", rec["main_office"].get("street1"), None if withheld else (squash(src["Main Office Street Address 1"]) or None))
        rep.cmp(rid, "main phone (withheld when private residence)", rec["main_office"].get("phone"), None if withheld else (squash(src["Main Office Telephone Number"]) or None))
        rep.cmp(rid, "disclosure_any", rec.get("disclosure_any"), squash(src["11"]) or None if "11" in src.index else None)
        yes = [c for c in src.index if re.fullmatch(r"11[A-H](\(\d\))?(\([a-c]\))?", c) and src[c].strip() == "Y"]
        rep.cmp(rid, "item 11 Yes questions", [y["item"] for y in rec.get("disclosure_yes_items", [])], yes)
        if rec["firm_type"] == "Registered":
            rep.cmp(rid, "raum_total_usd", rec.get("raum_total_usd"), num(src["5F(2)(c)"]))
            rep.cmp(rid, "accounts_total", rec.get("accounts_total"), int(src["5F(2)(f)"].replace(",", "").strip()) if src["5F(2)(f)"].strip() else None)
    # row counts from the re-fetched files
    stored_reg = ds["rows"][0]["item"]["overview"]["registered"]
    stored_era = ds["rows"][0]["item"]["overview"]["exempt_reporting"]
    rep.cmp("overview", "registered row count", stored_reg, len(frames["Registered"]))
    rep.cmp("overview", "exempt row count", stored_era, len(frames["ERA"]))
    # cross-reference re-derivation over every record
    body = [r for r in ds["rows"] if r["id"] != "summary:overview"]
    derived, stored = {}, {}
    for firm_type, frame in frames.items():
        for crd, row in frame.iterrows():
            cik = row["CIK#"].strip()
            cik10 = cik.zfill(10) if cik.isdigit() and len(cik) <= 10 else None
            hit = cik10 if cik10 in profiles else None
            if not hit:
                ciks = by_key.get(key2(row["Legal Name"]), set())
                hit = next(iter(ciks)) if len(ciks) == 1 else None
            if hit:
                derived[f"ia:{crd}"] = hit
    for r in body:
        m = r["item"]["investment_adviser"].get("profile_match")
        if m:
            stored[r["id"]] = m["cik"]
    rep.cmp("all", "profile matches (re-derived from the re-fetched files)", stored, derived)
    return rep.done({"profile_matches": len(derived)})


# ----------------------------------------------------------------------------------------------------------------- stats


def verify_stats(rng, profiles, by_key):
    import pandas as pd

    ds = load("sec_adviser_statistics")
    rep = Report("sec_adviser_statistics")
    url = "https://www.sec.gov/file/im-investment-adviser-statistics-support-data-20260805"
    status, body = h.fetch(url, "verify/sec/stats/support.xlsx", refresh=True, method="verify re-fetch")
    if status != 200:
        raise SystemExit(f"re-fetch {url} -> {status}")
    book = pd.read_excel(io.BytesIO(body), sheet_name=None, header=None, dtype=object, keep_default_na=False, na_values=[""])
    for r in pick(ds["rows"], rng):
        rep.checked += 1
        t = r["item"]["adviser_table"]
        frame = book[t["tab"]]
        header = [("" if pd.isna(c) else str(c).strip()) for c in frame.iloc[0]]
        year_cols = [i for i, c in enumerate(header) if re.fullmatch(r"(19|20)\d{2}", c)]
        rep.cmp(r["id"], "years", t["years"], [int(header[i]) for i in year_cols])
        body_rows = []
        for _, row in frame.iloc[1:].iterrows():
            labels = [("" if pd.isna(c) else str(c).strip()) for c in row.iloc[: year_cols[0]]]
            if labels and labels[0].startswith("Return to Notes"):
                continue
            if not any(labels) and row.isna().all():
                continue
            values = [None if pd.isna(row.iloc[i]) else row.iloc[i] for i in year_cols]
            body_rows.append((labels, values))
        rep.cmp(r["id"], "row count", len(t["rows"]), len(body_rows))
        for stored, (labels, values) in zip(t["rows"], body_rows):
            rep.cmp(r["id"], "labels", stored["labels"], labels)
            rep.cmp(r["id"], f"values {labels}", stored["values"], [v if v is None else (int(v) if float(v).is_integer() and not isinstance(v, float) else v) for v in values])
    return rep.done()


# ------------------------------------------------------------------------------------------------------------------- FRB


def verify_frb(rng, profiles, by_key):
    import csv

    ds = load("frb_enforcement_actions")
    rep = Report("frb_enforcement_actions")
    live = {}
    for name in ("ea-cms-recent.json", "ea-old.json"):
        status, body = h.fetch(FRB_FILES + name, "verify/frb/" + name, refresh=True, method="verify re-fetch")
        if status != 200:
            raise SystemExit(f"re-fetch {name} -> {status}")
        for it in json.loads(body.decode("utf-8-sig"))["eaitems"]:
            live[str(it["id"])] = it
    status, body = h.fetch(FRB_FILES + "enforcementactions.csv", "verify/frb/enforcementactions.csv", refresh=True, method="verify re-fetch")
    csv_rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline="")))
    q = lambda v: (v or "").replace('"', "'")  # noqa: E731
    csv_set = collections.Counter(
        (r["Effective Date"].strip(), q(squash(r["Banking Organization"])), q(squash(r["Individual"])), q(squash(r["Individual Affiliation"])), squash(r["Action"]))
        for r in csv_rows
    )

    def u(v):
        return squash(html.unescape(v or ""))

    for r in pick(ds["rows"], rng):
        rep.checked += 1
        a = r["item"]["frb_action"]
        it = live.get(a["id"])
        rep.cmp(r["id"], "present in re-fetched Board list", it is not None, True)
        if not it:
            continue
        rep.cmp(r["id"], "effective_date", a["effective_date"], it["edt"])
        tdt = it.get("tdt")
        rep.cmp(r["id"], "termination_date", a["termination_date"], None if tdt in (None, "", "1950-01-01") else tdt)
        rep.cmp(r["id"], "type", a["type"], u(it.get("type")))
        rep.cmp(r["id"], "banking_organization", a.get("banking_organization"), u(it.get("bkorg")) or None)
        rep.cmp(r["id"], "individual", a.get("individual"), u(it.get("person")) or None)
        rep.cmp(r["id"], "individual_affiliation", a.get("individual_affiliation"), u(it.get("porg")) or None)
        url = (it.get("url") or "").strip()
        expected = ("https://www.federalreserve.gov" + url if url.startswith("/") else url) if url.startswith(("/", "http://", "https://")) else None
        rep.cmp(r["id"], "url", a.get("url"), expected)
        rep.cmp(r["id"], "url_label", a.get("url_label"), u(it.get("urlname")) or None)
        sig = (a["effective_date"], q(a.get("banking_organization") or ""), q(a.get("individual") or ""), q(a.get("individual_affiliation") or ""), a["type"])
        rep.cmp(r["id"], "row present in the Board's CSV", csv_set[sig] >= 1, True)
    body_rows = [r for r in ds["rows"] if r["id"] != "summary:overview"]
    rep.cmp("overview", "action count equals re-fetched list size", len(body_rows), len(live))
    rep.cmp("overview", "csv row count equals list size", len(csv_rows), len(live))
    # cross-reference re-derivation: every organisation / affiliation segment against the profile keys
    def derived_keys(a):
        out = set()
        for seg in a["organizations"] + a["affiliations"]:
            ciks = by_key.get(key2(seg["name"]), set()) if key2(seg["name"]) else set()
            if len(ciks) == 1:
                out.add(next(iter(ciks)))
        return out

    derived = {r["id"]: sorted(derived_keys(r["item"]["frb_action"])) for r in body_rows}
    stored = {r["id"]: sorted(r["filters"].get("company", [])) for r in body_rows}
    rep.cmp("all", "company filters (re-derived from each segment's name key)", {k: v for k, v in stored.items() if v}, {k: v for k, v in derived.items() if v})
    return rep.done({"profile_matches": sum(1 for v in derived.values() if v)})


def main(argv):
    seed = int(argv[argv.index("--seed") + 1]) if "--seed" in argv else int(time.time())
    rng = random.Random(seed)
    profiles, by_key = profile_index()
    results = {"seed": seed, "sample_size": SAMPLE, "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    for fn in (verify_bd, verify_ia, verify_stats, verify_frb):
        out = fn(rng, profiles, by_key)
        results[out["dataset"]] = out
        print(json.dumps({k: v for k, v in out.items() if k != "failure_detail"}), flush=True)
        if out["failures"]:
            print(json.dumps(out["failure_detail"][:5], indent=1)[:3000])
    (BUILD / "verify.json").write_text(json.dumps(results, indent=1, default=str))
    total = sum(results[d]["failures"] for d in ("sec_broker_dealers", "sec_investment_advisers", "sec_adviser_statistics", "frb_enforcement_actions"))
    print("TOTAL FAILURES", total)
    return 0 if total == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
