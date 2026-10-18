"""Recover GovInfo JPML packages that the GovInfo sitemaps do not list.

The sitemaps omit many JPML dockets (e.g. only 4 packages for 2023, none for MDLs 3049-3085), yet GovInfo serves them.
Package ids follow USCOURTS-jpml-1_{yy}-F-{mdl:05d}, where yy is the docket's opening year. For every MDL number on a
hearing-session schedule, the JPML pending reports or the Panel Orders page that has no known package, this probes
yy in {session/filing year, year-1, year-2} and saves any MODS found (raw, unchanged) next to the sitemap ones.
"""
import concurrent.futures as cf
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import parse_jpml as pj  # noqa: E402
from common import ACQ, manifest, pdftotext  # noqa: E402
from fetchutil import fetch  # noqa: E402

MODS = "https://www.govinfo.gov/metadata/pkg/{pkg}/mods.xml"


def candidates():
    """{mdl: set(years)} from schedules (session year), pending report (filing year) and Panel Orders page (2026)."""
    out = {}
    man = manifest()
    for f in man["files"]:
        if f["page"] in ("hearing_archive", "hearing_current") and f["text"].startswith("Notice of"):
            parsed = pj.parse_hearing_notice(pdftotext(ACQ / f["file"]))
            year = int((parsed["session_date"] or re.search(r"(\d{4})", f["text"]).group(1))[:4])
            for m in parsed["matters"]:
                out.setdefault(m["mdl"], set()).add(year)
    for r in pj.parse_by_type((ACQ / "txt" / "by_type.txt").read_text()):
        if r["date_filed"]:
            out.setdefault(r["mdl"], set()).add(int(r["date_filed"][:4]))
    for item in man["pages"]["panel_orders"]["pdfs"] + man["pages"]["hearing_archive"]["pdfs"]:
        m = re.search(r"MDL-(\d+)", item["url"])
        if m:
            out.setdefault(int(m.group(1)), set()).add(2026)
    return out


def main():
    known = json.loads((ACQ / "govinfo" / "packages.json").read_text())
    have = {int(re.search(r"F-0*(\d+)$", p).group(1)) for p in known if re.search(r"F-0*(\d+)$", p)}
    cands = candidates()
    # MDL numbers are assigned in filing order: also probe every unlisted number between 2700 and the newest docket,
    # using the opening year of the nearest listed neighbour (and the year before/after).
    year_of = {}
    for p in known:
        m = re.search(r"jpml-1_(\d{2})-F-0*(\d+)$", p)
        if m:
            year_of[int(m.group(2))] = 2000 + int(m.group(1)) if int(m.group(1)) < 50 else 1900 + int(m.group(1))
    top = max(list(cands) + list(have))
    for n in range(2700, top + 1):
        if n in have or n in cands:
            continue
        near = min(year_of, key=lambda k: abs(k - n)) if year_of else None
        if near is not None:
            y = year_of[near]
            cands[n] = {y + 1, y}
    jobs = []
    for mdl, years in cands.items():
        if mdl in have:
            continue
        yys = sorted({y - d for y in years for d in (0, 1, 2)}, reverse=True)
        jobs.append((mdl, [f"USCOURTS-jpml-1_{y % 100:02d}-F-{mdl:05d}" for y in yys]))

    def probe(job):
        mdl, pkgs = job
        for pkg in pkgs:
            body, path, status = fetch(MODS.format(pkg=pkg), "govinfo/mods")
            if status == 200 and b"<mods" in body[:2000]:
                return mdl, pkg, path.name
        return mdl, None, None

    found = {}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for mdl, pkg, name in pool.map(probe, jobs):
            if pkg:
                found[pkg] = {"status": 200, "file": name, "sitemap_year": None, "source": "probe"}
    known.update(found)
    (ACQ / "govinfo" / "packages.json").write_text(json.dumps(known, indent=1))
    all_probed = sorted(p for p, v in known.items() if v.get("source") == "probe")
    (ACQ / "govinfo" / "probe_results.json").write_text(json.dumps({"probed_mdls_this_run": len(jobs), "found_this_run": sorted(found), "found_by_probe_total": all_probed}, indent=1))
    print(json.dumps({"probed_mdls": len(jobs), "found": len(found)}))


if __name__ == "__main__":
    main()
