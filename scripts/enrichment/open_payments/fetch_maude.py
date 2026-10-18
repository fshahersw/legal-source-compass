"""MAUDE device adverse-event report counts (openFDA device/event) for device-linked manufacturers.

Matching rule (deterministic, documented in names.py): a MAUDE device manufacturer spelling
(device.manufacturer_d_name) is attributed to a company only when it names the same company as the company's
current name or one of its listed alternate / former names (case and punctuation ignored, legal forms must agree).

Phases
  1. Discovery: an openFDA phrase search per company name reads the 100 most frequent exact spellings (the
     keyless openFDA count limit) and keeps the spellings that pass the rule.
  2. One owner per spelling, within each source (CMS reporting entities; SEC registrants): when several companies
     claim the same spelling, the company whose CURRENT name matches it keeps it; if none or several do, the spelling
     is ambiguous and is excluded from every company (listed on each record for review).
  3. Counts: one count=date_received query over the company's final spellings (a report naming two of them counts
     once), and one coverage-denominator query over reports whose manufacturer name matches the phrase search OR
     one of those spellings. Coverage = attributed reports / denominator, per year; low coverage means most reports
     carrying the company's name are filed under plant, division or other spellings the rule does not attribute.

Scope: top-300 CMS entities with >= 10% of general dollars on device / medical-supply records, plus SEC registrants
from company_sec_profiles with drug or device SIC codes. FAERS is not attributed: its public data has no reliable
manufacturer field (openfda.manufacturer_name lists every labeler of a drug, including generics).

Run: python3 scripts/enrichment/open_payments/fetch_maude.py
Raw responses: private/acq/open-payments/maude/<key>_{discover_<n>,series_<hash>,denominator_<hash>}.json
"""
import datetime as dt
import hashlib
import json
import os
import sys
import urllib.parse
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from names import matches_any, normalize_company, queryable, search_phrase  # noqa: E402
from op_api import openfda, openfda_raw  # noqa: E402
from op_model import ACQ, load_api  # noqa: E402

OUT = os.path.join(ACQ, "maude")
BUDGET = 400  # hard cap on new openFDA requests per run (keyless daily quota is 1,000 per IP)
_used = [0]


