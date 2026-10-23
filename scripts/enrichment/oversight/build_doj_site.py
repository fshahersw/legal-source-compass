"""Build `doj_cep_resolutions` (Criminal Division Corporate Enforcement Policy voluntary self-disclosure resolutions) and
`doj_document_index` (DOJ budget and performance documents, No FEAR Act EEO data, DOJ Libraries research guides).

  python3 -I -B scripts/enrichment/oversight/build_doj_site.py

Reads only private/acq/oversight/justice_gov/ plus the saved SEC registrant lookup the other enforcement builders use
(enforcement_actions/lookup_company_sec_profiles.json). Titles, labels and links are exactly as justice.gov prints
them. A resolution links to a company profile only on an exact normalised name key shared with exactly one registrant.
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "enforcement_actions"))
import common as cm  # noqa: E402
import extract as ex  # noqa: E402
import match  # noqa: E402
import parse_doj_site as pd  # noqa: E402
import rows as rw  # noqa: E402

CEP = "doj_cep_resolutions"
INDEX = "doj_document_index"
JUSTICE = os.path.join(cm.ACQ, "justice_gov")
COMPANY_LOOKUP = os.path.join(os.path.dirname(HERE), "enforcement_actions", "lookup_company_sec_profiles.json")
PAGE = {
    "budget": "https://www.justice.gov/doj/budget-and-performance",
    "cep": "https://www.justice.gov/criminal/criminal-fraud/vsd-resolutions-part-1",
    "eeo": "https://www.justice.gov/jmd/eeo-program-status-report",
    "library": "https://www.justice.gov/jmd/ls",
}
# The Library Staff menu also lists an internship page, which is not a research resource.
LIBRARY_EXCLUDED = {"Internships for Library Students"}


def read(name):
    return cm.read_gz(os.path.join(JUSTICE, f"{name}.html.gz")).decode("utf-8")


def cep_record(r, companies):
    name = pd.company_name(r["label"])
    rid = rw.stable_id("cep", r["url"] + "|" + r["label"])
    hit = companies.match(name)
    year = int(r["date"][:4]) if r["date"] else None
    body = {"company": name, "label": r["label"], "date": r["date"], "date_text": r["date_text"], "year": year, "url": r["url"],
            "company_cik": hit["cik"] if hit else None}
    links = [{"url": r["url"], "label": "Resolution letter (justice.gov)"}, {"url": PAGE["cep"], "label": "Criminal Division list"}]
    if hit:
        links.append({"url": f"/companies/{hit['cik']}", "label": f"Company profile: {hit['registrant']}"})
    facts = [("Company (as the Criminal Division lists it)", r["label"]), ("Date listed", r["date_text"]), ("Date (ISO)", r["date"]),
             ("Listed on", "Criminal Division, Corporate Enforcement and Compliance Unit: CEP VSD Resolutions (Part 1)"),
             ("Company profile link", f"{hit['registrant']} (CIK {hit['cik']}), {hit['method']}" if hit else "None: no registrant has this exact name key")]
    return rw.record(
        CEP, rid, r["label"], source_url=r["url"], subtitle=f"Listed {r['date_text']}",
        cells={"company": name, "date": r["date"] or rw.NOT_RECORDED, "profile": hit["registrant"] if hit else rw.NOT_RECORDED},
        facts=facts, links=links,
        filters={"year": [str(year)] if year else [], "has_profile": ["yes" if hit else "no"], **({"company": [hit["cik"]]} if hit else {})},
        extra={"cep": body}, text=" ".join([r["label"], name, r["date_text"]]))


def index_record(kind, group, title, url, source_page, *, year=None, entity=None, file_kind=None, note=None):
    rid = rw.stable_id("dojdoc", f"{kind}|{url}|{title}|{group}")
    body = {"kind": kind, "group": group, "title": title, "url": url, "entity": entity, "year": year, "file_kind": file_kind}
    facts = [("Collection", {"budget": "Budget and performance", "eeo": "No FEAR Act EEO data", "library": "DOJ Libraries research guides"}[kind]),
             ("Group as printed", group), ("Entity", entity), ("Year as printed in the label", year), ("File", file_kind), ("Listed on", source_page)]
    return rw.record(
        INDEX, rid, title, source_url=url, subtitle=" · ".join(x for x in [group, file_kind] if x),
        cells={"kind": body["kind"], "group": group or rw.NOT_RECORDED, "year": str(year) if year else rw.NOT_RECORDED},
        facts=facts, links=[{"url": url, "label": "On justice.gov"}],
        filters={"kind": [kind], "group": [group] if group else [], "year": [str(year)] if year else []},
        extra={"dojdoc": body}, text=" ".join(x for x in [title, group, entity, file_kind] if x))


def label_year(label, title_attr):
    """A four-digit year printed in the link label ('FY 2020', '2025', 'FY 2019/FY 2021' -> the first); else None."""
    import re
    m = re.search(r"(?:19|20)\d{2}", label) or re.search(r"(?:19|20)\d{2}", title_attr or "")
    return int(m.group(0)) if m else None


def main():
    rows = json.load(open(COMPANY_LOOKUP, encoding="utf-8"))["rows"]
    companies = match.Companies(rows, ex.normalize_company)
    resolutions = pd.parse_resolutions(pd.body_block(read("vsd_resolutions_part_1")))
    if not resolutions:
        raise SystemExit("no resolutions parsed")
    cep_rows = [cep_record(r, companies) for r in resolutions]
    ids = [r["id"] for r in cep_rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate CEP ids")
    index_rows = []
    for e in pd.parse_budget_page(read("budget_and_performance")):
        title = e["title_attr"] or (f"{e['group']}: {e['label']}" if e["label"] != e["group"] else e["label"])
        if e["group"] in ("Departmental Strategic Plans",):
            title = e["label"]
        index_rows.append(index_record("budget", e["group"], title, e["url"], PAGE["budget"], year=label_year(e["label"], e["title_attr"])))
    for e in pd.parse_eeo_page(read("eeo_program_status_report")):
        index_rows.append(index_record("eeo", e["group"], f"{e['entity']} ({e['kind']})", e["url"], PAGE["eeo"], entity=e["entity"], file_kind=e["kind"],
                                       year=label_year(e["group"], None)))
    for g in pd.parse_library_guides(read("library_staff")):
        if g["title"] not in LIBRARY_EXCLUDED:
            index_rows.append(index_record("library", "DOJ Libraries (Library Staff)", g["title"], g["url"], PAGE["library"]))
    ids = [r["id"] for r in index_rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate index ids")
    inputs = rw.manifest_inputs([cm.rel(JUSTICE)])
    dates = [r["date"] for r in resolutions if r["date"]]
    cep_summary = {
        "source": "U.S. Department of Justice, Criminal Division, Corporate Enforcement and Compliance Unit: CEP VSD Resolutions (Part 1), the list that was published as the Corporate Enforcement Policy declinations",
        "source_page": PAGE["cep"],
        "terms": "justice.gov robots.txt sets Crawl-delay 10, honoured; U.S. Government work",
        "coverage": f"{len(cep_rows)} resolutions listed, dated {min(dates)} to {max(dates)} (the list's own dates)",
        "fields": "The label is the company as the Criminal Division prints it (including 'In re:' and 'f/k/a' text); the printed date is converted to ISO, a two-digit year read as 20YY (the policy began in 2016). The letter is linked, not copied. The page does not say whether each is a declination or another resolution, so none is labelled as one.",
        "matching": "A company profile is linked only when normalize_company(label without 'In re:') equals the key of exactly one SEC registrant in the saved profile lookup; there are no similarity matches.",
        "stats": {"companies": companies.stats, "profile_links": sum(1 for r in cep_rows if r["item"]["cep"]["company_cik"]), "lookup_rows": len(companies.names)},
    }
    lb = rw.listing([("company", "Company"), ("date", "Date listed"), ("profile", "Company profile")],
                    [("year", "Year listed", {y: y for y in sorted({r["filters"]["year"][0] for r in cep_rows if r["filters"]["year"]}, reverse=True)}),
                     ("has_profile", "Company profile", {"yes": "Linked (exact name)", "no": "Not linked"})])
    rw.write_build(CEP, "DOJ Criminal Division corporate enforcement (CEP) voluntary self-disclosure resolutions", cep_rows, lb, cep_summary, inputs)
    kinds = Counter(r["item"]["dojdoc"]["kind"] for r in index_rows)
    idx_summary = {
        "source": "U.S. Department of Justice pages: Budget and Performance, Data Posted Pursuant to the No FEAR Act, and DOJ Libraries (Library Staff)",
        "source_page": PAGE["budget"], "terms": "justice.gov robots.txt sets Crawl-delay 10, honoured; U.S. Government work. Only the indexes' own labels and links are stored; the documents are not copied.",
        "coverage": ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())),
        "fields": "Group, label and link are as printed. The Justice Manual is out of scope. The Library entries are the five research guides on the Library Staff page (the internship page is excluded).",
        "stats": dict(kinds),
    }
    lb2 = rw.listing([("kind", "Collection"), ("group", "Group"), ("year", "Year")],
                     [("kind", "Collection", {"budget": "Budget and performance", "eeo": "No FEAR Act EEO data", "library": "DOJ Libraries research guides"}),
                      ("group", "Group", {g: g for g in sorted({r["item"]["dojdoc"]["group"] for r in index_rows if r["item"]["dojdoc"]["group"]})})])
    rw.write_build(INDEX, "DOJ budget, performance, EEO data and Library document index", index_rows, lb2, idx_summary, inputs)


if __name__ == "__main__":
    main()
