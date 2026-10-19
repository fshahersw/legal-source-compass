"""Independent checks of court_locations: every stored address re-read from the saved source page, coordinates only on Census
matches and inside the address's state's rough bounds, district/bankruptcy addresses inside the court's CourtListener states.

    python3 -I -B scripts/enrichment/court_locations/verify_court_locations.py
"""
from __future__ import annotations

import html
import json
import os
import random
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "court_locations")
OUT = os.path.join(ROOT, "private", "build", "court_locations")
# loose latitude/longitude boxes (south, north, west, east) to catch a coordinate in the wrong state; not a geofence
BOX = {"AK": (51, 72, -180, -129), "HI": (18, 23, -161, -154), "PR": (17.8, 18.6, -67.4, -65.2), "GU": (13.2, 13.7, 144.6, 145),
       "VI": (17.6, 18.5, -65.1, -64.5), "MP": (14, 20.6, 144.8, 146.1)}
CONUS = (24, 50, -125, -66)


def flat(s: str) -> str:
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return " ".join(html.unescape(s).replace("\xa0", " ").split()).lower()


def main():
    data = json.load(open(os.path.join(OUT, "court_locations.json")))
    man = {}
    for line in open(os.path.join(ACQ, "_manifest.jsonl"), encoding="utf-8"):
        e = json.loads(line)
        if e.get("http_status") == 200:
            man.setdefault(e.get("final_url") or e["url"], e)
            man.setdefault(e["url"], e)
    texts = {}
    fails, checked, coords = [], 0, 0
    for r in data["rows"]:
        p = r["item"]["profile"]
        for loc in p["locations"]:
            e = man.get(loc["source_url"])
            if not e:
                fails.append(f"{p['court_id']}: source {loc['source_url']} not in manifest")
                continue
            if e["path"] not in texts:
                texts[e["path"]] = flat(open(os.path.join(ROOT, e["path"]), encoding="utf-8", errors="replace").read())
            t = texts[e["path"]]
            checked += 1
            street = " ".join(loc["address1"].split()).lower()
            if street not in t or loc["zip"] not in t or loc["city"].lower() not in t:
                fails.append(f"{p['court_id']}: {loc['address1']} / {loc['city']} {loc['zip']} not found in {e['path']}")
            if loc["lat"] is not None:
                coords += 1
                if loc["geocode_match"] != "Match":
                    fails.append(f"{p['court_id']}: coordinates without a Census match")
                s, n, w, east = BOX.get(loc["state"], CONUS)
                if not (s <= loc["lat"] <= n and w <= loc["lon"] <= east):
                    fails.append(f"{p['court_id']}: {loc['address1']} {loc['state']} at {loc['lat']},{loc['lon']} outside the state's box")
            if p["level"] in ("district", "bankruptcy") and p["cl_states"] and loc["state"] not in p["cl_states"]:
                fails.append(f"{p['court_id']}: {loc['state']} not in {p['cl_states']}")
    rng = random.Random(1019)
    sample = rng.sample([(r["id"], loc) for r in data["rows"] for loc in r["item"]["profile"]["locations"]], 30)
    result = {"courts": len(data["rows"]), "locations_checked": checked, "with_coordinates": coords, "failures": fails,
              "sample": [f"{cid}: {l['name'] or '-'} | {l['address1']} | {l['address2'] or ''} | {l['city']}, {l['state']} {l['zip']} | {l['geocode_match']}" for cid, l in sample]}
    json.dump(result, open(os.path.join(OUT, "verification.json"), "w"), indent=1)
    print(json.dumps({k: v for k, v in result.items() if k not in ("sample", "failures")}), "failures:", len(fails))
    for f in fails[:25]:
        print("  FAIL", f)
    for s in result["sample"]:
        print("  ", s)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
