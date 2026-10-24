"""Select leads from the registry and workbook; write leads.json and the fetch lists for each origin.

  python3 -I -B select_leads.py

Writes private/build/visual_registry/leads.json: {dataset: {"leads": [...], "held": [...]}} plus fetch lists
(commons_titles, loc_items, wikidata_ids). Deterministic; reads only local files.
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import registry as rg  # noqa: E402
from vr_common import BUILD, COURT_SPINE, REGISTRY, WORKBOOK, load_json, load_registry, write_json  # noqa: E402


def sheet_rows(path, sheet, first):
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        header, out = None, []
        for r in wb[sheet].iter_rows(values_only=True):
            if header is None:
                if r and r[0] == first:
                    header = [str(c) if c is not None else "" for c in r]
                continue
            if any(c is not None for c in r):
                out.append({k: (str(v).strip() if v is not None else "") for k, v in zip(header, r) if k})
        return out
    finally:
        wb.close()


def select(registry_path=REGISTRY, workbook_path=WORKBOOK, spine_path=COURT_SPINE, lookups=BUILD / "lookups"):
    assets = load_registry(registry_path)["assets"]
    spine = {r["id"]: r for r in json.load(open(spine_path))}
    committees = load_json(lookups / "committees.json")["data"]
    page_ciks = set(load_json(lookups / "company_profiles.json")["data"])
    agency_ids = set(load_json(lookups / "fr_agencies.json")["data"])
    pages = sheet_rows(workbook_path, "Page Visuals", "Page ID")
    design = {r["Asset ID"]: r for r in sheet_rows(workbook_path, "Design Assets", "Asset ID")}
    out = {}
    for name, (leads, held) in {
        "court": rg.court_leads(assets, spine),
        "judge": rg.judge_leads(assets),
        "agency": rg.agency_leads(assets, agency_ids),
        "committee": rg.committee_leads(assets, committees),
        "company": rg.company_leads(assets, page_ciks),
        "state": rg.state_leads(pages, design),
    }.items():
        out[name] = {"leads": leads, "held": held}
    titles = set()
    loc = set()
    for name in ("court", "judge", "agency", "state"):
        for lead in out[name]["leads"]:
            if lead["origin"] == "commons":
                titles.add(lead["ref"])
            elif lead["origin"] == "loc":
                loc.add(lead["ref"])
    for lead in out["company"]["leads"]:
        for s in lead["statements"]:
            if s["file"]:
                titles.add(s["file"])
    wikidata = sorted({lead["wikidata"] for lead in out["judge"]["leads"] if lead["wikidata"]}
                      | {lead["wikidata"] for lead in out["company"]["leads"] if lead["wikidata"]})
    out["fetch"] = {"commons_titles": sorted(titles), "loc_items": sorted(loc), "wikidata_ids": wikidata}
    return out


def main():
    out = select()
    write_json(BUILD / "leads.json", out)
    for name in ("court", "judge", "agency", "committee", "company", "state"):
        held = Counter(h["reason"] for h in out[name]["held"])
        print(name, "leads", len(out[name]["leads"]), "held", sum(held.values()))
        for reason, n in held.most_common(12):
            print("    ", n, reason[:140])
    print("commons titles", len(out["fetch"]["commons_titles"]), "loc items", len(out["fetch"]["loc_items"]),
          "wikidata", len(out["fetch"]["wikidata_ids"]))
    courts = {lead["court_id"] for lead in out["court"]["leads"]}
    print("courts with at least one lead", len(courts))


if __name__ == "__main__":
    main()
