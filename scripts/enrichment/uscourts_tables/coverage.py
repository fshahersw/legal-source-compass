"""Coverage of the U.S. Courts statistical publications: publication x table number x period, listed / acquired / parsed / published.

Every row of the "Caseload Statistics Data Tables" view (listing_index.json, crawl_listing.py) is one table of one publication for
one period. For each the four states are read from records, never assumed:

  listed     the row is in the listing (by definition);
  acquired   the file is in this stream's store (files_index.json), or in the store of the stream that publishes that
             publication (Judicial Facts and Figures, Federal Court Management Statistics profiles, Civil Justice Reform Act);
  parsed     a parsed table file exists (ingest.py, pdf_backfill.py, wiretap.py), or the reason it was not read: the gate that
             rejected it (ingest_report.json, pdf_ingest_report.json), "no reader for this layout", or read by the other stream;
  published  the period is in a built dataset of this stream, held (it fails its own printed totals), a duplicate of the same
             period another publication prints, or published by the other stream's dataset (lookups/other_datasets.json).

compute() returns the matrix; write_markdown() renders the audit. Usage (after a build):
  python3 -I -B coverage.py [--doc docs/uscourts-statistics-coverage-2026-10-24.md] [--before <before_published.json>]
"""
import gzip
import json
import re
import sys
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import acquire as A  # noqa: E402
import fetchlib as F  # noqa: E402
import normalize as N  # noqa: E402

BUILD = F.ROOT / "private" / "build" / "uscourts_tables"
PARSED = BUILD / "parsed"
LOOKUPS = BUILD / "lookups"
OTHER_ACQ = F.ROOT / "private" / "acq"
PUB_ORDER = ["STFJ", "FJCS", "JB", "BF", "BAPCPA", "WIRETAP", "JFF", "FCMS", "CJRA"]
# report publications that are not in the caseload listing (acquire_reports.py, reports.py): their "listed" rows are the tables the
# reports print (one per table and period), or one per report for the Crime Victims' Rights reports, which print no table
REPORT_PUBS = ["DNSW", "FISC", "CVRA"]
PUB_TITLES = {
    "STFJ": "Statistical Tables for the Federal Judiciary",
    "FJCS": "Federal Judicial Caseload Statistics",
    "JB": "Judicial Business of the United States Courts",
    "BF": "Bankruptcy Filings",
    "BAPCPA": "Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA) report",
    "WIRETAP": "Wiretap report",
    "JFF": "Judicial Facts and Figures",
    "FCMS": "Federal Court Management Statistics",
    "CJRA": "Civil Justice Reform Act (CJRA) report",
    "DNSW": "Delayed-Notice Search Warrant report",
    "FISC": "Director's Report on the Foreign Intelligence Surveillance Courts' Activities",
    "CVRA": "Crime Victims' Rights report (no tables; counts stated in each report)",
}
PUB_PAGES = {
    "STFJ": "https://www.uscourts.gov/data-news/reports/statistical-reports/statistical-tables-federal-judiciary",
    "FJCS": "https://www.uscourts.gov/data-news/reports/statistical-reports/federal-judicial-caseload-statistics",
    "JB": "https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-business-united-states-courts",
    "BF": "https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-filings-statistics",
    "BAPCPA": "https://www.uscourts.gov/data-news/reports/statistical-reports/bankruptcy-abuse-prevention-and-consumer-protection-act-report",
    "WIRETAP": "https://www.uscourts.gov/data-news/reports/statistical-reports/wiretap-reports",
    "JFF": "https://www.uscourts.gov/data-news/reports/statistical-reports/judicial-facts-and-figures",
    "FCMS": "https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics",
    "CJRA": "https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report",
    "DNSW": "https://www.uscourts.gov/data-news/reports/statistical-reports/delayed-notice-search-warrant-report",
    "FISC": "https://www.uscourts.gov/data-news/reports/statistical-reports/directors-report-foreign-intelligence-surveillance-courts-activities",
    "CVRA": "https://www.uscourts.gov/data-news/reports/statistical-reports/crime-victims-rights-report",
}
LISTING_URL = "https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables"


def _json(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == ".gz" else data)


def series_of(pub, table):
    """The series a table number belongs to: its letter group ("C-4A" -> C), the BAPCPA / Judicial Facts and Figures chapter
    ("BAPCPA 1A" -> 1, "4.2" -> 4), "Wire" for the Wiretap tables, the document kind for FCMS."""
    if pub == "FCMS":
        return table.replace("FCMS-", "")
    if pub in ("BAPCPA", "CJRA"):
        m = re.search(r"(\d+)", table)
        return m.group(1) if m else table
    if pub == "WIRETAP":
        return "Wire " + ("A/B" if re.search(r"[AB]\d", table) else "1-10")
    if pub == "JFF":
        return table.split(".")[0]
    m = re.match(r"^([A-Z]+)", table)
    return m.group(1) if m else table


