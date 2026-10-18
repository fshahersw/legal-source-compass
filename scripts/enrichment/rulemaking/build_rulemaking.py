"""Federal Register rulemaking activity by agency (federalregister.gov API v1).

For each agency: yearly and monthly counts of final rules, proposed rules and notices; yearly counts of
rules and proposed rules whose Unified Agenda entry is deemed significant under EO 12866; and the most
recent significant final rules. Counts come from the API's facet endpoints; nothing is estimated.

A flag marks an agency/type whose last 12 complete months run unusually high against the same agency's
prior three-year monthly rate (Poisson tail, the same rule used by build_safety_insights.py).

Usage: python build_rulemaking.py [--dry-run] [--as-of=YYYY-MM-DD]
"""
import concurrent.futures as futures
import datetime as dt
import json
import math
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import corpus_writer as writer  # noqa: E402

DATASET = "regulatory_federal_register_activity"
BASE = "https://www.federalregister.gov/api/v1/"
CA = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
CONTEXT = ssl.create_default_context(cafile=CA) if CA else ssl.create_default_context()
HEADERS = {"User-Agent": "SeegerWeiss Research firasshaher99@gmail.com"}
RAW = os.path.join(os.path.dirname(__file__), "..", "..", "..", "private", "acq", "rulemaking")

AGENCIES = [
    ("food-and-drug-administration", "FDA", "Food and Drug Administration"),
    ("consumer-product-safety-commission", "CPSC", "Consumer Product Safety Commission"),
    ("national-highway-traffic-safety-administration", "NHTSA", "National Highway Traffic Safety Administration"),
    ("environmental-protection-agency", "EPA", "Environmental Protection Agency"),
    ("federal-trade-commission", "FTC", "Federal Trade Commission"),
    ("occupational-safety-and-health-administration", "OSHA", "Occupational Safety and Health Administration"),
    ("centers-for-medicare-medicaid-services", "CMS", "Centers for Medicare & Medicaid Services"),
    ("drug-enforcement-administration", "DEA", "Drug Enforcement Administration"),
    ("federal-aviation-administration", "FAA", "Federal Aviation Administration"),
    ("consumer-financial-protection-bureau", "CFPB", "Consumer Financial Protection Bureau"),
    ("securities-and-exchange-commission", "SEC", "Securities and Exchange Commission"),
    ("pipeline-and-hazardous-materials-safety-administration", "PHMSA", "Pipeline and Hazardous Materials Safety Administration"),
]
TYPES = [("RULE", "Final rules"), ("PRORULE", "Proposed rules"), ("NOTICE", "Notices")]
MONTHLY_FROM = "2018-01-01"
LIST_FIELDS = ["title", "publication_date", "citation", "html_url", "document_number", "abstract", "effective_on", "cfr_references", "regulation_id_numbers"]


def get(path, params):
    query = urllib.parse.urlencode(params, doseq=True)
    url = f"{BASE}{path}?{query}"
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, context=CONTEXT, timeout=90) as response:
                return url, json.loads(response.read())
        except urllib.error.HTTPError as error:
            # The API answers bursts with 403/429; back off and retry before giving up.
            if error.code in (403, 429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt * 3)
                continue
            raise RuntimeError(f"{error.code} for {url}") from None
        except urllib.error.URLError:
            if attempt < 4:
                time.sleep(2 ** attempt * 2)
                continue
            raise


def facet(kind, slug, doc_type, extra=None, since=None):
    params = {"conditions[agencies][]": slug, "conditions[type][]": doc_type}
    if since:
        params["conditions[publication_date][gte]"] = since
    params.update(extra or {})
    url, body = get(f"documents/facets/{kind}", params)
    series = {}
    for key, value in (body or {}).items():
        count = value.get("count") if isinstance(value, dict) else None
        if isinstance(count, int):
            series[key[:4] if kind == "yearly" else key[:7]] = count
    return url, dict(sorted(series.items()))


