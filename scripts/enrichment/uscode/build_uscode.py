"""Build the corpus datasets us_code_titles and us_code_sections from one parsed OLRC release point.

  python3 -I -B scripts/enrichment/uscode/build_uscode.py <release>

Reads private/build/uscode/parsed/<release>/ (parse_release.py), private/acq/uscode/<release>/release.json,
private/build/uscode/govinfo_editions.json (govinfo_editions.py) and official_urls_<release>.json
(check_official_urls.py). Writes private/build/uscode/us_code_titles.json and us_code_sections.json.gz in the
publish_build format {"dataset", "label", "listing_block", "summary", "rows", "built_at", "inputs"}.

Row shapes (read by src/lib/external/usCode.functions.ts):
  us_code_titles   id "<title key>" ("42", "5a"); detail.usc_title = {key, number, name, appendix, positive_law,
                   release, law_date, units, by_status, outline: [[index, parent, depth, kind, num, heading, status,
                   units_total, units_direct]], govinfo_years, zip, official_url}
  us_code_sections id "<title key>:<unit key>" ("42:1983"); text = the printed body (bodytext.py encoding);
                   detail.usc = {release, title, key, kind, identifier, citation, num, num_value, heading, status,
                   path, footnotes, credit, notes: [{g, t, h, l, f}], url, url_kind, prev, next, govinfo_years}
                   filters: title, parent, container (every enclosing container), status, kind
"""
import argparse
import datetime
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bodytext  # noqa: E402
import cite  # noqa: E402
import fetchlib  # noqa: E402
import parse_release  # noqa: E402

STATUS_LABELS = {"repealed": "Repealed", "omitted": "Omitted", "transferred": "Transferred",
                 "renumbered": "Renumbered", "reserved": "Reserved", "vacant": "Vacant",
                 "unknown": "Status marked unknown"}
KIND_LABELS = {"section": "Section", "courtRule": "Court rule", "reorganizationPlan": "Reorganization plan"}


def title_sort(key):
    return (int(cite.title_number(key)), key.endswith("a"))


def load_release(release):
    rel = json.loads((fetchlib.ACQ / release / "release.json").read_text())
    by_key = {t["key"].lower().lstrip("0"): t for t in rel["titles"]}
    return rel, by_key


def official_urls(release):
    path = fetchlib.BUILD / f"official_urls_{release}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text()).get("units", {})


_GRANULES = {}


def title_granules(tkey, years):
    """{section number: [edition years]} from govinfo_granules.json when GovInfo's granule lists were read for every
    edition of the title; None otherwise (the section page then lists the title's editions)."""
    if "data" not in _GRANULES:
        path = fetchlib.BUILD / "govinfo_granules.json"
        _GRANULES["data"] = json.loads(path.read_text()) if path.exists() else None
    data = _GRANULES["data"]
    if not data or not years:
        return None
    if any(f"USCODE-{y}-title{tkey}" not in data["packages"] for y in years):
        return None
    return data["sections"].get(tkey, {})


def group_heading(unit, containers):
    for idx in reversed(unit["ancestors"]):
        if containers[idx]["kind"] == "courtRules":
            return containers[idx]["heading"]
    return None


def unit_url(release, tkey, u, urls):
    """(official URL, "section" | "title"): OLRC's page for the unit, else its title's page."""
    sid = f"{tkey}:{u['key']}"
    plain = cite.plain_section_path(tkey, u)
    if plain:
        return cite.BASE + f"{release}/" + plain, "section"
    if urls.get(sid, {}).get("url"):
        return urls[sid]["url"], "section"
    return cite.title_page(release, tkey), "title"