def pdf_reasons(pdf_report, grid_report=None):
    """{listing key: why the PDF period was not read}: the word-position reader's reason where it tried the period (it runs after
    the row-count reader), else the row-count reader's."""
    out = {}
    for r in (pdf_report or {}).get("rejected", []):
        if r.get("tried"):
            first = r["tried"][0]["reasons"]
            out[r["key"]] = "PDF text layer read but rejected by a gate: " + (first[0] if first else "unknown")
        else:
            out[r["key"]] = "PDF text layer read but rejected by a gate: " + ((r.get("reasons") or ["unknown"])[0])
    for key in (pdf_report or {}).get("no_reference", []):
        out.setdefault(key, "PDF only, and no spreadsheet edition of this table parses as a court table to name its columns")
    for r in (grid_report or {}).get("rejected", []):
        first = (r["tried"][0]["reasons"] if r.get("tried") else r.get("reasons")) or ["unknown"]
        out[r["key"]] = "PDF read by word positions but rejected by a gate: " + first[0]
    return out


def load_inputs():
    listing = _json(F.ACQ / "listing_index.json", {})
    files = _json(F.ACQ / "files_index.json", {})
    ingest = _json(BUILD / "ingest_report.json", {}) or {}
    pdf = _json(BUILD / "pdf_ingest_report.json", {}) or {}
    grid = _json(BUILD / "pdf_grid_report.json", {}) or {}
    wire = _json(BUILD / "wiretap_report.json", {}) or {}
    others = _json(LOOKUPS / "other_datasets.json", {}) or {}
    parsed = set()
    for path in PARSED.glob("*/*/*.json.gz"):
        parsed.add((path.parts[-3], path.parts[-2], path.name[: -len(".json.gz")]))
    jff_index = _json(OTHER_ACQ / "uscourts_caseload" / "jff_index.json", []) or []
    jff_urls = {e["url"] for e in jff_index if e.get("status") == 200}
    fcms_names = {p.name for p in (OTHER_ACQ / "uscourts_fcms" / "files").rglob("*") if p.is_file()} if (OTHER_ACQ / "uscourts_fcms" / "files").exists() else set()
    cjra_dir = OTHER_ACQ / "uscourts_cjra" / "files"
    cjra_names = {p.name.replace(".gz", "") for p in cjra_dir.rglob("*") if p.is_file()} if cjra_dir.exists() else set()
    # the CJRA stream stores each report period in its own folder: the table files of recent periods, the full report of older ones
    cjra_folders = {d.name for d in cjra_dir.iterdir() if d.is_dir() and any(f.is_file() for f in d.rglob("*"))} if cjra_dir.exists() else set()
    cjra_inv = _json(OTHER_ACQ / "uscourts_cjra" / "inventory.json", {}) or {}
    cjra_periods = set()
    for p in cjra_inv.get("periods", []):
        if isinstance(p, dict):
            cjra_periods.add(p.get("period") or p.get("period_end") or "")
        elif isinstance(p, str):
            cjra_periods.add(p)
    rejected = {r["key"]: "spreadsheet rejected by a gate: " + "; ".join((r.get("reasons") or ["unknown"])[:1]) for r in ingest.get("rejected", [])}
    unreadable = {r["key"]: "spreadsheet could not be opened: " + r.get("error", "")[:80] for r in ingest.get("unreadable", [])}
    return {"listing": listing, "files": files, "rejected": rejected, "unreadable": unreadable, "pdf": pdf_reasons(pdf, grid), "wire": wire,
            "reports_index": _json(F.ACQ / "reports_index.json", {}) or {}, "reports": _json(BUILD / "reports_report.json", {}) or {},
            "others": others, "parsed": parsed, "jff_urls": jff_urls, "fcms_names": fcms_names, "cjra_names": cjra_names, "cjra_periods": cjra_periods,
            "cjra_folders": cjra_folders}


def published_sets(builds):
    """(pub, table number, end) of every published period, from the build payloads (national records carry every period)."""
    out = set()
    for build in builds.values():
        for r in build["rows"]:
            u = r.get("item", {}).get("ust")
            if not u or "src" not in u:
                continue
            for s in u["src"]:
                out.add((s.get("pub"), u.get("table"), s.get("end")))
    return out