def significant_yearly(slug, doc_type):
    """Yearly counts of significant documents, tallied from the full listing (the facet endpoint refuses this filter)."""
    params = {"conditions[agencies][]": slug, "conditions[type][]": doc_type, "conditions[significant]": "1",
              "per_page": "1000", "order": "oldest", "fields[]": ["publication_date", "document_number"]}
    url, body = get("documents.json", params)
    first_url, total, seen, counts = url, body.get("count"), set(), {}
    while True:
        for doc in body.get("results", []):
            if doc.get("document_number") in seen:
                continue
            seen.add(doc.get("document_number"))
            year = (doc.get("publication_date") or "")[:4]
            if year.isdigit():
                counts[year] = counts.get(year, 0) + 1
        next_url = body.get("next_page_url")
        if not next_url:
            break
        _, body = get(next_url[len(BASE):].split("?", 1)[0], urllib.parse.parse_qs(next_url.split("?", 1)[1]))
    if isinstance(total, int) and total != len(seen):
        raise RuntimeError(f"{slug} {doc_type}: listing returned {len(seen)} of {total} significant documents")
    return first_url, dict(sorted(counts.items()))


def significant_rules(slug, limit=12):
    params = {"conditions[agencies][]": slug, "conditions[type][]": "RULE", "conditions[significant]": "1",
              "order": "newest", "per_page": str(limit), "fields[]": LIST_FIELDS}
    url, body = get("documents.json", params)
    out = []
    for doc in body.get("results", []):
        out.append({
            "title": doc.get("title"),
            "date": doc.get("publication_date"),
            "citation": doc.get("citation"),
            "url": doc.get("html_url"),
            "document_number": doc.get("document_number"),
            "abstract": (doc.get("abstract") or "")[:600] or None,
            "effective_on": doc.get("effective_on"),
            "cfr": [f"{c.get('title')} CFR {c.get('part')}" for c in (doc.get("cfr_references") or []) if c.get("title") and c.get("part")][:6],
            "rin": (doc.get("regulation_id_numbers") or [])[:3],
        })
    return url, body.get("count"), out


def poisson_surprise(observed, expected):
    if observed <= 0:
        return 0.0
    lam = max(expected, 0.25)
    if observed <= lam:
        return 0.0
    terms = [-lam + k * math.log(lam) - math.lgamma(k + 1) for k in range(observed, observed + 600)]
    peak = max(terms)
    return min(-(peak + math.log(sum(math.exp(t - peak) for t in terms))) / math.log(10), 50.0)


def month_keys(end_exclusive, count):
    year, month = end_exclusive.year, end_exclusive.month
    keys = []
    for _ in range(count):
        month -= 1
        if month == 0:
            year, month = year - 1, 12
        keys.append(f"{year:04d}-{month:02d}")
    return list(reversed(keys))


def window_flags(monthly, as_of):
    """Last 12 complete months vs the prior 36 months' monthly rate, per document type."""
    first_of_month = as_of.replace(day=1)
    recent_keys = month_keys(first_of_month, 12)
    base_keys = month_keys(dt.date(int(recent_keys[0][:4]), int(recent_keys[0][5:]), 1), 36)
    flags = {}
    for doc_type, series in monthly.items():
        recent = sum(series.get(k, 0) for k in recent_keys)
        base = sum(series.get(k, 0) for k in base_keys)
        expected = base / 3
        surprise = poisson_surprise(recent, expected)
        ratio = recent / expected if expected else None
        flags[doc_type] = {
            "recent": recent, "baselineAnnual": round(expected, 1), "ratio": round(ratio, 2) if ratio else None,
            "window": f"{recent_keys[0]} to {recent_keys[-1]}", "baselineWindow": f"{base_keys[0]} to {base_keys[-1]}",
            "surprise": round(surprise, 2),
            "flag": "surge" if surprise >= 3 and (ratio or 0) >= 1.25 else ("slowdown" if ratio is not None and ratio <= 0.6 and expected >= 10 else None),
        }
    return flags