def section_rows(release, rel, tkey, head, containers, units, urls, years, granules=None):
    rows = []
    positive = head["meta"].get("is-positive-law") == "yes"
    for i, u in enumerate(units):
        sid = f"{tkey}:{u['key']}"
        citation = cite.citation(tkey, u, group_heading(u, containers))
        heading = u["heading"] or ""
        status = u["status"]
        label = STATUS_LABELS.get(status)
        url, url_kind = unit_url(release, tkey, u, urls)
        anc = [containers[a] for a in u["ancestors"]]
        path = [[c["index"], c["kind"], c["num"], c["heading"]] for c in anc if c["depth"] > 0 or c["kind"] != "title"]
        prev_u = units[i - 1] if i else None
        next_u = units[i + 1] if i + 1 < len(units) else None
        title_text = f"{citation} {heading}".strip()
        facts = [["Citation", citation]]
        if heading:
            facts.append(["Heading", heading])
        if label:
            facts.append(["Status", label])
        facts.append(["Release point", f"{release} (current through Public Law {release}, {rel['law_date_text']})"])
        facts.append(["Positive law title", "Yes" if positive else "No"])
        if u["source_credit"]:
            facts.append(["Source credit", u["source_credit"]])
        usc = {
            "release": release,
            "law_date": rel["law_date"],
            "title": tkey,
            "key": u["key"],
            "kind": u["kind"],
            "identifier": u["identifier"],
            "citation": citation,
            "num": u["num"],
            "num_value": u["num_value"],
            "heading": heading,
            "status": status,
            "path": path,
            "footnotes": u["footnotes"],
            "credit": u["source_credit"],
            "notes": [{"g": n["group"], "t": n["topic"], "h": n["heading"], "l": n["lines"], "f": n["footnotes"]}
                      for n in u["notes"]],
            "url": url,
            "url_kind": url_kind,
            "prev": [prev_u["key"], cite.citation(tkey, prev_u, group_heading(prev_u, containers))] if prev_u else None,
            "next": [next_u["key"], cite.citation(tkey, next_u, group_heading(next_u, containers))] if next_u else None,
            "govinfo_years": years if not tkey.endswith("a") and u["kind"] == "section" else [],
        }
        if granules is not None and u["kind"] == "section" and not tkey.endswith("a"):
            parts = [cite.plain_section_path(tkey, {"kind": "section", "identifier": i})
                     for i in (u["identifier"] or "").split(" ")]
            secs = [p.split("/s", 1)[1].rstrip("/") for p in parts if p]
            usc["govinfo_years"] = granules.get(secs[0], []) if secs else []
            usc["govinfo_basis"] = "section"
        else:
            usc["govinfo_basis"] = "title"
        parent = u["ancestors"][-1] if u["ancestors"] else None
        row = {
            "dataset": "us_code_sections",
            "id": sid,
            "category": "us_code_sections",
            "state": "",
            "title": title_text,
            "source_url": url,
            "item": {"id": sid, "title": citation, "subtitle": heading,
                     "cells": {"citation": citation, "heading": heading, "status": label or "",
                               "title": cite.title_label(tkey)},
                     "badges": [label] if label else []},
            "detail": {"title": title_text, "facts": facts,
                       "links": [{"url": url, "label": "Office of the Law Revision Counsel (uscode.house.gov)"}],
                       "usc": usc},
            "text": bodytext.encode(u["lines"]),
            "filters": {"_listing": ["yes"], "title": [tkey],
                        "parent": [f"{tkey}:{parent}"] if parent is not None else [],
                        "container": [f"{tkey}:{a}" for a in u["ancestors"]],
                        "status": [status or "none"], "kind": [u["kind"]]},
        }
        rows.append(row)
    return rows


