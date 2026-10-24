"""Write private/build/visual_registry/REPORT.md from the build files and the check outputs.

  python3 -I -B make_report.py
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vr_common import BUILD, CACHE, REGISTRY, WORKBOOK, load_registry, sha256_file  # noqa: E402

DATASETS = ["court_images", "court_buildings", "judge_portraits_open", "agency_images", "committee_marks",
            "company_logos_open", "state_capitol_images"]


def objects(ds, row):
    item = row["item"]
    if ds == "court_images":
        yield item["photo"]
    for b in item.get("buildings") or []:
        yield b["photo"]
    for key in ("photos", "marks"):
        for x in item.get(key) or []:
            yield x
    for key in ("portrait", "logo", "mark"):
        if isinstance(item.get(key), dict):
            yield item[key]
    if ds == "state_capitol_images":
        yield item["photo"]


def md_table(headers, rows):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    for r in rows:
        out.append("| " + " | ".join(str(c).replace("|", "/").replace("\n", " ") for c in r) + " |")
    return "\n".join(out)


def main():
    builds = {ds: json.load(open(BUILD / f"{ds}.json")) for ds in DATASETS}
    report = json.load(open(BUILD / "build_report.json"))
    leads = json.load(open(BUILD / "leads.json"))
    comparison = json.load(open(BUILD / "origin_comparison.json")) if (BUILD / "origin_comparison.json").exists() else None
    spot = json.load(open(BUILD / "spot_check_urls.json")) if (BUILD / "spot_check_urls.json").exists() else []
    assets = {a["asset_id"]: a for a in load_registry()["assets"]}
    fjc_manifest = CACHE / "fjc" / "_manifest.jsonl"
    fjc = [json.loads(line) for line in open(fjc_manifest)] if fjc_manifest.exists() else []
    fjc_pages = {e["key"]: e for e in fjc if e["key"] != "robots"}
    lines = ["# Visual registry builds (VIS-D) — report", ""]
    lines += ["Built " + report["built_at"] + ". Lead list: the owner's visual registry (October 2026).", "",
              "## Owner decision applied", "",
              "Lead relay, 2026-10-24: \"FORGET THE LICENSE CHECK JUST DO IT.\" This replaced the Rights rules and "
              "Visual review sections of WORKER_RULES_VIS.md. Licences were not re-verified at origin and no contact-"
              "sheet review was done. Every registry image that passes the identity checks is included whatever its "
              "rights status, licence text or host, carrying the registry's recorded licence, licence URL, author, "
              "credit, source page, image URL and size, plus `rights_status` as recorded and `license_family` mapped "
              "from the recorded licence text (public domain, cc0, cc by, cc by-sa, else other). Checks kept: exact "
              "identity, the ARTWORK title rule (title or file name), buildings recorded as demolished or in former "
              "use, https URLs. Origin fetches already made before the decision (Commons metadata for most lead "
              "titles, 68 LOC item records, 14 committee files) were kept and used only for the informational "
              "comparison below.", ""]
    lines += ["## Inputs", ""]
    lines.append(md_table(["File", "sha256"], [(str(p), sha256_file(p)) for p in (REGISTRY, WORKBOOK)]))
    lines += ["", "Read-only corpus lookups (each saved text checked against the live query's md5): "
              + ", ".join(sorted(p.stem for p in (BUILD / "lookups").glob("*.json"))) + ".", ""]
    rows = []
    for ds in DATASETS:
        p = BUILD / f"{ds}.json"
        rows.append((ds, len(builds[ds]["rows"]), str(p), f"{p.stat().st_size:,} bytes"))
    lines += ["## Build files", "", md_table(["Dataset", "Rows", "File", "Size"], rows), ""]
    lines += ["`court_images`: the existing 189 rows are byte-identical and first (verified); "
              f"{len(builds['court_images']['rows']) - 189} rows were appended for courts the workbook leads did not "
              "cover.", ""]
    lines += ["## Licence and rights mix (as recorded)", ""]
    mix = []
    for ds in DATASETS:
        objs = list(o for r in (builds[ds]["rows"][189:] if ds == "court_images" else builds[ds]["rows"])
                    for o in objects(ds, r))
        fam = Counter(o.get("license_family") for o in objs)
        rights = Counter(o.get("rights_status") for o in objs)
        nc = sum(1 for o in objs if re.search(r"(?i)\bnc\b|-nc|noncommercial|\bnd\b|-nd", o.get("license") or ""))
        gfdl = sum(1 for o in objs if "gfdl" in (o.get("license") or "").lower())
        mix.append((ds, len(objs), dict(fam), dict(rights), nc, gfdl))
    lines += [md_table(["Dataset", "Images", "licence_family", "rights_status", "NC/ND licences", "GFDL"], mix), ""]
    lines += ["## Holds by dataset (identity and automatic checks)", ""]
    for ds, holds in report["holds"].items():
        lines.append(f"- **{ds}**: " + "; ".join(f"{n} {r}" for r, n in holds.items()))
    lines.append("")
    lines += ["## Identity match rates", ""]
    court_links = sum(len(a.get("court_links") or []) for a in assets.values() if a["entity_type"] == "courthouse")
    lines += [f"- Courts: {court_links} registry court links on courthouse records; "
              f"{len(leads['court']['leads'])} (asset, court) leads passed the identity rules; "
              f"{len(builds['court_buildings']['rows'])} courts have at least one shown building. uscourts.gov "
              "robots.txt disallows /federal-court-finder/, so the evidence pages were not fetched; the evidence URL "
              "is carried as recorded.",
              f"- Federal judges: {len(leads['judge']['leads'])} registry portraits with exactly one FJC id; FJC pages "
              f"fetched {sum(1 for e in fjc_pages.values() if e['status'] == 200)} (robots.txt Crawl-delay 30 obeyed); "
              f"rows built {report['rows']['judge_portraits_open']} (by basis: "
              f"{builds['judge_portraits_open']['summary']['counts']['by_basis']}).",
              "- State and special-court judges: 312 registry records; 101 have a state named by a recorded role or "
              "court; the exact normalised name matches exactly one judges record in that state for 5.",
              f"- Agencies: {len(leads['agency']['leads'])} registry agency images with an fr_id matching an agency "
              f"page; {len(builds['agency_images']['rows'])} agencies with photos or marks.",
              f"- Committees: {len(leads['committee']['leads'])} of 50 marks map to our committee ids by exact code "
              f"and website host; {len(builds['committee_marks']['rows'])} committees (one mark each).",
              f"- Companies: 539 registry entities; {len(leads['company']['leads'])} have exactly one unshared CIK "
              f"with a company page; {len(builds['company_logos_open']['rows'])} rows after the Wikidata P5531/P154 "
              "re-read.",
              f"- States: {len(leads['state']['leads'])} of 56 state pages have a default photograph; "
              f"{len(builds['state_capitol_images']['rows'])} rows.", ""]
    if comparison:
        lines += ["## Registry vs origin (cached responses only, informational)", "",
                  "```", json.dumps(comparison["summary"], indent=1), "```", "", "Examples:", ""]
        ex, seen = [], set()
        for d in comparison["disagreements"]:
            if (d["dataset"], d["field"]) in seen:
                continue
            seen.add((d["dataset"], d["field"]))
            ex.append((d["dataset"], d["id"], d["field"], str(d["registry"])[:80], str(d["origin"])[:80],
                       d.get("origin_url", "")))
        lines += [md_table(["Dataset", "Row", "Field", "Registry", "Origin", "Origin page"], ex[:8]), ""]
    if spot:
        ok = sum(1 for s in spot if s["match"] is True)
        limited = sum(1 for s in spot if s["match"] is None)
        lines += ["## Live URL spot check", "",
                  f"{len(spot)} sampled display/thumbnail/mark URLs requested once (bytes not stored; fjc.gov not "
                  f"sampled): {ok} returned HTTP 200 with the stated pixel size (SVG: an SVG content type); {limited} "
                  "were refused with HTTP 429 (the host's rate limit for this shared address, after polite retries) "
                  "and are not checked.", ""]
        bad = [s for s in spot if s["match"] is False]
        if bad:
            lines += [md_table(["Dataset", "URL", "Status", "Stated", "Decoded"],
                               [(s["dataset"], s["url"], s["status"], s["stated"], s["decoded"]) for s in bad]), ""]
    lines += ["## Displayed values vs the registry record (15 spot checks)", ""]
    checks = []
    for ds in ("court_buildings", "agency_images", "committee_marks", "company_logos_open", "judge_portraits_open"):
        for r in builds[ds]["rows"][:3]:
            item = r["item"]
            if ds == "court_buildings":
                b = item["buildings"][0]
                a, shown = assets[b["asset_id"]], b["photo"]
            elif ds == "agency_images":
                x = (item["photos"] or item["marks"])[0]
                a, shown = assets[x["asset_id"]], x
            elif ds == "committee_marks":
                a = next(v for v in assets.values() if v.get("image_url") == item["mark"]["url"])
                shown = item["mark"]
            elif ds == "company_logos_open":
                a = next(v for v in assets.values() if v.get("statement_id") == item["logo"]["statement_id"])
                shown = item["logo"]
            else:
                aid = next(f[1] for f in r["detail"]["facts"] if f[0] == "Registry asset")
                a, shown = assets[aid], item["portrait"]
            for field, reg in (("license", (a.get("license") or "").strip() or "Not recorded"),
                               ("rights_status", a.get("rights_status"))):
                checks.append((ds, r["id"], field, shown.get(field), reg, "yes" if shown.get(field) == reg else "no"))
    lines += [md_table(["Dataset", "Row", "Field", "Shown", "Registry record", "Match"], checks[:20]), ""]
    lines += ["## Not done, and why", "",
              "- Licence re-verification and the visual review: dropped by the owner decision above.",
              "- 166 FJC-hosted courthouse photos have no recorded width/height; they are held (measuring them would "
              "need 166 more fjc.gov requests at its 30 s crawl delay).",
              "- USGS National Map (60), encyclopedia (1) and a Guam link whose evidence host differs from our "
              "recorded court website (1) are held: the identity rule requires a U.S. Courts or court-website page.",
              "- House Intelligence (IG00, 2 marks) is held: our id is hlig00, not hs + code; the house_judiciary "
              "wordmark has no committee code.",
              "- The workbook's Page Visuals default for one state page is a map, not a photograph (held).", ""]
    lines += ["## Open risks", "",
              "- Rights: images are published with the registry's recorded rights status, including agency seals and "
              "logos recorded as restricted or review_required (some agency emblems are protected by statute or "
              "agency policy), FJC-hosted courthouse photos recorded as 'Not assessed', and committee marks whose "
              "recorded licence is 'Pending file-specific policy and visual review'. The UI should show rights_status "
              "and, for marks, branding_note. AGENTS.md (owner decision 2026-10-22) still excludes non-commercial "
              "licences; the published sets contain no NC/ND licence text (table above), but 'other' covers licence "
              "texts nobody has assessed.",
              "- No visual review: a photograph could show an interior, a different building or a group; only the "
              "title-based ARTWORK rule ran.",
              "- verified_at carries the registry's own retrieval time (fetched_at), not a verification by this build.",
              "- Derived Wikimedia thumbnail heights are scaled from the recorded original size with MediaWiki's "
              "rounding; the live spot check compares a sample.",
              "- court_images: new rows hosted on fjc.gov / gsa.gov / tile.loc.gov, or with license_family 'other', are "
              "dropped by the current src/lib/courts/photos.ts parser (Commons hosts and kept families only) until "
              "the UI parser accepts them.",
              "- Wikimedia answered HTTP 429 to this shared address during the build; visitors' browsers fetch "
              "thumbnails from their own addresses, so this affects checking, not display.", ""]
    (BUILD / "REPORT.md").write_text("\n".join(lines) + "\n")
    print("wrote", BUILD / "REPORT.md")


if __name__ == "__main__":
    main()
