"""Independent verification of the oversight build files (second parsing path, recomputed aggregates, cross-checks).

  python3 -I -B scripts/enrichment/oversight/verify_oversight.py [--write]

Offline: reads the raw files in private/acq/oversight/ and the build files in private/build/oversight/. Each check
re-derives a stored value by a different path from the builders (a streaming html.parser reader instead of the
builders' regexes, aggregates recomputed from the build rows, JSON read directly) and counts failures; the target
is 0. --write saves the result to private/build/oversight/verify_report.json.
"""
import glob
import json
import os
import sys
from collections import Counter, defaultdict
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402
import doj_oig as dj  # noqa: E402
import pagefind as pf  # noqa: E402
import parse_doj_oig as pj  # noqa: E402
import rows as rw  # noqa: E402

BUILD = cm.BUILD


def load(dataset):
    with open(os.path.join(BUILD, f"{dataset}.json"), encoding="utf-8") as handle:
        return json.load(handle)


class Listing(HTMLParser):
    """Streaming reader of an Oversight.gov listing page, independent of the builders' regexes."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.reports = []
        self.cur = None
        self.label = None
        self.field = None
        self.in_item = False
        self.text = []
        self.title_div = False
        self.last_title = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag == "tr" and "listing-table__row" in cls.split():
            self.cur = {"cells": {}, "fields": {}}
            self.reports.append(self.cur)
        if self.cur is None:
            return
        if tag == "td" and a.get("data-label"):
            self.label = a["data-label"]
            self.text = []
        if tag == "time" and self.label == "Report Date" and a.get("datetime"):
            self.cur["cells"]["datetime"] = a["datetime"][:10]
        if tag == "a" and self.label == "action-cell-report-link" and a.get("href"):
            self.cur["cells"]["href"] = a["href"]
        if tag == "div" and "title" in cls.split() and "display-inline" in cls.split():
            self.title_div = True
            self.text = []
        if tag == "div" and "field__item" in cls.split() and self.last_title:
            self.in_item = True
            self.text = []

    def handle_endtag(self, tag):
        if self.cur is None:
            return
        if tag == "td" and self.label:
            self.cur["cells"][self.label] = " ".join("".join(self.text).split())
            self.label = None
        if tag == "div" and self.title_div:
            self.last_title = " ".join("".join(self.text).split())
            self.title_div = False
        elif tag == "div" and self.in_item:
            self.cur["fields"][self.last_title] = " ".join("".join(self.text).split())
            self.in_item = False
            self.last_title = None

    def handle_data(self, data):
        if self.label or self.title_div or self.in_item:
            self.text.append(data)


def check_oversight():
    build = load("oversight_reports")
    by_url = {r["source_url"]: r for r in build["rows"]}
    fails = Counter()
    seen = set()
    raw_rows = 0
    for f in sorted(glob.glob(os.path.join(cm.ACQ, "oversight_gov", "federal", "p*.html.gz"))):
        parser = Listing()
        parser.feed(cm.read_gz(f).decode("utf-8"))
        for r in parser.reports:
            href = r["cells"].get("href")
            if not href:
                fails["row_without_link"] += 1
                continue
            raw_rows += 1
            url = "https://www.oversight.gov" + href
            if url in seen:
                continue
            seen.add(url)
            row = by_url.get(url)
            if row is None:
                fails["raw_report_missing_from_build"] += 1
                continue
            b = row["item"]["oversight"]
            c, fl = r["cells"], r["fields"]
            expect = {
                "date": c.get("datetime") or None,
                "agency_reviewed": c.get("Agency Reviewed / Investigated") or None,
                "title": c.get("Report Title") or None,
                "type": c.get("Type") or None,
                "location": c.get("Location") or None,
                "oig": fl.get("Submitting OIG") or None,
                "report_number": fl.get("Report Number") or None,
                "recommendations": int(fl["Number of Recommendations"]) if (fl.get("Number of Recommendations") or "").isdigit() else None,
            }
            got = {"date": b["date"], "agency_reviewed": b["agency_reviewed"], "title": row["title"], "type": b["type"], "location": b["location"],
                   "oig": b["oig"], "report_number": b["report_number"], "recommendations": b["recommendations"]}
            for k in expect:
                if expect[k] != got[k]:
                    fails[f"field_{k}"] += 1
            desc = fl.get("Report Description")
            if desc and b["description"] and not desc.startswith(b["description"].rstrip("…").rstrip()):
                fails["field_description"] += 1
            if bool(desc) != bool(b["description"]):
                fails["description_presence"] += 1
    stored_not_raw = len(set(by_url) - seen)
    if stored_not_raw:
        fails["build_report_not_in_raw"] += stored_not_raw
    return {"raw_rows": raw_rows, "unique_reports": len(seen), "stored": len(build["rows"]), "failures": dict(fails), "total_failures": sum(fails.values()) + abs(len(seen) - len(build["rows"]))}


def check_trends():
    """Recompute every trend row from the build rows of oversight_reports and compare with the stored series."""
    reports = load("oversight_reports")["rows"]
    trends = load("oversight_trends")["rows"]
    groups = defaultdict(list)
    for r in reports:
        b = r["item"]["oversight"]
        groups[b["oig"]].append(b)
    fails = Counter()

    def recompute(items):
        by_year = defaultdict(lambda: {"reports": 0, "recs": 0, "recs_reports": 0, "types": Counter()})
        for b in items:
            if not b["date"]:
                continue
            y = by_year[int(b["date"][:4])]
            y["reports"] += 1
            y["types"][b["type"] or "Not recorded"] += 1
            if b["recommendations"] is not None:
                y["recs"] += b["recommendations"]
                y["recs_reports"] += 1
        return by_year

    def compare(name, items, stored):
        calc = recompute(items)
        if sorted(calc) != [y["year"] for y in stored["years"]]:
            fails[f"{name}: year list"] += 1
        for y in stored["years"]:
            c = calc.get(y["year"])
            if not c or (c["reports"], c["recs"], c["recs_reports"], dict(c["types"])) != (y["reports"], y["recs"], y["recs_reports"], y["types"]):
                fails[f"{name}: year {y['year']}"] += 1
        t = stored["totals"]
        dated = [b["date"] for b in items if b["date"]]
        recs = [b["recommendations"] for b in items if b["recommendations"] is not None]
        want = (len(items), len(dated), len(items) - len(dated), min(dated, default=None), max(dated, default=None), sum(recs), len(recs))
        have = (t["reports"], t["dated"], t["undated"], t["first_date"], t["last_date"], t["recs"], t["recs_reports"])
        if want != have:
            fails[f"{name}: totals"] += 1

    checked = 0
    for row in trends:
        body = row["item"]["trend"]
        if body["scope"] == "national":
            compare("national", [b for items in groups.values() for b in items], body)
            if sum(o["reports"] for o in body["oigs"]) != sum(len(v) for k, v in groups.items() if k):
                fails["national: oig ranking total"] += 1
        else:
            compare(body["name"], groups.get(body["name"], []), body)
        checked += 1
    return {"trend_rows": checked, "failures": dict(fails), "total_failures": sum(fails.values())}


def check_doj_oig():
    build = load("doj_oig_reports")
    by_id = {r["id"]: r for r in build["rows"]}
    fails = Counter()
    pages = 0
    for f in sorted(glob.glob(os.path.join(cm.ACQ, "doj_oig", "reports", "*.html.gz"))):
        text = cm.read_gz(f).decode("utf-8")
        rid = "dojoig:" + os.path.basename(f)[: -len(".html.gz")]
        row = by_id.get(rid)
        if row is None:
            fails["page_without_row"] += 1
            continue
        pages += 1
        b = row["item"]["dojoig"]
        # second path: every field__label and the first field__item after it, found with a plain scan
        labels = {}
        pos = 0
        while True:
            i = text.find('class="field__label', pos)
            if i < 0:
                break
            j = text.find(">", i) + 1
            k = text.find("</div>", j)
            label = " ".join(text[j:k].split())
            nxt = text.find('class="field__label', k)
            seg = text[k: nxt if nxt > 0 else k + 3000]
            m = seg.find('field__item')
            vals = []
            while m >= 0 and len(vals) < 6:
                s = seg.find(">", m) + 1
                e = seg.find("</div>", s)
                vals.append(" ".join(pj.clean(seg[s:e]).split()))
                m = seg.find("field__item", e)
            labels.setdefault(label, [v for v in vals if v])
            pos = k
        number = (labels.get("Report Number") or labels.get("Número de informe") or [None])[0]
        if number != b["number"]:
            fails["number"] += 1
        qc = (labels.get("Questioned Costs") or labels.get("Costos cuestionados") or [None])[0]
        got_qc = b["questioned_costs"]["text"] if b["questioned_costs"] else None
        if qc != got_qc:
            fails["questioned_costs"] += 1
        fb = (labels.get("Funds for Better Use") or [None])[0]
        got_fb = b["funds_better_use"]["text"] if b["funds_better_use"] else None
        if fb != got_fb:
            fails["funds_better_use"] += 1
        recs = (labels.get("Number of Recommendations") or labels.get("Número de recomendaciones") or [None])[0]
        if (int(recs) if recs and recs.isdigit() else None) != b["recommendations"]:
            fails["recommendations"] += 1
        for key, value in (("questioned_costs", b["questioned_costs"]), ("funds_better_use", b["funds_better_use"])):
            if value and value["value"] is not None:
                printed = int(round(value["value"]))
                digits = "".join(ch for ch in value["text"].split(".")[0] if ch.isdigit())
                if digits and int(digits) != printed:
                    fails[f"{key}_value_vs_text"] += 1
        if b["date"] and row["item"]["cells"]["date"] != b["date"]:
            fails["cell_date"] += 1
    posted_mismatch = build["summary"]["stats"].get("listing_vs_page_date_mismatches", 0)
    return {"report_pages_checked": pages, "rows": len(build["rows"]), "rows_without_page": len(build["rows"]) - pages,
            "listing_vs_page_date_mismatches": posted_mismatch, "failures": dict(fails), "total_failures": sum(fails.values()) + abs(len(build["rows"]) - pages)}


def check_osc():
    files = load("osc_public_files")["rows"]
    pubs = load("osc_publications")["rows"]
    fails = Counter()
    root = os.path.join(cm.ACQ, "osc")
    with open(os.path.join(root, "pagefind", "pagefind-entry.json"), "rb") as handle:
        index_hash = pf.parse_entry(handle.read())
    with open(os.path.join(root, "pagefind", f"{index_hash}.pf_meta"), "rb") as handle:
        meta = pf.parse_meta(handle.read())
    by_url = {r["source_url"]: r for r in files}
    n = 0
    for h, _ in meta["pages"]:
        path = os.path.join(root, "fragments", f"{h}.pf_fragment")
        if not os.path.exists(path):
            continue
        with open(path, "rb") as handle:
            frag = pf.parse_fragment(handle.read())
        m = frag.get("meta") or {}
        if "case-number" not in m:
            continue
        n += 1
        row = by_url.get("https://www.osc.gov" + frag["url"])
        if row is None:
            fails["case_missing"] += 1
            continue
        b = row["item"]["oscdi"]
        if b["date_closed"] != m.get("date-iso") or b["agency"] != m.get("agency"):
            fails["case_fields"] += 1
        if b["results"] != json.loads(m.get("case-results-json") or "[]"):
            fails["case_results"] += 1
        if [f["url"].replace("https://www.osc.gov", "") for f in b["files"]] != [x["href"] for x in json.loads(m.get("case-files-json") or "[]")]:
            fails["case_files"] += 1
    if n != len(files):
        fails["case_count"] += abs(n - len(files))
    ids = [r["id"] for r in pubs]
    if len(ids) != len(set(ids)):
        fails["pub_duplicate_ids"] += 1
    press = sum(1 for r in pubs if r["item"]["oscpub"]["kind"] == "press_release")
    return {"cases_checked": n, "case_rows": len(files), "publication_rows": len(pubs), "press_releases": press, "failures": dict(fails), "total_failures": sum(fails.values())}


def check_doj_site():
    cep = load("doj_cep_resolutions")["rows"]
    idx = load("doj_document_index")["rows"]
    fails = Counter()
    page = cm.read_gz(os.path.join(cm.ACQ, "justice_gov", "vsd_resolutions_part_1.html.gz")).decode("utf-8")
    anchors = page.count("<li><a href=")
    if anchors != len(cep):
        fails["cep_count_vs_list_items"] += 1
    for r in cep:
        b = r["item"]["cep"]
        if b["date_text"] not in page:
            fails["cep_date_not_on_page"] += 1
        if b["url"].replace("https://www.justice.gov", "") not in page and b["url"] not in page:
            fails["cep_link_not_on_page"] += 1
    for r in idx:
        url = r["item"]["dojdoc"]["url"]
        pages = [cm.read_gz(p).decode("utf-8") for p in glob.glob(os.path.join(cm.ACQ, "justice_gov", "*.html.gz"))]
        if not any(url.replace("https://www.justice.gov", "") in p or url in p for p in pages):
            fails["index_link_not_on_any_page"] += 1
    return {"cep_rows": len(cep), "index_rows": len(idx), "failures": dict(fails), "total_failures": sum(fails.values())}


def check_shapes():
    fails = Counter()
    for ds in ("oversight_reports", "oversight_trends", "doj_oig_reports", "osc_public_files", "osc_publications", "doj_cep_resolutions", "doj_document_index"):
        b = load(ds)
        ids = [r["id"] for r in b["rows"]]
        if len(ids) != len(set(ids)):
            fails[f"{ds}: duplicate ids"] += 1
        for r in b["rows"]:
            if r["dataset"] != ds or r["category"] != ds or "ordinal" in r:
                fails[f"{ds}: dataset/category/ordinal"] += 1
            if not str(r["source_url"]).startswith("https://"):
                fails[f"{ds}: source_url"] += 1
            if not r["title"].strip():
                fails[f"{ds}: empty title"] += 1
            for label, value in r["detail"]["facts"]:
                if value in ("", "None", "null"):
                    fails[f"{ds}: blank fact"] += 1
            for banned in ("firecrawl", "tavily", "claude", "anthropic", "openai"):
                if banned in json.dumps(r).lower():
                    fails[f"{ds}: vendor/model name '{banned}'"] += 1
    return {"failures": dict(fails), "total_failures": sum(fails.values())}


def main():
    report = {"verified_at": rw.built_at()}
    for name, fn in (("oversight_reports", check_oversight), ("oversight_trends", check_trends), ("doj_oig_reports", check_doj_oig),
                     ("osc", check_osc), ("doj_site", check_doj_site), ("shapes", check_shapes)):
        report[name] = fn()
        print(name, json.dumps(report[name]))
    report["total_failures"] = sum(v["total_failures"] for k, v in report.items() if isinstance(v, dict))
    print("TOTAL FAILURES", report["total_failures"])
    if "--write" in sys.argv:
        with open(os.path.join(BUILD, "verify_report.json"), "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=1)


if __name__ == "__main__":
    main()