def title_row(release, rel, rel_title, tkey, head, containers, units, years):
    total = {c["index"]: 0 for c in containers}
    direct = {c["index"]: 0 for c in containers}
    by_status, by_kind = {}, {}
    for u in units:
        for a in u["ancestors"]:
            total[a] += 1
        if u["ancestors"]:
            direct[u["ancestors"][-1]] += 1
        by_status[u["status"] or "none"] = by_status.get(u["status"] or "none", 0) + 1
        by_kind[u["kind"]] = by_kind.get(u["kind"], 0) + 1
    outline = [[c["index"], c["parent"], c["depth"], c["kind"], c["num"], c["heading"], c["status"],
                total[c["index"]], direct[c["index"]]] for c in containers]
    positive_meta = head["meta"].get("is-positive-law") == "yes"
    name = rel_title["label"].split(" - ", 1)[1] if " - " in rel_title["label"] else rel_title["label"]
    if tkey.endswith("a"):
        root = next((c for c in containers if c["depth"] == 0), None)
        name = (root and root["heading"]) or name
    label = cite.title_label(tkey)
    official = cite.title_page(release, tkey)
    usc_title = {
        "key": tkey,
        "number": cite.title_number(tkey),
        "label": label,
        "name": name,
        "appendix": tkey.endswith("a"),
        "positive_law": positive_meta,
        "positive_law_mark": rel_title["positive_law"],
        "release": release,
        "law_date": rel["law_date"],
        "changed_in_release": rel_title["changed"],
        "units": len(units),
        "by_status": by_status,
        "by_kind": by_kind,
        "outline": outline,
        "govinfo_years": years if not tkey.endswith("a") else [],
        "zip": {"url": rel_title["xml_url"], "sha256": rel_title["sha256"], "bytes": rel_title["bytes"],
                "last_modified": rel_title["last_modified"]},
        "xml_file": head["file"],
        "official_url": official,
    }
    facts = [["Title", label], ["Name", name], ["Positive law", "Yes" if positive_meta else "No"],
             ["Units", len(units)], ["Release point", release], ["Current through", f"Public Law {release}, {rel['law_date_text']}"],
             ["Source file", rel_title["xml_url"]], ["SHA-256", rel_title["sha256"]]]
    title_text = f"{label}. {name}"
    return {
        "dataset": "us_code_titles",
        "id": tkey,
        "category": "us_code_titles",
        "state": "",
        "title": title_text,
        "source_url": rel_title["xml_url"],
        "item": {"id": tkey, "title": title_text, "subtitle": f"{len(units):,} units",
                 "cells": {"title": label, "name": name, "units": len(units),
                           "positive_law": "Yes" if positive_meta else "No", "current_through": release},
                 "badges": ["Positive law"] if positive_meta else []},
        "detail": {"title": title_text, "facts": facts,
                   "links": [{"url": official, "label": "Office of the Law Revision Counsel (uscode.house.gov)"}],
                   "usc_title": usc_title},
        "text": name,
        "filters": {"_listing": ["yes"], "positive_law": ["yes" if positive_meta else "no"],
                    "appendix": ["yes" if tkey.endswith("a") else "no"]},
    }


def listing(columns, filters):
    return {
        "page": 1, "limit": 50,
        "columns": [{"key": k, "label": label} for k, label in columns],
        "filters": [{"name": "q", "type": "search", "label": "Search"}] + [
            {"name": name, "type": "select", "label": label,
             "options": [{"label": v, "value": k, "count": c} for k, (v, c) in opts.items()]}
            for name, label, opts in filters],
    }