def other_dataset(pub, table, end, entry, inputs):
    """(acquired_by_other, published_in) for the publications another stream publishes."""
    others = inputs["others"]
    names = [f.rsplit("/", 1)[-1] for f in entry.get("files", [])]
    if pub == "JFF":
        got = any(f in inputs["jff_urls"] for f in entry.get("files", []))
        spec = others.get("court_jff_series", {})
        year = int(end[:4])
        xlsx = any(n.lower().endswith(".xlsx") for n in names)
        inside = table in spec.get("tables", []) and xlsx and (year == 2014 or 2016 <= year <= 2025)
        return got, ("court_jff_series" if inside else None)
    if pub == "FCMS" and table in ("FCMS-DISTRICT-PROFILES", "FCMS-APPEALS-PROFILES"):
        got = any(n in inputs["fcms_names"] for n in names)
        spec = others.get("fcms_court_profiles", {})
        inside = spec.get("first_edition", "9") <= end <= spec.get("last_edition", "0")
        return got, ("fcms_court_profiles" if inside else None)
    if pub == "CJRA":
        got = any(n in inputs["cjra_names"] for n in names) or end in inputs.get("cjra_folders", set())
        return got, ("court_cjra_reports" if end in inputs["cjra_periods"] else None)
    return False, None


def compute(builds, report, inputs=None):
    inputs = inputs or load_inputs()
    published = published_sets(builds)
    held = {(h["pub"], h.get("tableNumber"), h["end"]): h for h in report.get("held", [])}
    dup = {(d["pub"], d.get("tableNumber"), d["end"]): d["kept"] for d in report.get("duplicate_periods", [])}
    by_table_end = defaultdict(set)
    for pub, table, end in published:
        by_table_end[(table, end)].add(pub)
    pubs = OrderedDict((code, {"code": code, "title": PUB_TITLES[code], "page": PUB_PAGES[code], "tables": OrderedDict()}) for code in PUB_ORDER)
    for pn, block in inputs["listing"].items():
        code = A.PUB_CODE.get(pn)
        if code not in pubs:
            continue
        for e in block.get("tables", []):
            if not e.get("period_end") or A.is_composite(e):
                continue
            table = A.table_id(e) or e.get("table") or ""
            end = e["period_end"]
            key = f"{code}|{table}|{end}"
            f = inputs["files"].get(key)
            fmt = (f or {}).get("format")
            acq = "acquired" if f and f.get("status") == 200 else "not_acquired"
            other_got, other_pub = other_dataset(code, table, end, e, inputs)
            if acq == "not_acquired" and other_got:
                acq = "acquired_by_other_stream"
            slug = N.table_slug(table)
            if (code, end, slug) in inputs["parsed"]:
                parse, why = "parsed", ""
            elif key in inputs["unreadable"]:
                parse, why = "not_parsed", inputs["unreadable"][key]
            elif key in inputs["rejected"]:
                parse, why = "not_parsed", inputs["rejected"][key]
            elif key in inputs["pdf"]:
                parse, why = "not_parsed", inputs["pdf"][key]
            elif key in (inputs["wire"].get("rejected") or {}):
                parse, why = "not_parsed", "jurisdiction table rejected by a gate: " + inputs["wire"]["rejected"][key]
            elif key in (inputs["wire"].get("not_read") or {}):
                parse, why = "not_parsed", inputs["wire"]["not_read"][key]
            elif other_pub:
                parse, why = "read_by_other_stream", f"read by the stream that publishes {other_pub}"
            elif acq == "not_acquired" and not other_got:
                parse, why = "not_parsed", "not acquired"
            elif code in ("JFF", "FCMS", "CJRA"):
                parse, why = "not_parsed", "no reader in this stream (another stream publishes this publication)" if other_got else "no reader for this document"
            elif fmt == "pdf":
                parse, why = "not_parsed", "PDF only; no reader for this table's layout (category rows, not one row per court)"
            else:
                parse, why = "not_parsed", "no reader for this layout"
            if (code, e.get("table"), end) in published or (code, table, end) in published:
                pubst, detail = "published", ""
            elif (code, e.get("table"), end) in held:
                h = held[(code, e.get("table"), end)]
                pubst, detail = "held", f"fails its own printed totals ({h.get('failureCount')} tests); " + (f"published from {h['replacedBy']}" if h.get("replacedBy") else "a gap")
            elif by_table_end.get((e.get("table"), end)):
                pubst, detail = "duplicate", "the same table and period is published from " + ", ".join(sorted(by_table_end[(e.get("table"), end)]))
            elif other_pub:
                pubst, detail = "published_by_other_stream", other_pub
            else:
                pubst, detail = "not_published", why
            t = pubs[code]["tables"].setdefault(table, {"table": table, "title": e.get("title") or "", "series": series_of(code, table), "periods": []})
            t["periods"].append({"end": end, "fmt": fmt or ("pdf" if any(x.lower().endswith(".pdf") for x in e.get("files", [])) and not any(x.lower().endswith((".xls", ".xlsx")) for x in e.get("files", [])) else "xlsx"),
                                 "acq": acq, "parse": parse, "why": why, "pub": pubst, "detail": detail, "page": e.get("page")})
    for p in pubs.values():
        for t in p["tables"].values():
            t["periods"].sort(key=lambda x: x["end"])
            t["counts"] = count(t["periods"])
        p["counts"] = count([x for t in p["tables"].values() for x in t["periods"]])
        by_series = defaultdict(list)
        for t in p["tables"].values():
            by_series[t["series"]].extend(t["periods"])
        p["series"] = OrderedDict((s, count(v)) for s, v in sorted(by_series.items(), key=lambda kv: natural(kv[0])))
    for code in REPORT_PUBS:
        pubs[code] = report_publication(code, builds, inputs)
    totals = count([x for p in pubs.values() for t in p["tables"].values() for x in t["periods"]])
    return {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "listing": LISTING_URL, "publications": list(pubs.values()), "totals": totals}


