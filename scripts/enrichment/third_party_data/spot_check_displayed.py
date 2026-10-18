"""Spot-check displayed figures in the rebuilt publishable datasets against the raw source files (value, where in the source, match yes/no).

Settlement notices: 20 random built rows (seed 20261018). Each row's displayed claim deadline, payout text, state list, cited official URL
and status are compared with the same record in the unchanged raw compilation file (private/acq/.../settlesignal/settlements.json,
settlements[<index>].<field>); the private provenance map (notice_provenance_private.json) says which raw record a notice id came from.
Catalog: 12 random built rows (seed 20261019). Each row's displayed coverage phrase and first official URL are compared with the saved
compiled list page (the paragraph that lists the agency and the href of its link); catalog_provenance_private.json gives the listed line.
Source URLs: for the same rows, the row's source_url is compared with the cited official page in the raw record (settlements) or the first
agency href on the listing (catalog); these are reported as a separate group so the 124 displayed-value checks stay comparable with the
first pass (same 20 settlement rows; the catalog sample is re-drawn because the catalog now has 463 rows).
Writes private/build/third_party_data/spot_checks_displayed.json (private: it names the raw files).

Usage: python3 -I -B spot_check_displayed.py
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tp_common as tp  # noqa: E402
import vt_parse as vp  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")
NOTICES = "settlement_notices"
CATALOG = "enforcement_data_sources_catalog"


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def settlement_checks():
    raw = load(os.path.join(ACQ, "settlesignal", "settlements.json"))["settlements"]
    prov = load(os.path.join(BUILD, "notice_provenance_private.json"))["rows"]
    verdict_source = {v["settlesignal_url"]: v["source_url"] for v in load(os.path.join(ACQ, "verification", "verdicts.json"))["rows"]}
    built = sorted(load(os.path.join(BUILD, NOTICES + ".json"))["rows"], key=lambda r: r["id"])
    rng = random.Random(20261018)
    out = []
    for row in rng.sample(built, 20):
        p = prov[row["id"]]
        i = p["raw_index"]
        rec = raw[i]
        assert rec["url"] == p["publisher_url"] and row["id"] == "notice:" + p["publisher_slug"]
        cells = row["item"]["cells"]
        payout_section = next((s["text"] for s in row["detail"]["sections"] if s["heading"].startswith("Payout text")), None)
        cited = rec["official_settlement_url"] or rec["official_claim_url"]
        pairs = [
            ("displayed", "claim deadline", cells["deadline"], rec["claim_deadline"], f"settlements[{i}].claim_deadline"),
            ("displayed", "payout text", payout_section, (rec["estimated_payout"] or "").strip() or "Not recorded", f"settlements[{i}].estimated_payout"),
            ("displayed", "states", cells["states"], ", ".join(rec["applicable_states"]) if rec["applicable_states"] else "Nationwide (as published)", f"settlements[{i}].applicable_states"),
            ("displayed", "official URL", row["item"]["primary_source"]["url"], cited, f"settlements[{i}].official_settlement_url / official_claim_url"),
            ("displayed", "status", cells["status"], rec["status"] or None, f"settlements[{i}].status"),
            ("source_url", "row source_url", row["source_url"], verdict_source.get(rec["url"], cited),
             f"settlements[{i}].official_settlement_url / official_claim_url" + (" (verification read page)" if rec["url"] in verdict_source else "")),
        ]
        for group, field, shown, source, where in pairs:
            out.append({"group": group, "dataset": NOTICES, "row": row["id"], "field": field, "displayed": shown, "source_value": source,
                        "where": "settlesignal/settlements.json " + where, "match": shown == source})
    return out


def catalog_checks():
    prov = load(os.path.join(BUILD, "catalog_provenance_private.json"))["rows"]
    pages = {
        "Federal": ("violation-tracker-data-sources.html", "https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources"),
        "State": ("local-state-data-sources.html", "https://violationtracker.goodjobsfirst.org/pages/local-state-data-sources"),
    }
    blocks = {k: list(vp.blocks(open(os.path.join(ACQ, "violationtracker", f), encoding="utf-8").read())) for k, (f, _) in pages.items()}
    built = sorted(load(os.path.join(BUILD, CATALOG + ".json"))["rows"], key=lambda r: r["id"])
    rng = random.Random(20261019)
    out = []
    for row in rng.sample(built, 12):
        entry = row["item"]["entry"]
        kind = "Federal" if entry["jurisdiction"] == "Federal" else "State"
        page, base = pages[kind]
        listed_line = prov[row["id"]]["listed_line"]
        hits = [(n, b) for n, b in enumerate(blocks[kind]) if b["text"] == listed_line]
        n, block = hits[0] if hits else (None, None)
        coverage_shown = row["item"]["cells"]["covers"]
        listed_cov = vp.split_entry(block["text"])[1] if block else None
        out.append({"group": "displayed", "dataset": CATALOG, "row": row["id"], "field": "what it covers", "displayed": coverage_shown,
                    "source_value": listed_cov or None, "where": f"{page}, block #{n}", "match": (coverage_shown or None) == (listed_cov or None)})
        first = entry["urls"][0]["url"] if entry["urls"] else None
        hrefs = [h for _, h in block["links"]] if block else []
        # the page may hold a relative href; compare after the same absolute-URL join the parser applies
        joined = [vp.norm_url(h, base) for h in hrefs if h and not h.startswith("#")]
        expected = next((u for u in joined if not vp.is_forbidden_link(u)), None)
        out.append({"group": "displayed", "dataset": CATALOG, "row": row["id"], "field": "first official URL", "displayed": first,
                    "source_value": expected, "where": f"{page}, block #{n}, first agency href", "match": first == expected})
        out.append({"group": "source_url", "dataset": CATALOG, "row": row["id"], "field": "row source_url", "displayed": row["source_url"],
                    "source_value": expected, "where": f"{page}, block #{n}, first agency href", "match": row["source_url"] == expected})
    return out


def main():
    checks = settlement_checks() + catalog_checks()
    displayed = [c for c in checks if c["group"] == "displayed"]
    source_url = [c for c in checks if c["group"] == "source_url"]
    report = {"seed": {"settlements": 20261018, "catalog": 20261019}, "checks": len(checks), "mismatches": sum(1 for c in checks if not c["match"]),
              "displayed_checks": len(displayed), "displayed_mismatches": sum(1 for c in displayed if not c["match"]),
              "source_url_checks": len(source_url), "source_url_mismatches": sum(1 for c in source_url if not c["match"]),
              "rows_checked": len({c["row"] for c in checks}), "rows": checks}
    tp.atomic_write(os.path.join(BUILD, "spot_checks_displayed.json"), json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps({k: report[k] for k in ("checks", "mismatches", "displayed_checks", "displayed_mismatches", "source_url_checks", "source_url_mismatches", "rows_checked")}))
    for c in checks:
        if not c["match"]:
            print("MISMATCH", c)


if __name__ == "__main__":
    main()