def write_build(path, dataset, label, rows, listing_block, summary, inputs):
    build = {"dataset": dataset, "label": label, "listing_block": listing_block, "summary": summary, "rows": rows,
             "built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "inputs": inputs}
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{dataset}: duplicate ids")
    data = json.dumps(build, ensure_ascii=False, separators=(",", ":")).encode()
    if str(path).endswith(".gz"):
        with gzip.open(path, "wb", compresslevel=6) as handle:
            handle.write(data)
    else:
        Path(path).write_bytes(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("release")
    args = ap.parse_args()
    release = args.release
    rel, rel_titles = load_release(release)
    urls = official_urls(release)
    editions = json.loads((fetchlib.BUILD / "govinfo_editions.json").read_text())
    title_rows, section_rows_all = [], []
    inputs = []
    files = sorted(parse_release.parsed_dir(release).glob("t*.jsonl.gz"),
                   key=lambda p: title_sort(p.name[1:].split(".")[0]))
    for f in files:
        head, containers, units = parse_release.read_parsed(f)
        tkey = head["key"]
        rt = rel_titles[tkey]
        if rt["sha256"] != head["zip_sha256"]:
            raise SystemExit(f"title {tkey}: parsed file does not match the acquired zip")
        years = editions["years"].get(tkey, [])
        title_rows.append(title_row(release, rel, rt, tkey, head, containers, units, years))
        section_rows_all.extend(section_rows(release, rel, tkey, head, containers, units, urls, years,
                                            title_granules(tkey, years)))
        inputs.append({"url": rt["xml_url"], "path": rt["path"], "sha256": rt["sha256"]})
    by_status, by_title = {}, {}
    for r in section_rows_all:
        s = r["filters"]["status"][0]
        by_status[s] = by_status.get(s, 0) + 1
        t = r["filters"]["title"][0]
        by_title[t] = by_title.get(t, 0) + 1
    common = {
        "source": "Office of the Law Revision Counsel, U.S. House of Representatives: United States Code, USLM XML "
                  f"release point {release} (https://uscode.house.gov/download.html)",
        "release_point": release,
        "current_through": f"Public Law {release} ({rel['law_date_text']})",
        "law_date": rel["law_date"],
        "licence": "Public domain (work of the United States Government, 17 U.S.C. 105)",
        "retrieved_at": rel["retrieved_at"],
    }
    t_summary = {**common, "titles": len(title_rows), "units": len(section_rows_all),
                 "note": "One record per title file of the release point (54 titles less reserved title 53, plus the "
                         "appendices to titles 5, 11, 18, 28 and 50). Outline = OLRC's own hierarchy; unit counts are "
                         "counted from the XML."}
    s_summary = {**common, "units": len(section_rows_all), "by_status": by_status, "by_title": by_title,
                 "text": "Section text, source credit and notes as OLRC prints them (whitespace collapsed; footnote "
                         "references printed as [n]). Status values are OLRC's own @status markings.",
                 "official_url": "Release-pinned page https://uscode.house.gov/us/usc/<release>/t<title>/s<section>/ "
                                 "where OLRC publishes one; otherwise the title's page."}
    tl = listing([("title", "Title"), ("name", "Name"), ("units", "Units"), ("positive_law", "Positive law")],
                 [("positive_law", "Positive law", {"yes": ("Yes", sum(1 for r in title_rows if r["filters"]["positive_law"] == ["yes"])),
                                                    "no": ("No", sum(1 for r in title_rows if r["filters"]["positive_law"] == ["no"]))})])
    sl = listing([("citation", "Citation"), ("heading", "Heading"), ("status", "Status")],
                 [("title", "Title", {t: (cite.title_label(t), n) for t, n in sorted(by_title.items(), key=lambda kv: title_sort(kv[0]))}),
                  ("status", "Status", {s: (STATUS_LABELS.get(s, "No status marked"), n) for s, n in sorted(by_status.items())})])
    n1 = write_build(fetchlib.BUILD / "us_code_titles.json", "us_code_titles", "United States Code: titles",
                     title_rows, tl, t_summary, inputs)
    n2 = write_build(fetchlib.BUILD / "us_code_sections.json.gz", "us_code_sections", "United States Code: sections",
                     section_rows_all, sl, s_summary, inputs)
    sizes = sorted((len(json.dumps(r, ensure_ascii=False)), r["id"]) for r in section_rows_all)
    print(json.dumps({"titles": len(title_rows), "sections": len(section_rows_all), "titles_json_bytes": n1,
                      "sections_json_bytes": n2, "largest_rows": sizes[-5:], "by_status": by_status,
                      "url_kinds": {k: sum(1 for r in section_rows_all if r["detail"]["usc"]["url_kind"] == k)
                                    for k in ("section", "title")}}))


if __name__ == "__main__":
    main()