def cached_openfda(path, params, file):
    target = os.path.join(OUT, file)
    if os.path.exists(target):
        return json.load(open(target))
    if _used[0] >= BUDGET:
        raise SystemExit(f"openFDA request budget of {BUDGET} reached; re-run tomorrow to continue from cache")
    _used[0] += 1
    url, data = openfda_raw(path, params) if isinstance(params, str) else openfda(path, params)
    payload = {"url": url, "retrieved_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "data": data}
    json.dump(payload, open(target, "w"))
    return payload


def digest(items):
    return hashlib.sha1("\n".join(sorted(items)).encode()).hexdigest()[:10]


def by_year(payload):
    out = defaultdict(int)
    for point in (payload["data"] or {}).get("results", []):
        out[str(point["time"])[:4]] += int(point["count"])
    return dict(out)


def entity_names():
    """{entity_id: ([current name, alternate names...], us_based)} from the CMS reporting-entity profile file."""
    out = {}
    for row in load_api("entity_profile")["rows"]:
        eid = str(row.get("amgpo_making_payment_id") or "").strip()
        names = [row.get("amgpo_making_payment_name")] + [row.get(f"amgpo_making_payment_alternate_name{i}") for i in range(1, 6)]
        out[eid] = ([n.strip() for n in names if isinstance(n, str) and n.strip()], (row.get("amgpo_making_payment_country") or "").strip() == "United States")
    return out


def discover(target):
    """Phase 1: candidate spellings for one company."""
    names, us_based, key = target["names"], target["usBased"], target["cacheKey"]
    phrases = sorted({search_phrase(n) for n in names if search_phrase(n)})
    matched, near, not_queried, urls = {}, {}, {}, []
    for i, phrase in enumerate(phrases):
        payload = cached_openfda(
            "device/event.json",
            {"search": f'device.manufacturer_d_name:"{phrase}"', "count": "device.manufacturer_d_name.exact", "limit": 100},
            f"{key}_discover_{i}.json",
        )
        urls.append(payload["url"])
        for term in (payload["data"] or {}).get("results", []):
            if matches_any(term["term"], names, us_based):
                (matched if queryable(term["term"]) else not_queried)[term["term"]] = term["count"]
            else:
                near[term["term"]] = max(near.get(term["term"], 0), term["count"])
    target.update({"phrases": phrases, "candidates": matched, "notQueried": not_queried, "near": near, "discoverUrls": urls})


def resolve_owners(targets):
    """Phase 2: one owner per spelling within a source; returns {spelling: [ids]} for ambiguous spellings."""
    claims = defaultdict(list)
    for t in targets:
        for spelling in t["candidates"]:
            claims[spelling].append(t)
    ambiguous = {}
    for spelling, owners in claims.items():
        if len(owners) == 1:
            continue
        current = [t for t in owners if matches_any(spelling, t["names"][:1], t["usBased"])]
        keep = current[0] if len(current) == 1 else None
        for t in owners:
            if t is keep:
                continue
            t["candidates"].pop(spelling, None)
            if keep is None:
                t.setdefault("ambiguous", []).append({"name": spelling, "owners": [o["id"] for o in owners]})
            else:
                t.setdefault("reassigned", []).append({"name": spelling, "owner": keep["id"]})
        if keep is None:
            ambiguous[spelling] = [o["id"] for o in owners]
    return ambiguous


def counts(target):
    """Phase 3: attributed reports and the coverage denominator, by year of date received."""
    key, matched = target["cacheKey"], sorted(target["candidates"])
    result = {
        "entityId": target["id"], "kind": target["kind"], "names": target["names"],
        "keys": sorted({normalize_company(n) for n in target["names"] if normalize_company(n)}),
        "discoverUrls": target["discoverUrls"], "matchedNames": {n: target["candidates"][n] for n in matched},
        "notQueried": target["notQueried"], "ambiguous": target.get("ambiguous", []), "reassigned": target.get("reassigned", []),
        # Spellings the phrase search returned that the rule does not attribute (plants, divisions, other companies
        # sharing a word). Review leads only, with all-time counts; never added to totals.
        "unattributed": sorted(target["near"].items(), key=lambda kv: -kv[1])[:8],
    }
    if not matched:
        return result
    exact = ['device.manufacturer_d_name.exact:"' + urllib.parse.quote(n, safe="") + '"' for n in matched]
    series = cached_openfda("device/event.json", f"search={'+'.join(exact)}&count=date_received", f"{key}_series_{digest(matched)}.json")
    phrase = ['device.manufacturer_d_name:"' + urllib.parse.quote(p, safe="") + '"' for p in target["phrases"]]
    denominator = cached_openfda("device/event.json", f"search={'+'.join(phrase + exact)}&count=date_received", f"{key}_denominator_{digest(matched + target['phrases'])}.json")
    reports, total = by_year(series), by_year(denominator)
    for year, n in reports.items():
        if n > total.get(year, 0):
            raise SystemExit(f"{target['id']} {year}: attributed {n} exceeds denominator {total.get(year)}")
    result.update({
        "seriesUrl": series["url"], "retrievedAt": series["retrieved_at"], "reportsByYear": reports,
        "denominatorUrl": denominator["url"], "denominatorByYear": total,
    })
    return result


def main():
    os.makedirs(OUT, exist_ok=True)
    spec = json.load(open(os.path.join(ACQ, "device_linked.json")))
    names = entity_names()
    op_targets = []
    for eid in spec["entities"]:
        refs, us_based = names.get(eid) or ([spec["names"][eid]], False)
        op_targets.append({"id": eid, "kind": "open_payments", "names": refs, "usBased": us_based, "cacheKey": eid})
    sec_targets = [
        {"id": s["cik"], "kind": "sec", "names": [s["name"], *s.get("former", [])], "usBased": s.get("usBased", False), "cacheKey": f"sec{s['cik']}", "sec": s}
        for s in spec.get("sec", [])
    ]
    for t in op_targets + sec_targets:
        discover(t)
    ambiguous = {"open_payments": resolve_owners(op_targets), "sec": resolve_owners(sec_targets)}
    results = []
    for t in op_targets + sec_targets:
        r = counts(t)
        if t["kind"] == "sec":
            s = t["sec"]
            r.update({"cik": s["cik"], "secName": s["name"], "sic": s.get("sic"), "sicDescription": s.get("sicDescription")})
        results.append(r)
    json.dump({"generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "ambiguous": ambiguous, "results": results}, open(os.path.join(ACQ, "maude_matches.json"), "w"), indent=1)
    print("searched", len(results), "matched", sum(1 for r in results if r["matchedNames"]), "ambiguous spellings", {k: len(v) for k, v in ambiguous.items()}, "requests", _used[0])
    for kind, spellings in ambiguous.items():
        for spelling, owners in spellings.items():
            print("  ambiguous", kind, spelling, owners)


if __name__ == "__main__":
    main()
