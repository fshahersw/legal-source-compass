"""Build `osc_public_files` (whistleblower disclosure public files) and `osc_publications` (reports, Hatch Act advisory
opinions, testimonies and press releases) from the U.S. Office of Special Counsel's own site.

  python3 -I -B scripts/enrichment/oversight/build_osc.py

Reads only private/acq/oversight/osc/. Every title, date, agency, result and file link is as osc.gov publishes it.
Individuals appear only inside titles OSC itself wrote (for example a testimony's title); nothing is looked up or
inferred about a person, and the public-file PDFs (which OSC redacts) are linked, never copied.
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402
import pagefind as pf  # noqa: E402
import parse_osc as po  # noqa: E402
import rows as rw  # noqa: E402

FILES = "osc_public_files"
PUBS = "osc_publications"
OSC = os.path.join(cm.ACQ, "osc")
CASES_PAGE = "https://www.osc.gov/cases/"
PAGES = {
    "report": ("reports", "https://www.osc.gov/resources/reports/", "Reports"),
    "testimony": ("testimonies", "https://www.osc.gov/resources/testimonies/", "Testimonies & Transcripts"),
    "advisory_opinion": ("advisory_opinions", "https://www.osc.gov/services/hatch-act/advisoryopinion/", "Hatch Act Advisory Opinions"),
}
KINDS = {"report": "Report", "testimony": "Testimony or transcript", "advisory_opinion": "Hatch Act advisory opinion", "press_release": "Press release"}


def read_page(name):
    with open(os.path.join(OSC, "pages", f"{name}.html"), encoding="utf-8") as handle:
        return handle.read()


def load_fragments():
    """({value: [fragment dicts]}, index hash) for the case and press-release pages of the site's search index."""
    with open(os.path.join(OSC, "pagefind", "pagefind-entry.json"), "rb") as handle:
        index_hash = pf.parse_entry(handle.read())
    with open(os.path.join(OSC, "pagefind", f"{index_hash}.pf_meta"), "rb") as handle:
        meta = pf.parse_meta(handle.read())
    ct_hash = meta["filters"]["content-type"]
    with open(os.path.join(OSC, "pagefind", f"{ct_hash}.pf_filter"), "rb") as handle:
        content_type = pf.parse_filter(handle.read())
    out = {}
    for value in ("case", "press-release"):
        frags = []
        for h in pf.case_page_hashes(meta, content_type, value):
            with open(os.path.join(OSC, "fragments", f"{h}.pf_fragment"), "rb") as handle:
                frags.append(pf.parse_fragment(handle.read()))
        out[value] = frags
    return out, index_hash


def case_record(c):
    rid = "oscdi:" + c["slug"]
    shown = ", ".join(c["numbers"]) or c["number"]
    year = int(c["date_closed"][:4]) if c["date_closed"] else None
    body = {"number": shown, "numbers": c["numbers"], "slug": c["slug"], "agency": c["agency"], "location": c["location"], "date_closed": c["date_closed"], "year": year,
            "results": c["results"], "files": c["files"], "url": c["url"]}
    labels = Counter(f["label"] for f in c["files"])
    facts = [("OSC file number(s)", shown), ("Agency (as OSC lists it)", c["agency"]), ("Location", c["location"]),
             ("Date closed", c["date_closed"]), ("Results (as OSC lists them)", c["results"] or None),
             ("Files posted", "; ".join(f"{n} {label}" for label, n in labels.items()) or None),
             ("Source", "U.S. Office of Special Counsel, Public Files (cases referred for investigation under 5 U.S.C. 1213(c))")]
    links = [{"url": c["url"], "label": "OSC case page"}] + [{"url": f["url"], "label": f["label"]} for f in c["files"]]
    return rw.record(
        FILES, rid, shown, source_url=c["url"], subtitle=" · ".join(x for x in [c["agency"], c["location"], c["date_closed"]] if x),
        cells={"number": shown, "agency": c["agency"] or rw.NOT_RECORDED, "location": c["location"] or rw.NOT_RECORDED,
               "closed": c["date_closed"] or rw.NOT_RECORDED, "results": "; ".join(c["results"]) if c["results"] else rw.NOT_RECORDED,
               "files": str(len(c["files"]))},
        facts=facts, links=links,
        filters={"agency": [c["agency"]] if c["agency"] else [], "year": [str(year)] if year else [], "result": list(c["results"])},
        extra={"oscdi": body}, text=" ".join(x for x in [shown, c["agency"], c["location"], " ".join(c["results"]), " ".join(f["label"] for f in c["files"])] if x))


def pub_record(kind, title, url, *, group=None, parent=None, date=None, year=None, tags=(), file_type=None, excerpt=None, source_page=None):
    rid = rw.stable_id("oscpub", "|".join([kind, url, title, parent or "", group or ""]))
    body = {"kind": kind, "kind_label": KINDS[kind], "title": title, "group": group, "parent": parent, "date": date, "year": year,
            "tags": list(tags), "file_type": file_type, "url": url, "excerpt": excerpt}
    facts = [("Type", KINDS[kind]), ("Group on osc.gov", group), ("Audience (as OSC groups it)", parent), ("Date", date),
             ("Fiscal or calendar year", year), ("OSC tags", list(tags) or None), ("File type", file_type), ("Listed on", source_page)]
    return rw.record(
        PUBS, rid, title, source_url=url, subtitle=" · ".join(x for x in [KINDS[kind], group, date] if x),
        cells={"kind": KINDS[kind], "group": group or rw.NOT_RECORDED, "date": date or rw.NOT_RECORDED, "year": str(year) if year else rw.NOT_RECORDED},
        facts=facts, links=[{"url": url, "label": "On osc.gov"}],
        filters={"kind": [kind], "group": [group] if group else [], "year": [str(year)] if year else [], "tag": list(tags)},
        extra={"oscpub": body}, text=" ".join(x for x in [title, KINDS[kind], group, parent, " ".join(tags), excerpt] if x))


