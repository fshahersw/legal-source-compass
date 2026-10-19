"""Build court_locations: the courthouse addresses each federal court publishes on its own website, with Census Bureau coordinates.

Inputs: the uscourts.gov "Court Website Links" page (which site belongs to which court), each court's home page and one linked
locations/contact page (fetch_sites.py; raw bytes and manifest in private/acq/court_locations/), CourtListener's federal court ids
and courthouse states (lookups/cl_courts.json), the court_spine ids (lookups/spine_ids.json). Coordinates come from the U.S. Census
Bureau Geocoder batch endpoint (benchmark Public_AR_Current); unmatched addresses keep no coordinates.

A site maps to a court by its host code when that is a CourtListener id; otherwise by the link label and column on the uscourts.gov
page (district or bankruptcy) to a unique CourtListener short name. Hosts ending in "p" that are not court ids are probation offices
and are skipped. A district or bankruptcy address must lie in a state CourtListener records for that court.

    python3 -I -B scripts/enrichment/court_locations/build_court_locations.py [--geocode]
"""
from __future__ import annotations

import csv
import glob
import hashlib
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse
import uuid
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import locations_lib as ll  # noqa: E402

ACQ = os.path.join(ROOT, "private", "acq", "court_locations")
LOOK = os.path.join(ROOT, "private", "build", "court_locations", "lookups")
OUT = os.path.join(ROOT, "private", "build", "court_locations")
GEO_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BENCHMARK = "Public_AR_Current"
LEVEL = {"F": "appeals", "FD": "district", "FB": "bankruptcy", "FS": "special"}
EXTRA_IDS = {"www.cit.uscourts.gov": ["cit"], "www.uscfc.uscourts.gov": ["uscfc"], "www.jpml.uscourts.gov": ["jpml"], "www.supremecourt.gov": ["scotus"]}


def manifest():
    """Latest manifest entry per saved path (url and retrieval time of the bytes on disk)."""
    out = {}
    with open(os.path.join(ACQ, "_manifest.jsonl"), encoding="utf-8") as h:
        for line in h:
            e = json.loads(line)
            if e.get("http_status") == 200:
                out[e["path"]] = e
    return out


def site_courts(courts):
    """host -> [(court_id, how)] from the uscourts.gov link page."""
    page = open(os.path.join(ACQ, "uscourts", "court-website-links.html"), encoding="utf-8").read()
    by_short = defaultdict(list)
    for c in courts.values():
        if c["in_use"] == "t":
            by_short[(c["jurisdiction"], c["short_name"])].append(c["id"])
    out = defaultdict(list)
    unresolved = []
    for m in re.finditer(r'<a[^>]+href="(https?://[^"]*uscourts\.gov[^"]*)"[^>]*>(.*?)</a>', page, re.S):
        host = urllib.parse.urlparse(m.group(1)).netloc.lower()
        if not re.match(r"^(www\.)?[a-z0-9]+\.uscourts\.gov$", host) or host in ("www.uscourts.gov", "pacer.uscourts.gov"):
            continue
        label = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", m.group(2))).split())
        if re.search(r"prob(ation)?\s*/\s*pretrial|pretrial services|probation office", label, re.I):
            continue
        code = host.split(".")[-3]
        row = page[: m.start()]
        row = row[row.rfind("<tr>"):] if row.rfind("<tr>") > row.rfind("</table>") else ""
        column = row.count("<td>")
        jur = {1: "FD", 2: "FB"}.get(column)
        if code in courts and (jur is None or courts[code]["jurisdiction"] == jur):
            hit = (code, "host code is the court id")
        elif code.endswith("p") and code not in courts:
            continue
        elif jur:
            ids = sorted({i for s in ll.label_short_names(label) for i in by_short.get((jur, s), [])})
            if not ids:
                unresolved.append({"host": host, "label": label, "column": column})
                continue
            for i in ids:
                if (i, "link label and column on uscourts.gov") not in out[host]:
                    out[host].append((i, "link label and column on uscourts.gov"))
            continue
        else:
            unresolved.append({"host": host, "label": label, "column": column})
            continue
        if hit not in out[host]:
            out[host].append(hit)
    for host, ids in EXTRA_IDS.items():
        out[host] = [(i, "national court's own site") for i in ids]
    return out, unresolved


