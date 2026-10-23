"""Build sec_enforcement_actions: SEC litigation releases and administrative proceedings, as listed on sec.gov.

  python3 -I -B scripts/enrichment/enforcement_actions/build_sec.py

Reads only private/acq/enforcement_actions/sec/ and the saved lookups. Litigation releases add, from the release
text itself, the civil action number(s), court (full name or Bluebook district citation mapped to exactly one current
district court), dollar figures with their sentence, and statutes cited. Respondents are shown exactly as the SEC
lists them; a respondent links to /companies/<CIK> only on a unique exact normalised name.
"""
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_common as bc  # noqa: E402
import enf_common as ec  # noqa: E402
import extract as ex  # noqa: E402
import links  # noqa: E402
import sec_parse  # noqa: E402

LIST_DIR = os.path.join(ec.ACQ, "sec", "listing")
LR_DIR = os.path.join(ec.ACQ, "sec", "releases")
LR_LIST = "https://www.sec.gov/enforcement-litigation/litigation-releases"
AP_LIST = "https://www.sec.gov/enforcement-litigation/administrative-proceedings"
SERIES = {
    "33": "Securities Act of 1933 release", "34": "Securities Exchange Act of 1934 release",
    "IA": "Investment Advisers Act of 1940 release", "IC": "Investment Company Act of 1940 release",
    "AAE": "Accounting and Auditing Enforcement release", "LR": "Litigation release",
}


def respondent_parts(respondents):
    """Respondent names as listed, split on ', ' / ' and ' / ';' (each part is a verbatim span)."""
    if not respondents:
        return []
    parts = re.split(r";\s|,\s(?:and\s)?|\sand\s", respondents)
    return [p.strip(" ,.") for p in parts if p and p.strip(" ,.")]


def listed(kind_url):
    reader = ec.PackReader(LIST_DIR)
    rows, seen = [], set()
    for row in reader.rows_by_pack():
        if not row["url"].startswith(kind_url):
            continue
        for item in sec_parse.parse_listing(reader.get(row["url"]).decode("utf-8", "replace")):
            key = (item["release_number"], item["url"])
            if key in seen:
                continue
            seen.add(key)
            item["listing_url"] = row["url"]
            rows.append(item)
    return rows


def release_text(url, reader):
    body = reader.get(url) if url in reader.index else None
    if body is None:
        return None, None
    raw = body.decode("utf-8", "replace")
    if url.lower().endswith(".txt"):
        # plain-text releases are hard-wrapped (CRLF): a blank line ends a paragraph, a single line break is a space
        plain = raw.replace("\r\n", "\n").replace("\r", "\n")
        return None, ex.html_to_text("</p>".join(re.sub(r"[ \t]*\n[ \t]*", " ", p) for p in re.split(r"\n[ \t]*\n", plain)))
    html_body = sec_parse.release_body(raw)
    if html_body is None and ("<html" in raw[:500].lower() or "<!doctype" in raw[:500].lower()):
        # older static releases: the whole page body is the release
        m = re.search(r"<body[^>]*>(.*)</body>", raw, re.S | re.I)
        html_body = m.group(1) if m else raw
    return sec_parse.page_title(raw), ex.html_to_text(html_body or "")


