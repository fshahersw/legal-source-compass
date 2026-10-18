"""Cross-check epa_echo build files against the existing regulatory_epa_state_profiles totals and measure cross-reference rates.

Reads private/build/epa_echo/*.json and private/build/epa_echo/lookups/*.json (read-only corpus lookups). No network.
Writes private/build/epa_echo/crosscheck.json and prints a summary.

Usage: python3 -I -B scripts/enrichment/epa_echo/crosscheck.py
"""
import collections
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "epa_echo")


def load(name):
    return json.load(open(os.path.join(BUILD, name)))


def main():
    series = load("epa_echo_case_series.json")
    defendants = load("epa_echo_defendants.json")
    programs = load("epa_echo_state_programs.json")
    profiles = {r["id"]: r for r in load("lookups/regulatory_epa_state_profiles_cells.json")["rows"]}
    sec = load("lookups/company_sec_profiles_titles.json")["rows"]
    out = {}

    # ---- series vs existing state profiles (all-years rows)
    by_id = {r["id"]: r["item"]["series"] for r in series["rows"]}
    compare = []
    for pid, prof in sorted(profiles.items()):
        code = pid.split(":", 1)[1]
        rid = "epa-echo-series:US:all" if code == "US" else f"epa-echo-series:state:{code}:all"
        mine = by_id.get(rid)
        if mine is None:
            compare.append({"profile": pid, "echo_row": None})
            continue
        entry = {"profile": pid, "echo_row": rid,
                 "cases_profile": int(prof["cases"]), "cases_echo": mine["opened"],
                 "fed_profile": float(prof["fed_penalty"]), "fed_echo": mine["fed_penalty"],
                 "sep_profile": float(prof["sep"]), "sep_echo": mine["sep"],
                 "judicial_profile": int(prof["judicial"]), "judicial_echo": mine["opened_judicial"]}
        entry["cases_diff"] = entry["cases_echo"] - entry["cases_profile"]
        entry["fed_diff"] = round(entry["fed_echo"] - entry["fed_profile"], 2)
        entry["sep_diff"] = round(entry["sep_echo"] - entry["sep_profile"], 2)
        entry["judicial_diff"] = entry["judicial_echo"] - entry["judicial_profile"]
        compare.append(entry)
    found = [c for c in compare if c.get("echo_row")]
    out["profiles_in_corpus"] = len(profiles)
    out["profiles_with_echo_row"] = len(found)
    out["profiles_without_echo_row"] = [c["profile"] for c in compare if not c.get("echo_row")]
    out["cases_exact"] = sum(1 for c in found if c["cases_diff"] == 0)
    out["fed_exact"] = sum(1 for c in found if abs(c["fed_diff"]) < 0.005)
    out["sep_exact"] = sum(1 for c in found if abs(c["sep_diff"]) < 0.005)
    out["judicial_exact"] = sum(1 for c in found if c["judicial_diff"] == 0)
    out["largest_case_diffs"] = sorted(((c["profile"], c["cases_diff"]) for c in found), key=lambda t: -abs(t[1]))[:6]
    out["largest_fed_diffs"] = sorted(((c["profile"], c["fed_diff"]) for c in found), key=lambda t: -abs(t[1]))[:6]
    out["echo_rows_vs_profiles"] = compare

    # ---- scopes in the series
    scopes = collections.defaultdict(lambda: {"rows": 0, "kind": None})
    for r in series["rows"]:
        s = r["item"]["series"]["scope"]
        key = f"{s['kind']}:{s['code']}"
        scopes[key]["rows"] += 1
        scopes[key]["kind"] = s["kind"]
    out["series_scopes_by_kind"] = dict(collections.Counter(v["kind"] for v in scopes.values()))
    state_scopes = sorted(k.split(":", 1)[1] for k, v in scopes.items() if v["kind"] == "state")
    out["state_scopes"] = {"count": len(state_scopes), "codes": state_scopes}
    rows_state = [r for r in series["rows"] if r["item"]["series"]["scope"]["kind"] == "state"]
    linked = [r for r in rows_state if any(l["url"].startswith("/places/") for l in r["item"]["links"])]
    out["series_state_rows"] = len(rows_state)
    out["series_state_rows_with_places_link"] = len(linked)
    bad = [r["id"] for r in series["rows"] if any(l["url"].startswith("/places/") for l in r["item"]["links"]) and r["item"]["series"]["scope"]["kind"] != "state"]
    out["places_links_on_non_state_rows"] = bad[:5]
    out["place_link_targets"] = sorted({l["url"] for r in series["rows"] for l in r["item"]["links"] if l["url"].startswith("/places/")})[:60]
    rec_links = [r for r in series["rows"] if any(l["url"].startswith("/records/regulatory_epa_state_profiles/") for l in r["item"]["links"])]
    out["series_rows_with_state_profile_record_link"] = len(rec_links)
    missing_targets = sorted({l["url"].rsplit("/", 1)[1] for r in rec_links for l in r["item"]["links"] if l["url"].startswith("/records/regulatory_epa_state_profiles/")} - set(profiles))
    out["profile_record_links_to_missing_ids"] = missing_targets
    scope_no_profile = sorted(k.split(":", 1)[1] for k, v in scopes.items() if v["kind"] in ("state", "territory", "other", "unrecorded") and f"epa-profile:{k.split(':', 1)[1]}" not in profiles)
    out["facility_state_scopes_without_existing_profile"] = scope_no_profile

    # ---- defendants -> companies
    sec_ciks = {c for c, _ in sec}
    drows = defendants["rows"]
    matched = [r for r in drows if r["item"]["defendant"]["company"]["status"] == "matched"]
    ambiguous = [r for r in drows if r["item"]["defendant"]["company"]["status"] == "ambiguous"]
    out["defendant_rows"] = len(drows)
    out["defendant_rows_company_matched"] = len(matched)
    out["defendant_rows_company_ambiguous"] = len(ambiguous)
    out["distinct_company_ciks_linked"] = len({r["item"]["defendant"]["company"]["cik"] for r in matched})
    out["company_ciks_in_sec_lookup"] = all(r["item"]["defendant"]["company"]["cik"] in sec_ciks for r in matched)
    out["sec_profiles_in_lookup"] = len(sec_ciks)
    out["sec_profiles_linked_by_any_defendant"] = len({r["item"]["defendant"]["company"]["cik"] for r in matched})
    out["defendant_rows_with_companies_link"] = sum(1 for r in drows if any(l["url"].startswith("/companies/") for l in r["item"]["links"]))
    top1000 = [r for r in drows if r["item"]["defendant"]["rank"] and r["item"]["defendant"]["rank"] <= 1000]
    out["top1000_joint_rows"] = len(top1000)
    out["top1000_joint_company_matched"] = sum(1 for r in top1000 if r["item"]["defendant"]["company"]["status"] == "matched")

    # ---- state programs
    prow = programs["rows"]
    out["program_rows_by_kind"] = dict(collections.Counter(r["item"]["programs"]["scope"]["kind"] for r in prow))
    out["program_state_rows_with_places_link"] = sum(1 for r in prow if r["item"]["programs"]["scope"]["kind"] == "state" and any(l["url"].startswith("/places/") for l in r["item"]["links"]))
    state_codes = {r["item"]["programs"]["scope"]["code"] for r in prow if r["item"]["programs"]["scope"]["kind"] == "state"}
    out["program_state_codes"] = len(state_codes)
    out["program_state_codes_not_in_series"] = sorted(state_codes - set(state_scopes))
    out["series_state_codes_not_in_programs"] = sorted(set(state_scopes) - state_codes)

    # ---- listing shape: every listing column is a cell key, every listing filter value is declared
    shape = {}
    for name, data in (("epa_echo_case_series", series), ("epa_echo_defendants", defendants), ("epa_echo_state_programs", programs)):
        block = data["listing_block"]
        column_keys = [c["key"] for c in block["columns"]]
        missing_cells = sum(1 for r in data["rows"] if any(k not in r["item"]["cells"] for k in column_keys))
        undeclared = collections.Counter()
        for f in block["filters"]:
            if f.get("type") == "search":
                continue
            options = {o["value"] for o in f.get("options", [])}
            for r in data["rows"]:
                for v in r["filters"].get(f["name"], []):
                    if v not in options:
                        undeclared[f"{f['name']}={v}"] += 1
        shape[name] = {"rows": len(data["rows"]), "rows_missing_a_listing_cell": missing_cells, "undeclared_filter_values": dict(undeclared),
                       "rows_without_facts": sum(1 for r in data["rows"] if not r["detail"].get("facts")),
                       "rows_without_source_url": sum(1 for r in data["rows"] if not str(r.get("source_url", "")).startswith("https://")),
                       "dataset_ids": sorted({r["dataset"] for r in data["rows"]})}
    out["listing_shape"] = shape

    with open(os.path.join(BUILD, "crosscheck.json"), "w") as handle:
        json.dump(out, handle, indent=1)
    printable = {k: v for k, v in out.items() if k not in ("echo_rows_vs_profiles", "place_link_targets")}
    print(json.dumps(printable, indent=1))


if __name__ == "__main__":
    main()