def report_publication(code, builds, inputs):
    """Coverage of one report publication: a row per table and period its files print (reports_report.json), or per report (CVRA)."""
    pub = {"code": code, "title": PUB_TITLES[code], "page": PUB_PAGES[code], "tables": OrderedDict()}
    rep = inputs["reports"]
    index = inputs["reports_index"]
    published = published_sets(builds)
    rows = []
    if code == "CVRA":
        cvra = next((b for b in builds.values() if b.get("dataset") == "uscourts_cvra"), {"rows": []})
        done = {r["item"]["cvra"]["year"] for r in cvra["rows"] if r.get("item", {}).get("cvra")}
        for url, e in index.items():
            if e["pub"] != "CVRA":
                continue
            year = int(re.search(r"(\d{4})", e["link_text"]).group(1))
            ok = e.get("status") == 200
            rows.append(("Report", "Annual report to Congress (counts stated in its opening paragraph)", f"{year}-12-31", "pdf", ok,
                         "parsed" if year in done else "not_parsed", "" if year in done else ("not acquired" if not ok else "not read"),
                         "published" if year in done else "not_published", e["page"]))
    else:
        written = {(w["table"], w["period_end"]): w for w in rep.get("written", []) if w["pub"] == code}
        for (table, end), w in written.items():
            pubst = "published" if (code, table, end) in published else "not_published"
            rows.append((table, "", end, w["format"], True, "parsed", "", pubst, index.get(w["url"], {}).get("page")))
        for key, why in rep.get("not_read", {}).items():
            url, _, table = key.partition("#")
            e = index.get(url) or {}
            if e.get("pub") != code or not table:
                continue
            year = re.search(r"report-(\d{4})$", e.get("page", "")) or re.fullmatch(r"(\d{4})", (e.get("link_text") or "").strip()) or re.search(r"(\d{4})", e.get("link_text") or "")
            end = f"{year.group(1)}-{'09-30' if code == 'DNSW' else '12-31'}" if year else "unknown"
            if (table, end) in written:
                continue
            held = why.startswith("fails its own printed totals")  # reports.py marks a table-period that breaks its own arithmetic so
            rows.append((table, "", end, e.get("format"), e.get("status") == 200, "not_parsed", why[:200], "held" if held else "not_published", e.get("page")))
    for table, title, end, fmt, acquired, parse, why, pubst, page in sorted(rows, key=lambda r: (natural(r[0]), r[2])):
        t = pub["tables"].setdefault(table, {"table": table, "title": title, "series": table.split(" ")[0], "periods": []})
        t["periods"].append({"end": end, "fmt": fmt, "acq": "acquired" if acquired else "not_acquired", "parse": parse, "why": why, "pub": pubst,
                             "detail": why if pubst == "held" else "", "page": page})
    for t in pub["tables"].values():
        t["periods"].sort(key=lambda x: x["end"])
        t["counts"] = count(t["periods"])
    pub["counts"] = count([x for t in pub["tables"].values() for x in t["periods"]])
    by_series = defaultdict(list)
    for t in pub["tables"].values():
        by_series[t["series"]].extend(t["periods"])
    pub["series"] = OrderedDict((s, count(v)) for s, v in sorted(by_series.items(), key=lambda kv: natural(kv[0])))
    return pub


