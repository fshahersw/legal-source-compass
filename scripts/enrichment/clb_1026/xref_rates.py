"""Cross-reference rates of the wave-1026 build files (exact keys only); writes private/build/clb_1026/xref_rates.json."""
import hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clb1026_common as cm

# live digests read with a read-only query on 2026-10-24 (count, md5 of ids joined by ',' in byte order)
LIVE = {"clb_judge_disclosures": (3392, "ad64cb2991603d85c74e88564218bbdd")}
out = {}
b = json.load(open(os.path.join(cm.OUT, "clb_judge_people.json")))
pos = [p for r in b["rows"] for p in r["item"]["profile"].get("positions", []) if p.get("court_id")]
out["clb_judge_people"] = {"court_positions": len(pos), "with_court_link": sum(1 for p in pos if p.get("court_link")),
                           "courts_without_directory_entry": sorted({p["court_id"] for p in pos if not p.get("court_link")})[:20]}
d = json.load(open(os.path.join(cm.OUT, "clb_judge_disclosure_items.json")))
ids = sorted(r["id"] for r in d["rows"] if not r["id"].startswith("year:"))
n, dig = LIVE["clb_judge_disclosures"]
out["clb_judge_disclosure_items"] = {"people": len(ids), "links_to_clb_judge_disclosures_valid": len(ids) == n and hashlib.md5(",".join(ids).encode()).hexdigest() == dig}
s = os.path.join(cm.OUT, "clb_search_counts.json")
if os.path.exists(s):
    sc = json.load(open(s))
    courts = [r for r in sc["rows"] if r["id"].startswith("court:")]
    out["clb_search_counts"] = {"courts": len(courts), "with_court_link": sum(1 for r in courts if r["item"]["profile"].get("court_link"))}
a = json.load(open(os.path.join(cm.OUT, "clb_court_appeals_to.json")))
cs = [r for r in a["rows"] if r["id"].startswith("court:")]
out["clb_court_appeals_to"] = {"courts": len(cs), "with_court_link": sum(1 for r in cs if r["item"]["profile"]["court"]["link"])}
json.dump(out, open(os.path.join(cm.OUT, "xref_rates.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