def geocode(addresses, refresh):
    """Census batch geocode; the raw response is kept under private/acq/court_locations/geocode/ and reused unless --geocode."""
    import fetchlib

    rows = io.StringIO()
    w = csv.writer(rows)
    for k, a in sorted(addresses.items()):
        w.writerow([k, a["street"], a["city"], a["state"], a["zip"]])
    body = rows.getvalue().encode()
    digest = hashlib.sha256(body).hexdigest()[:16]
    path = os.path.join(ACQ, "geocode", f"batch_{digest}.csv")
    if refresh or not os.path.exists(path):
        boundary = uuid.uuid4().hex
        parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"benchmark\"\r\n\r\n{BENCHMARK}\r\n".encode(),
                 f"--{boundary}\r\nContent-Disposition: form-data; name=\"addressFile\"; filename=\"addresses.csv\"\r\nContent-Type: text/csv\r\n\r\n".encode(),
                 body, f"\r\n--{boundary}--\r\n".encode()]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path.replace(".csv", ".request.csv"), "wb") as h:
            h.write(body)
        fetchlib.fetch(GEO_URL, os.path.relpath(path, ACQ), data=b"".join(parts), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
                       timeout=600, retries=2)
    out = {}
    with open(path, encoding="utf-8", errors="replace") as h:
        for r in csv.reader(h):
            if len(r) < 3:
                continue
            k, status = r[0], r[2]
            if status == "Match" and len(r) >= 6 and "," in r[5]:
                lon, lat = (float(x) for x in r[5].split(","))
                out[k] = {"match": status, "match_type": r[3], "matched_address": r[4], "lat": round(lat, 6), "lon": round(lon, 6)}
            else:
                out[k] = {"match": status}
    return out, os.path.relpath(path, ROOT)