def count(periods):
    c = Counter()
    for x in periods:
        c["listed"] += 1
        c["acquired"] += x["acq"] != "not_acquired"
        c["acquired_here"] += x["acq"] == "acquired"
        c["parsed"] += x["parse"] in ("parsed", "read_by_other_stream")
        c["parsed_here"] += x["parse"] == "parsed"
        c["published"] += x["pub"] == "published"
        c["held"] += x["pub"] == "held"
        c["duplicate"] += x["pub"] == "duplicate"
        c["other_stream"] += x["pub"] == "published_by_other_stream"
        c["not_published"] += x["pub"] == "not_published"
    ends = [x["end"] for x in periods if x["pub"] == "published"]
    out = dict(c)
    out["first_published"] = min(ends) if ends else None
    out["last_published"] = max(ends) if ends else None
    out["last_listed"] = max(x["end"] for x in periods) if periods else None
    return out


def natural(text):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", str(text))]


def reasons_of(periods):
    c = Counter(x["why"] for x in periods if x["pub"] == "not_published")
    return c


def write_markdown(cov, path, before=None, extra_sections=()):
    lines = []
    tot = cov["totals"]
    lines += ["# U.S. Courts statistical tables: coverage audit (2026-10-24)", "",
              f"Generated {cov['generated_at']} by `scripts/enrichment/uscourts_tables/coverage.py` from the listing of {cov['listing']} "
              "(crawled 2026-10-23, the years 2025-2026 re-crawled on 2026-10-24: no table was added), the stream's file store and parse reports, "
              "and the built datasets. Each listing row is one table of one publication for one period.", "",
              "Columns: **Listed** rows in the listing; **Acquired** file stored (here or by the stream that publishes that publication); "
              "**Parsed** read into a table (here or by that stream); **Published** in a dataset of this stream. Not published splits into "
              "**Held** (the edition fails its own printed totals), **Duplicate** (another publication prints the same table for the same period "
              "and that one is published), **Other dataset** (published by another stream's dataset) and **Gap**.", ""]
    if before:
        lines += ["## Before and after", "", "| | Listed | Acquired | Parsed | Published |", "|---|---:|---:|---:|---:|"]
        lines.append(f"| Before (2026-10-23 build, as published) | {before['listed']} | {before['acquired']} | {before.get('parsed', 'not recorded')} | {before['published']} |")
        lines.append(f"| After (this build) | {tot.get('listed', 0)} | {tot.get('acquired', 0)} | {tot.get('parsed', 0)} | {tot.get('published', 0)} |")
        lines += ["", before.get("note", ""), ""]
    lines += ["## By publication", "", "| Publication | Tables | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap | Published periods | Newest listed |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"]
    for p in cov["publications"]:
        c = p["counts"]
        if not c.get("listed"):
            continue
        span = f"{c['first_published']} to {c['last_published']}" if c.get("first_published") else "none"
        lines.append(f"| [{p['title']}]({p['page']}) | {len(p['tables'])} | {c.get('listed', 0)} | {c.get('acquired', 0)} | {c.get('parsed', 0)} | {c.get('published', 0)} | "
                     f"{c.get('held', 0)} | {c.get('duplicate', 0)} | {c.get('other_stream', 0)} | {c.get('not_published', 0)} | {span} | {c.get('last_listed')} |")
    lines.append(f"| **All** | | {tot.get('listed', 0)} | {tot.get('acquired', 0)} | {tot.get('parsed', 0)} | {tot.get('published', 0)} | {tot.get('held', 0)} | {tot.get('duplicate', 0)} | "
                 f"{tot.get('other_stream', 0)} | {tot.get('not_published', 0)} | | |")
    lines += [""]
    for section in extra_sections:
        lines += section + [""]
    for p in cov["publications"]:
        if not p["counts"].get("listed"):
            continue
        lines += [f"## {p['title']}", "", f"Publication page: {p['page']}", "", "By series:", "", "| Series | Listed | Acquired | Parsed | Published | Held | Duplicate | Other dataset | Gap |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for s, c in p["series"].items():
            lines.append(f"| {s} | {c.get('listed', 0)} | {c.get('acquired', 0)} | {c.get('parsed', 0)} | {c.get('published', 0)} | {c.get('held', 0)} | {c.get('duplicate', 0)} | {c.get('other_stream', 0)} | {c.get('not_published', 0)} |")
        lines += ["", "By table number:", "", "| Table | Title | Listed | Acquired | Parsed | Published | Held | Dup. | Other | Gap | Published periods | Main reason for gaps |",
                  "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|"]
        for t in sorted(p["tables"].values(), key=lambda t: natural(t["table"])):
            c = t["counts"]
            span = f"{c['first_published']} to {c['last_published']}" if c.get("first_published") else ""
            why = reasons_of(t["periods"]).most_common(1)
            reason = f"{why[0][0]} ({why[0][1]})" if why else ""
            title = t["title"].replace("|", "/")[:90]
            lines.append(f"| {t['table']} | {title} | {c.get('listed', 0)} | {c.get('acquired', 0)} | {c.get('parsed', 0)} | {c.get('published', 0)} | {c.get('held', 0)} | "
                         f"{c.get('duplicate', 0)} | {c.get('other_stream', 0)} | {c.get('not_published', 0)} | {span} | {reason} |")
        gaps = Counter()
        for t in p["tables"].values():
            for x in t["periods"]:
                if x["pub"] == "not_published":
                    gaps[x["why"]] += 1
        if gaps:
            lines += ["", "Never parsed or not published, by reason:", ""]
            for why, n in gaps.most_common():
                lines.append(f"- {n} table-periods: {why}")
        lines.append("")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text("\n".join(lines) + "\n")


def load_builds():
    builds = {}
    for path in sorted(BUILD.glob("uscourts_*.json.gz")):
        b = _json(path)
        builds[b["dataset"]] = b
    return builds


def before_counts(before_path, inputs):
    """Listed / acquired / published as of the 2026-10-23 build (the published datasets) against today's listing."""
    data = _json(before_path, {})
    published = {(p, t, e) for p, t, e, _ in data.get("published", [])}
    old_files = _json(Path(before_path).parent / "files_index.2026-10-23.json.gz", {}) or {}
    listed = acquired = pub = 0
    for pn, block in inputs["listing"].items():
        code = A.PUB_CODE.get(pn)
        if code not in PUB_TITLES:
            continue
        for e in block.get("tables", []):
            if not e.get("period_end") or A.is_composite(e):
                continue
            table = A.table_id(e) or e.get("table")
            listed += 1
            f = old_files.get(f"{code}|{table}|{e['period_end']}")
            other_got, _ = other_dataset(code, table, e["period_end"], e, inputs)
            acquired += bool((f and f.get("status") == 200) or other_got)
            pub += (code, e.get("table"), e["period_end"]) in published
    return {"listed": listed, "acquired": acquired, "published": pub,
            "note": "Before: the five uscourts_tables_* datasets as published on 2026-10-23 (their manifest hashes equal the local build files of that day), measured against "
                    "today's listing (the earlier listing lacked the FCMS and CJRA rows); acquired counts this stream's file index of 2026-10-23 plus the other streams' stores. "
                    "The parse report of that run was overwritten by the re-parse, so the earlier parsed count is not recorded."}


CORRECTIONS = [
    "Acquired: the 559 Statistical Tables and 781 Judicial Business editions published only as PDF, with "
    "`acquire.py --pubs 77,78,79 --series ALL --pdf-only --min-free-gb 2.0` (one request per second, gzip, sha256 manifest).",
    "Read: PDF-only editions by the word-position reader (pdf_grid.py, pdf_align.py, pdf_grid_ingest.py: court and category tables, "
    "tables printed in halves, BAPCPA sort-code columns, editions printed under an earlier table number); the Bankruptcy Filings "
    "printouts of 2001-2008 (bf_legacy.py, Tables F and F-2); category tables whose rows the workbook does not indent (C-4, BAP-2, "
    "B-1A, A-1 and others) from their own printed sums (hierarchy.py). Every such period is reconciled against its own printed "
    "totals as before, and a second path re-reads a sample of figures with another text extraction (verify_readers.py).",
    "Courts: 'IL,E' is the former Eastern District of Illinois (illinoised); 'AK,E', 'AK,W' and 'AR' in Judicial Business S-19 for "
    "FY2017 name no court and stay unmatched; the combined Arkansas bankruptcy row is its own record (arcomb), and the E.D. and W.D. "
    "records say from which period they are printed only in it.",
    "Not read here: Federal Court Management Statistics, Judicial Facts and Figures and Civil Justice Reform Act files, which the "
    "streams that own them publish (an intermediate run of this stream had parsed 39 FCMS workbooks; they are not published).",
    "New publications outside the caseload listing (acquire_reports.py, reports.py): the Delayed-Notice Search Warrant tables "
    "(uscourts_dnsw), Table 1 of the Director's reports on the FISA courts (uscourts_fisc) and the counts stated in the Crime "
    "Victims' Rights reports, which print no table (uscourts_cvra).",
    "Wiretap: the jurisdiction Tables 2-6 published only as PDF (1997-2015) are read where their columns match the workbook editions "
    "(rotated headings by their letters, column by column) and the Total equals FEDERAL plus every jurisdiction in every count column; "
    "the 2016 and 2017 workbooks, which print the local jurisdictions without their state rows, are not read (a county named like a "
    "state would take the state's series); Table 1 (statutes), Tables 7-10 (multi-year summaries) and A-1/B-1 (one row per order) "
    "are not jurisdiction tables and are not read.",
]


def before_after_section(before_path, cov):
    """Listed / acquired / parsed / published per publication: the audit of 2026-10-24 03:00 against this build."""
    before = _json(before_path, {}) or {}
    old = {p["code"]: p["counts"] for p in before.get("publications", [])}
    lines = ["## Before and after, by publication", "",
             f"Before: the audit generated {before.get('generated_at', 'not recorded')} (the previous build of this stream). After: this build.", "",
             "| Publication | Listed | Acquired before | Acquired after | Parsed before | Parsed after | Published before | Published after | Held before | Held after |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    totals = {"b": Counter(), "a": Counter()}
    for p in cov["publications"]:
        a, b = p["counts"], old.get(p["code"], {})
        if not a.get("listed"):
            continue
        for k in ("acquired", "parsed", "published", "held"):
            totals["b"][k] += b.get(k, 0) or 0
            totals["a"][k] += a.get(k, 0) or 0
        lines.append(f"| {p['title']} | {a.get('listed', 0)} | {b.get('acquired', 0)} | {a.get('acquired', 0)} | {b.get('parsed', 0)} | {a.get('parsed', 0)} | "
                     f"{b.get('published', 0)} | {a.get('published', 0)} | {b.get('held', 0)} | {a.get('held', 0)} |")
    lines.append(f"| **All** | {cov['totals'].get('listed', 0)} | {totals['b']['acquired']} | {totals['a']['acquired']} | {totals['b']['parsed']} | {totals['a']['parsed']} | "
                 f"{totals['b']['published']} | {totals['a']['published']} | {totals['b']['held']} | {totals['a']['held']} |")
    lines += ["", "The report publications (Delayed-Notice Search Warrant, FISA courts, Crime Victims' Rights) are new rows: they are not in the "
              "caseload listing, so their 'listed' rows are the tables the reports print (one per table and period), or one per report.", ""]
    return lines


def verification_section():
    ver = _json(BUILD / "verification.json", {}) or {}
    v = ver.get("summary") or {}
    lines = ["## Verification and cross-checks", "",
             "Second code path (verify_uscourts_tables.py, no shared parser): " + ", ".join([
                 f"{v.get('cells_match', 0)} of {v.get('cells_checked', 0)} random court cells found again in the source workbook",
                 f"{v.get('category_cells_match', 0)} of {v.get('category_cells_checked', 0)} category-row cells",
                 f"{v.get('sum_match', 0):,} district sums equal the printed Total ({v.get('sum_mismatch', 0)} mismatches, {v.get('sum_incomplete', 0):,} incomplete)",
                 f"{v.get('pdf_match', 0)} of {v.get('pdf_checked', 0)} workbook editions agree with their own PDF row for row",
                 f"{v.get('wiretap_sum_match', 0):,} of {v.get('wiretap_sum_tests', 0):,} Wiretap groupings re-added from the stored figures",
                 f"{v.get('pdf_period_cells_match', 0):,} of {v.get('pdf_period_cells', 0):,} PDF-read figures equal the next edition's prior-year column "
                 f"(the {v.get('pdf_period_cells_differ', 0):,} others are figures the next edition revised, mostly bankruptcy cases pending; each period keeps its own edition's figure)",
             ]) + ".", ""]
    readers = _json(BUILD / "verification_readers.json", {}) or {}
    if readers:
        t, o, pr = readers.get("pdf_text", {}), readers.get("other_publication", {}), readers.get("printouts", {})
        lines += ["Readers added on 2026-10-24 (verify_readers.py, a second text extraction and the other publications): "
                  f"{t.get('matched', 0)} of {t.get('checked', 0)} random figures read by word positions found again at the same place "
                  f"by pdftotext -layout; {o.get('equal', 0):,} of {o.get('compared', 0):,} figures read by the new readers equal the same "
                  f"table, period, row and column in another publication ({o.get('different', 0)} differ); {pr.get('rows', 0):,} printout rows "
                  f"re-added from the stored figures ({pr.get('failures', 0)} failures). The report tables (Delayed-Notice Search Warrant, "
                  "FISA courts) are checked inside reports.py: every PDF figure is found again with the other text extraction, every "
                  "spreadsheet figure is read again with openpyxl directly. The Wiretap groupings that do not re-add are the periods where a "
                  "jurisdiction printed twice in one state with different figures is left out (its figures are in the printed Total).", ""]
    cross = _json(BUILD / "crosschecks.json", {}) or {}
    if cross.get("checks"):
        lines += [cross.get("method", ""), "", "| Check | Method | Compared | Match |", "|---|---|---:|---:|"]
        for c in cross["checks"]:
            lines.append(f"| [{c['what']}]({c['file']}) | {c['method']} | {c['compared']} | {c['match']} |")
        lines.append("")
    return lines


def not_acquired_section(cov):
    lines = ["## Not acquired", ""]
    rows = []
    for p in cov["publications"]:
        n = sum(1 for t in p["tables"].values() for x in t["periods"] if x["acq"] == "not_acquired")
        if n:
            rows.append((p["title"], n))
    if not rows:
        return lines + ["Every listed table-period is stored. Report publications: the Crime Victims' Rights reports for 2008 and 2011 are "
                        "not linked from the publisher's report page; the 2008 Delayed-Notice Search Warrant report "
                        "(https://www.uscourts.gov/file/18402/download) is a scanned file with no text layer, so its figures are not read.", ""]
    lines += ["| Publication | Table-periods not stored |", "|---|---:|"] + [f"| {t} | {n} |" for t, n in rows] + [
        "",
        "Files the publisher's links do not serve (the listing names them, the request answers 404) and Civil Justice Reform Act table "
        "files of older periods, which that stream holds as one full report per period. Report publications: the Crime Victims' Rights "
        "reports for 2008 and 2011 are not linked from the publisher's report page.", ""]
    return lines


def main():
    inputs = load_inputs()
    builds = load_builds()
    report = _json(BUILD / "build_report.json", {})
    cov = compute(builds, report, inputs)
    (BUILD / "coverage.json").write_text(json.dumps(cov, sort_keys=True))
    before = None
    if "--before" in sys.argv:
        before = before_counts(sys.argv[sys.argv.index("--before") + 1], inputs)
    if "--doc" in sys.argv:
        extra = []
        held = report.get("held", [])
        sec = ["## Held table-periods (fail their own printed totals)", ""]
        if held:
            sec += ["| Publication | Table | Period | Failing tests | First failure (kind, row, column: printed vs sum of parts) | Period published from |", "|---|---|---|---:|---|---|"]
            for h in held:
                f = (h.get("failures") or [{}])[0]
                sec.append(f"| {h['pub']} | {h.get('tableNumber')} | {h['end']} | {h.get('failureCount')} | {f.get('kind')}, {f.get('entity')}, {f.get('col')}: {f.get('printed')} vs {f.get('sum')} | {h.get('replacedBy') or 'gap'} |")
        else:
            sec.append("None.")
        reports = _json(BUILD / "reports_report.json", {}) or {}
        rheld = [(k, v) for k, v in sorted(reports.get("not_read", {}).items()) if v.startswith("fails its own printed totals")]
        if rheld:
            index = _json(F.ACQ / "reports_index.json", {}) or {}
            sec += ["", "Report tables (reports.py) that fail their own printed totals, not published:", "",
                    "| Publication | Table | File | Failures (first) |", "|---|---|---|---|"]
            for key, why in rheld:
                url, _, table = key.partition("#")
                e = index.get(url, {})
                year = re.search(r"(\d{4})$", e.get("page", "")) or re.search(r"(\d{4})", e.get("link_text") or "")
                sec.append(f"| {e.get('pub', '')} | {table} ({year.group(1) if year else 'year not stated'}) | {url} | "
                           f"{why[len('fails its own printed totals: '):][:220].replace('|', '/')} |")
        extra.append(sec)
        if "--before-coverage" in sys.argv:
            extra.append(before_after_section(sys.argv[sys.argv.index("--before-coverage") + 1], cov))
        extra.append(["## Corrections and additions in this build", ""] + [f"- {c}" for c in CORRECTIONS])
        extra.append(verification_section())
        extra.append(not_acquired_section(cov))
        write_markdown(cov, sys.argv[sys.argv.index("--doc") + 1], before, extra)
    print(json.dumps(cov["totals"]))
    for p in cov["publications"]:
        print(p["code"], json.dumps({k: v for k, v in p["counts"].items() if not isinstance(v, str)}))


if __name__ == "__main__":
    main()