def main():
    companies = links.Companies()
    courts = links.Courts()
    reader = ec.PackReader(LR_DIR) if os.path.exists(os.path.join(LR_DIR, "index.jsonl")) else None
    stats = Counter()
    rows = []
    span_failures = 0
    for item in listed(LR_LIST):
        number = item["release_number"]
        rid = "sec-lr:" + re.sub(r"[^A-Za-z0-9-]", "", number or "").upper()
        if not number or rid in {r["id"] for r in rows[-50:]}:
            stats["lr_skipped_duplicate"] += 1
            continue
        title, text = (release_text(item["url"], reader) if reader else (None, None))
        civil, court_list, amounts, statutes, excerpt = [], [], [], [], None
        if text:
            civil = [d for d in ex.extract_dockets(text) if d["form"] != "MDL number"][:6]
            cites = ex.extract_court_cites(text, limit=6)
            names = ex.extract_courts(text, limit=6)
            seen_c = set()
            for c in cites + names:
                cid = c.get("court_id")
                if cid and not courts.valid(cid):
                    cid = None
                if (c["as_written"], cid) in seen_c:
                    continue
                seen_c.add((c["as_written"], cid))
                court_list.append({"as_written": c["as_written"], "court_id": cid, "offset": c["offset"]})
            spans = ex.sentence_spans(text)
            amounts = ex.extract_amounts(text, spans, limit=8)
            statutes = ex.extract_statutes(text, limit=10)
            span_failures += ex.verify_spans(text, civil + court_list + amounts + statutes)
            excerpt, _ = bc.clip(text, 900)
            stats["lr_text_read"] += 1
        parts = respondent_parts(item["respondents"])
        company_links = []
        for part in parts:
            m = companies.match(part)
            if m:
                company_links.append({**m, "as_written": part})
        court_ids = sorted({c["court_id"] for c in court_list if c.get("court_id")})
        resolution = [a["value_usd"] for a in amounts if a.get("value_usd") and a.get("keyword") in ex.RESOLUTION_KINDS
                      and a["value_usd"] < ex.RESOLUTION_CAP_USD]
        max_res = max(resolution) if resolution else None
        # the release's own figure: the page title's resolution figure, else the first resolution sentence
        headline = ex.headline_figure(title, amounts) if text else None
        if headline:
            stats["lr_headline_from_" + ("title" if headline["source"] == "title" else "first_resolution_sentence")] += 1
            in_source = headline["as_written"] in (title or "") if headline["source"] == "title" else (
                headline["as_written"] in (headline.get("sentence") or "") and headline.get("sentence") in text)
            span_failures += not in_source
            headline["differs_from_largest"] = max_res is not None and abs(headline["value_usd"] - max_res) > 0.005
            stats["lr_headline_differs_from_largest"] += headline["differs_from_largest"]
        stats["lr"] += 1
        stats["lr_with_civil_action"] += bool(civil)
        stats["lr_with_court_id"] += bool(court_ids)
        stats["lr_company_links"] += len(company_links)
        year = (item["date"] or "")[:4]
        link_list = [{"url": item["url"], "label": "SEC litigation release"}]
        link_list += [{"url": s["url"], "label": s["label"] or "Related document"} for s in item["see_also"][:6]]
        link_list += [{"url": f"/courts/{cid}", "label": f"Court: {courts.name(cid)}"} for cid in court_ids]
        link_list += [{"url": f"/companies/{c['cik']}", "label": f"SEC registrant: {c['registrant']} (exact name match)"} for c in company_links]
        action = {
            "type": "Litigation release", "release_number": number, "date": item["date"], "respondents": item["respondents"],
            "url": item["url"], "title": title, "civil_actions": [{"as_written": d["as_written"]} for d in civil],
            "courts": [{"as_written": c["as_written"], "court_id": c.get("court_id")} for c in court_list],
            "amounts": [{k: a[k] for k in ("as_written", "value_usd", "keyword", "sentence") if k in a} for a in amounts[:6]],
            "max_resolution_amount_usd": max_res, "headline_figure": headline, "statutes": [s["cite"] for s in statutes],
            "see_also": item["see_also"][:6], "companies": company_links, "text_read": bool(text), "excerpt": excerpt,
        }
        rows.append(bc.record(
            "sec_enforcement_actions", rid, item["respondents"] or number, source_url=item["url"],
            subtitle=" · ".join(x for x in [number, item["date"], "; ".join(d["as_written"] for d in civil[:2]) or None] if x),
            cells={"respondents": item["respondents"], "type": "Litigation release", "release": number, "date": item["date"],
                   "civil_action": "; ".join(d["as_written"] for d in civil) or bc.NOT_RECORDED,
                   "court": "; ".join(c["as_written"] for c in court_list[:2]) or bc.NOT_RECORDED},
            facts=[("Respondents (as listed by the SEC)", item["respondents"]), ("Release number", number), ("Date", item["date"]),
                   ("Type", "Litigation release"), ("Civil action number (as stated)", [d["as_written"] for d in civil]),
                   ("Court (as stated)", [c["as_written"] for c in court_list]),
                   ("Headline figure", (f"{headline['as_written']} (stated in the title)" if headline["source"] == "title"
                                        else f"{headline['as_written']} (first resolution sentence: “{headline.get('sentence')}”)") if headline else None),
                   ("Largest resolution figure stated", bc.money_label(max_res) if max_res is not None else None),
                   ("Dollar figures stated", [f"{a['as_written']} ({a.get('keyword') or 'no keyword in sentence'})" for a in amounts[:6]]),
                   ("Statutes cited", [s["cite"] for s in statutes]),
                   ("Release text read", "yes" if text else "no (listing row only)"), ("Source", "sec.gov litigation releases")],
            text=" ".join(filter(None, [item["respondents"], number, title, " ".join(d["as_written"] for d in civil)])),
            filters={"type": ["litigation_release"], "year": [year] if year else [], "court": court_ids,
                     "amount": [bc.amount_bucket(max_res)], "has_civil_action": ["yes" if civil else "no"],
                     "company": [c["cik"] for c in company_links]},
            links=link_list, extra={"sec_action": action},
        ))
    for item in listed(AP_LIST):
        number = item["release_number"]
        rid = "sec-ap:" + re.sub(r"[^A-Za-z0-9;.-]", "", number or "").upper()
        if not number:
            stats["ap_skipped_no_number"] += 1
            continue
        prefix = re.split(r"[-;]", number)[0].upper()
        series = SERIES.get(prefix)
        parts = respondent_parts(item["respondents"])
        company_links = []
        for part in parts:
            m = companies.match(part)
            if m:
                company_links.append({**m, "as_written": part})
        stats["ap"] += 1
        stats["ap_company_links"] += len(company_links)
        year = (item["date"] or "")[:4]
        link_list = [{"url": item["url"], "label": "SEC administrative proceeding document"}]
        link_list += [{"url": s["url"], "label": s["label"] or "Related document"} for s in item["see_also"][:6]]
        link_list += [{"url": f"/companies/{c['cik']}", "label": f"SEC registrant: {c['registrant']} (exact name match)"} for c in company_links]
        action = {
            "type": "Administrative proceeding", "release_number": number, "series": series, "date": item["date"],
            "respondents": item["respondents"], "file_number": item["file_number"], "url": item["url"],
            "see_also": item["see_also"][:6], "companies": company_links,
        }
        rows.append(bc.record(
            "sec_enforcement_actions", rid, item["respondents"] or number, source_url=item["url"],
            subtitle=" · ".join(x for x in [number, item["date"], f"File No. {item['file_number']}" if item["file_number"] else None] if x),
            cells={"respondents": item["respondents"], "type": "Administrative proceeding", "release": number, "date": item["date"],
                   "civil_action": "Not applicable (administrative)", "court": "Not applicable (administrative)"},
            facts=[("Respondents (as listed by the SEC)", item["respondents"]), ("Release number", number), ("Release series", series),
                   ("Date", item["date"]), ("Type", "Administrative proceeding"), ("Administrative file number", item["file_number"]),
                   ("Source", "sec.gov administrative proceedings list")],
            text=" ".join(filter(None, [item["respondents"], number, item["file_number"]])),
            filters={"type": ["administrative_proceeding"], "year": [year] if year else [], "series": [prefix] if series else [],
                     "company": [c["cik"] for c in company_links]},
            links=link_list, extra={"sec_action": action},
        ))
    # duplicates (the same release listed twice across page shifts) keep the first occurrence
    unique, seen = [], set()
    for r in rows:
        if r["id"] in seen:
            stats["duplicate_ids_dropped"] += 1
            continue
        seen.add(r["id"])
        unique.append(r)
    unique.sort(key=lambda r: r["item"]["sec_action"]["date"] or "", reverse=True)
    stats["span_failures"] = span_failures
    summary = {
        "source": "SEC litigation releases and administrative proceedings lists (sec.gov), with each litigation release's own text",
        "source_pages": [LR_LIST, AP_LIST], "terms": "U.S. Government work (sec.gov); read with a declared User-Agent at no more than 4 requests/s (SEC fair access allows 10/s)",
        "coverage": "Litigation releases LR-14644 (Sept. 1995) onward and administrative proceedings from Sept. 1995 onward, as listed on 2026-10-22",
        "extraction": "Civil action numbers, courts, dollar figures (with the sentence and the first keyword in it) and statutes are spans of the release text; a court links to /courts/<id> only when its full name or Bluebook district citation maps to exactly one current district court",
        "matching": "Respondents link to /companies/<CIK> only on a unique exact normalised name (extract.normalize_company)",
        "named_individuals": "Shown exactly as the SEC publishes them (owner decision 2026-10-22); nothing is inferred about a person",
        "stats": dict(stats),
    }
    bc.write_build("sec_enforcement_actions", "SEC enforcement actions (litigation releases and administrative proceedings)", unique,
                   bc.listing([("respondents", "Respondents"), ("type", "Type"), ("release", "Release no."), ("date", "Date"), ("civil_action", "Civil action no."), ("court", "Court")],
                              [("type", "Type", {"litigation_release": "Litigation release", "administrative_proceeding": "Administrative proceeding"}),
                               ("amount", "Largest resolution figure stated", bc.AMOUNT_BUCKETS),
                               ("has_civil_action", "Civil action number stated", {"yes": "Yes", "no": "No"})]),
                   summary, bc.manifest_inputs(["private/acq/enforcement_actions/sec/"]))
    print(json.dumps(dict(stats)))
    print(json.dumps({"company_match": companies.stats}))


if __name__ == "__main__":
    main()