def main():
    frags, index_hash = load_fragments()
    cases, bad_cases = [], 0
    for f in frags["case"]:
        c = po.parse_case(f)
        if c:
            cases.append(c)
        else:
            bad_cases += 1
    dup = len(cases) - len({c["slug"] for c in cases})
    if dup:
        raise SystemExit(f"{dup} duplicate OSC case pages")
    multi = sum(1 for c in cases if len(c["numbers"]) > 1)
    cases.sort(key=lambda c: (c["date_closed"] or "", c["slug"]), reverse=True)
    case_rows = [case_record(c) for c in cases]
    pubs = []
    stats = Counter()
    for kind, (name, page_url, page_title) in PAGES.items():
        items = po.parse_resources(read_page(name))
        for it in items:
            group = it["topic"] if kind == "report" else (it["topic"] or None)
            date = po.trailing_date(it["title"]) if kind == "testimony" else None
            year = po.fiscal_year(it["title"]) if kind == "report" else (int(date[:4]) if date else None)
            pubs.append(pub_record(kind, it["title"], it["url"], group=group, parent=it["parent"], date=date, year=year, file_type=it["file_type"], source_page=page_url))
        stats[kind] = len(items)
    seen_press = set()
    for f in frags["press-release"]:
        p = po.parse_press(f)
        if not p or p["url"] in seen_press:
            stats["press_release_skipped"] += 1
            continue
        seen_press.add(p["url"])
        pubs.append(pub_record("press_release", p["title"], p["url"], date=p["date"], year=int(p["date"][:4]) if p["date"] else None, tags=p["tags"],
                               file_type="Web page", excerpt=rw.clip(p["excerpt"], 400)[0], source_page="https://www.osc.gov/news/"))
        stats["press_release"] += 1
    ids = [r["id"] for r in pubs]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate publication ids")
    pubs.sort(key=lambda r: (r["item"]["oscpub"]["date"] or "", r["id"]), reverse=True)
    inputs = rw.manifest_inputs([cm.rel(OSC)])
    agencies = sorted({c["agency"] for c in cases if c["agency"]})
    results = sorted({x for c in cases for x in c["results"]})
    years = sorted({str(c["date_closed"][:4]) for c in cases if c["date_closed"]}, reverse=True)
    file_summary = {
        "source": "U.S. Office of Special Counsel, Public Files: whistleblower disclosures referred for investigation under 5 U.S.C. 1213(c)", "source_page": CASES_PAGE,
        "terms": "osc.gov publishes no robots.txt or reuse terms beyond U.S. Government works; read at one request per 1.1 s through the site's own public search index files. The linked reports are OSC-redacted PDFs and are not copied.",
        "coverage": f"{len(cases)} files; closed {min((c['date_closed'] for c in cases if c['date_closed']), default='Not recorded')} to {max((c['date_closed'] for c in cases if c['date_closed']), default='Not recorded')}; index {index_hash}",
        "fields": "Case number, agency, location, date closed, the list of results and the file links are exactly as OSC lists them.",
        "stats": {"fragments_without_case_number": bad_cases, "pages_with_several_file_numbers": multi, "distinct_file_numbers": len({n for c in cases for n in c["numbers"]})}, "records": len(cases),
    }
    lb = rw.listing([("number", "OSC file"), ("agency", "Agency"), ("location", "Location"), ("closed", "Date closed"), ("results", "Results"), ("files", "Files")],
                    [("agency", "Agency", {a: a for a in agencies}), ("year", "Year closed", {y: y for y in years}), ("result", "Result listed", {r: r for r in results})])
    rw.write_build(FILES, "OSC whistleblower disclosure public files", case_rows, lb, file_summary, inputs)
    kinds = Counter(r["item"]["oscpub"]["kind"] for r in pubs)
    groups = sorted({r["item"]["oscpub"]["group"] for r in pubs if r["item"]["oscpub"]["group"]})
    pyears = sorted({str(r["item"]["oscpub"]["year"]) for r in pubs if r["item"]["oscpub"]["year"]}, reverse=True)
    ptags = sorted({t for r in pubs for t in r["item"]["oscpub"]["tags"]})
    pub_summary = {
        "source": "U.S. Office of Special Counsel: reports (annual reports to Congress, budget justifications, performance reports and others), testimonies, Hatch Act advisory opinions and press releases",
        "source_page": "https://www.osc.gov/resources/reports/", "terms": "osc.gov publishes no robots.txt or reuse terms beyond U.S. Government works; read at one request per 1.1 s.",
        "coverage": f"{len(pubs)} items: " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())),
        "fields": "Titles, groups and links are as OSC lists them. Year is the fiscal year a report title names, or the year of the date OSC prints (a testimony title's trailing date, a press release's date); otherwise Not recorded. Tags on press releases are OSC's own.",
        "stats": dict(stats), "records": len(pubs),
    }
    lb2 = rw.listing([("kind", "Type"), ("group", "Group"), ("date", "Date"), ("year", "Year")],
                     [("kind", "Type", KINDS), ("group", "Group on osc.gov", {g: g for g in groups}), ("year", "Year", {y: y for y in pyears}),
                      ("tag", "OSC tag (press releases)", {t: t for t in ptags})])
    rw.write_build(PUBS, "OSC reports, advisory opinions, testimonies and press releases", pubs, lb2, pub_summary, inputs)


if __name__ == "__main__":
    main()