def build_agency(entry, as_of):
    slug, short, name = entry
    sources, yearly, monthly, significant = [], {}, {}, {}
    for doc_type, _ in TYPES:
        url, yearly[doc_type] = facet("yearly", slug, doc_type)
        sources.append(url)
        url, monthly[doc_type] = facet("monthly", slug, doc_type, since=MONTHLY_FROM)
        sources.append(url)
    for doc_type in ("RULE", "PRORULE"):
        url, significant[doc_type] = significant_yearly(slug, doc_type)
        sources.append(url)
    url, significant_total, latest = significant_rules(slug)
    sources.append(url)
    current_month = as_of.strftime("%Y-%m")
    return {
        "slug": slug, "short": short, "name": name,
        "yearly": yearly, "monthly": monthly, "significantYearly": significant,
        "significantFinalRulesTotal": significant_total, "latestSignificantRules": latest,
        "partialMonth": current_month, "partialYear": str(as_of.year),
        "flags": window_flags(monthly, as_of), "sources": sources,
    }


def to_record(agency, as_of):
    y = agency["yearly"]
    last_full = str(as_of.year - 1)
    cells = {
        "agency": agency["short"],
        "final_rules_last_year": str(y["RULE"].get(last_full, 0)),
        "proposed_last_year": str(y["PRORULE"].get(last_full, 0)),
        "notices_last_year": str(y["NOTICE"].get(last_full, 0)),
        "significant_final_rules": str(agency["significantFinalRulesTotal"] or 0),
        "as_of": as_of.isoformat(),
    }
    flagged = [f"{t}: {f['flag']}" for t, f in agency["flags"].items() if f["flag"]]
    return writer.record(
        DATASET, agency["slug"], f"{agency['name']} — Federal Register activity",
        source_url=f"https://www.federalregister.gov/agencies/{agency['slug']}",
        subtitle=f"{cells['final_rules_last_year']} final rules and {cells['proposed_last_year']} proposed rules in {last_full}",
        cells=cells,
        facts=[{"label": "Counted by", "value": "Federal Register API facet counts by publication date and document type"},
               {"label": "Significant", "value": "Associated Unified Agenda entry deemed significant under EO 12866"},
               {"label": "As of", "value": as_of.isoformat()}],
        text=" ".join([agency["name"], agency["short"], " ".join(flagged)]),
        filters={"agency": [agency["short"].lower()], "flag": ["yes" if flagged else "no"]},
        badges=[agency["short"]] + flagged,
        links=[{"url": f"https://www.federalregister.gov/agencies/{agency['slug']}", "label": "Federal Register agency page"}],
        extra={"kind": "rulemaking_activity", "activity": agency},
    )


def main(argv):
    as_of = next((dt.date.fromisoformat(a.split("=", 1)[1]) for a in argv if a.startswith("--as-of=")), dt.date.today())
    with futures.ThreadPoolExecutor(2) as pool:
        agencies = list(pool.map(lambda e: build_agency(e, as_of), AGENCIES))
    os.makedirs(RAW, exist_ok=True)
    with open(os.path.join(RAW, f"activity-{as_of.isoformat()}.json"), "w") as handle:
        json.dump(agencies, handle)
    for agency in agencies:
        flags = {t: f["flag"] for t, f in agency["flags"].items() if f["flag"]}
        print(agency["short"], {t: agency["yearly"][t].get(str(as_of.year - 1)) for t, _ in TYPES}, flags)
    if "--dry-run" in argv:
        return
    rows = [to_record(a, as_of) for a in agencies]
    writer.publish(
        DATASET, "Federal Register rulemaking activity by agency", rows,
        listing_block=writer.listing(
            [("agency", "Agency"), ("final_rules_last_year", f"Final rules {as_of.year - 1}"), ("proposed_last_year", f"Proposed {as_of.year - 1}"),
             ("notices_last_year", f"Notices {as_of.year - 1}"), ("significant_final_rules", "Significant final rules (all years)"), ("as_of", "As of")],
            [("flag", "Activity flag", {"yes": "Flagged", "no": "Not flagged"})],
        ),
        summary={"generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(), "as_of": as_of.isoformat(),
                 "agencies": len(rows), "source": "https://www.federalregister.gov/developers/documentation/api/v1",
                 "method": "Facet counts by publication date; significant = Unified Agenda entry deemed significant under EO 12866."},
    )


if __name__ == "__main__":
    main(sys.argv[1:])