def main(argv):
    t0 = time.time()
    courts = {r["id"]: r for r in json.load(open(os.path.join(LOOK, "cl_courts.json")))["rows"]}
    spine = set(json.load(open(os.path.join(LOOK, "spine_ids.json")))["ids"].split(","))
    man = manifest()
    sites, unresolved = site_courts(courts)
    per_court = defaultdict(dict)
    sources = defaultdict(set)
    shared = defaultdict(set)
    drops = Counter()
    pages = 0
    for host, hits in sorted(sites.items()):
        files = sorted(glob.glob(os.path.join(ACQ, "sites", host, "*.html")))
        for cid, how in hits:
            shared[cid] |= {c for c, _ in hits if c != cid}
            allowed = set(courts[cid]["states"] or []) if courts[cid]["jurisdiction"] in ("FD", "FB", "F") else None
            for f in files:
                rel = os.path.relpath(f, ROOT)
                entry = man.get(rel)
                if not entry:
                    continue
                pages += 1
                for a in ll.find_addresses(ll.page_lines(open(f, encoding="utf-8", errors="replace").read())):
                    why = ll.keep(a, allowed)
                    if why:
                        drops[why] += 1
                        continue
                    number = re.match(r"^(\S+)", ll.norm_street(a["street"])).group(1)
                    key = (number, a["zip"])
                    loc = per_court[cid].get(key)
                    src = {"url": entry["final_url"] or entry["url"], "retrieved_at": entry["retrieved_at"], "sha256": entry["sha256"]}
                    if loc is None:
                        per_court[cid][key] = {**{k: a[k] for k in ("name", "street", "street2", "city", "state", "zip")}, "variants": [], "sources": [src], "how": how}
                    else:
                        variant = f"{a['street']}, {a['city']}, {a['state']} {a['zip']}"
                        if not loc["name"] and a["name"]:
                            loc["name"] = a["name"]
                        if ll.norm_street(a["street"]) != ll.norm_street(loc["street"]) and variant not in loc["variants"]:
                            loc["variants"].append(variant)
                        if src["url"] not in [s["url"] for s in loc["sources"]]:
                            loc["sources"].append(src)
                    sources[cid].add(src["url"])
    # geocode every distinct address once
    addr_key = {}
    for cid, locs in per_court.items():
        for key, loc in locs.items():
            k = hashlib.sha1(f"{loc['street']}|{loc['city']}|{loc['state']}|{loc['zip']}".encode()).hexdigest()[:12]
            loc["geo_key"] = k
            addr_key[k] = loc
    geo, geo_path = geocode(addr_key, "--geocode" in argv)
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    level_counts = Counter()
    match_counts = Counter()
    for cid in sorted(per_court):
        c = courts[cid]
        locs = []
        for loc in per_court[cid].values():
            g = geo.get(loc["geo_key"], {"match": "Not geocoded"})
            match_counts[g["match"]] += 1
            locs.append({"name": loc["name"], "kind": "mailing (P.O. box)" if re.match(r"^P\.?\s?O\.?\s+Box", loc["street"], re.I) else "street",
                         "address1": loc["street"], "address2": loc["street2"], "city": loc["city"], "state": loc["state"], "zip": loc["zip"],
                         "other_spellings": loc["variants"], "lat": g.get("lat"), "lon": g.get("lon"), "geocode_match": g["match"],
                         "geocode_match_type": g.get("match_type"), "geocoder_address": g.get("matched_address"),
                         "source_url": loc["sources"][0]["url"], "sources": loc["sources"], "retrieved_at": loc["sources"][0]["retrieved_at"]})
        locs.sort(key=lambda x: (x["state"], x["city"], x["address1"]))
        level = LEVEL.get(c["jurisdiction"], "other")
        level_counts[level] += 1
        cities = sorted({f"{x['city']}, {x['state']}" for x in locs})
        mismatch = sorted({x["state"] for x in locs} - set(c["states"] or [])) if c["states"] else []
        rows.append(writer.record(
            "court_locations", cid, f"{c['full_name']}: courthouse addresses", source_url=locs[0]["source_url"],
            subtitle=f"{len(locs)} location{'s' if len(locs) != 1 else ''} · {', '.join(cities[:4])}{' …' if len(cities) > 4 else ''}",
            cells={"court": c["full_name"], "court_id": cid, "level": level, "states": ", ".join(sorted({x['state'] for x in locs})), "locations": len(locs),
                   "cities": len(cities), "geocoded": sum(1 for x in locs if x["lat"] is not None)},
            badges=["Court's own website", "Census geocoder"],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("Court", c["full_name"]), ("Locations listed", len(locs)), ("Cities", "; ".join(cities)),
                ("Read from", "; ".join(sorted(sources[cid]))),
                ("Shares a website with", ", ".join(sorted(shared[cid])) or None),
                ("States in CourtListener's courthouse records", ", ".join(c["states"] or []) or None),
                ("Address states not in CourtListener's records", ", ".join(mismatch) or None),
                ("Coordinates", "U.S. Census Bureau Geocoder, benchmark Public_AR_Current; addresses it could not match have none."),
                ("Reading", "Addresses as the court prints them on its website (home page and one locations/contact page); a court may have offices not listed there.")]],
            text=f"court address {c['full_name']} " + " ".join(f"{x['address1']} {x['city']} {x['state']} {x['zip']}" for x in locs),
            filters={"level": [level], "state": sorted({x["state"] for x in locs})},
            links=[{"label": "Court page", "url": f"/courts/{cid}"}] if cid in spine else [],
            extra={"profile": {"court_id": cid, "court": c["full_name"], "level": level, "locations": locs, "shared_site_with": sorted(shared[cid]),
                               "cl_states": c["states"], "state_mismatch": mismatch}}))
    fed = {i for i, c in courts.items() if c["in_use"] == "t" and c["jurisdiction"] in ("F", "FD", "FB", "FS")}
    missing = sorted(fed - set(per_court))
    summary = {"source": "Each federal court's own website (home page and one linked locations/contact page), mapped through uscourts.gov's Court Website Links page",
               "coordinates": f"U.S. Census Bureau Geocoder batch, benchmark {BENCHMARK} ({geo_path})",
               "coverage": {"courts_with_addresses": len(per_court), "by_level": dict(level_counts), "locations": sum(match_counts.values()),
                            "geocode": dict(match_counts), "pages_read": pages, "in_use_federal_courts_without_addresses": missing,
                            "unresolved_site_labels": unresolved, "dropped_addresses": dict(drops)},
               "notes": ["The uscourts.gov Federal Court Finder is disallowed for crawlers in robots.txt and was not used.",
                         "The District of Nevada site disallows crawlers in robots.txt and was not read.",
                         "CourtListener's courthouse table records the Court of International Trade in DC; its own site gives New York."]}
    spec = {"dataset": "court_locations", "label": "Federal courthouse addresses as published by each court, with Census Bureau coordinates", "rows": rows,
            "listing_block": writer.listing([("court", "Court"), ("level", "Level"), ("states", "States"), ("locations", "Locations"), ("cities", "Cities"), ("geocoded", "Geocoded")],
                                            [("level", "Level", {"appeals": "Courts of appeals", "district": "District courts", "bankruptcy": "Bankruptcy courts", "special": "National courts"})]),
            "summary": {**summary, "totals": {"records": len(rows)}}, "built_at": built_at,
            "inputs": [{"url": "https://www.uscourts.gov/about-federal-courts/federal-courts-public/court-website-links", "path": "private/acq/court_locations/uscourts/court-website-links.html",
                        "sha256": hashlib.sha256(open(os.path.join(ACQ, "uscourts", "court-website-links.html"), "rb").read()).hexdigest()},
                       {"url": GEO_URL, "path": geo_path, "sha256": hashlib.sha256(open(os.path.join(ROOT, geo_path), "rb").read()).hexdigest()},
                       {"url": "courtlistener:courts,courthouses", "path": "private/build/court_locations/lookups/cl_courts.json",
                        "sha256": hashlib.sha256(open(os.path.join(LOOK, "cl_courts.json"), "rb").read()).hexdigest()}]}
    path = os.path.join(OUT, "court_locations.json")
    with open(path + ".tmp", "w") as h:
        json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
    os.replace(path + ".tmp", path)
    print("court_locations", len(rows), "rows", os.path.getsize(path) // 1024, "KB")
    print(json.dumps({k: v for k, v in summary["coverage"].items() if k not in ("in_use_federal_courts_without_addresses",)}, default=str))
    print("in-use federal courts without addresses:", len(missing), missing[:60])
    print(f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main(sys.argv[1:])
