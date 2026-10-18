"""Download GovInfo USCOURTS metadata (MODS) for every JPML package (MDL docket) listed in the GovInfo sitemaps.

GovInfo publishes the Panel's written orders (transfer orders, orders denying transfer, etc.) as granules of a
package per MDL docket (e.g. USCOURTS-jpml-1_24-F-03134). The JPML Panel Orders page points to GovInfo for
historical orders. Raw sitemaps and MODS are saved unchanged under private/acq/mdl-intel/govinfo/.
"""
import concurrent.futures as cf
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetchutil import ACQ, fetch  # noqa: E402

INDEX = "https://www.govinfo.gov/sitemap/USCOURTS_sitemap_index.xml"
OUT = ACQ / "govinfo"


def main():
    body, _, status = fetch(INDEX, "govinfo", refresh=True)
    if status != 200:
        raise SystemExit(f"sitemap index -> {status}")
    maps = sorted(set(re.findall(r"https://www\.govinfo\.gov/sitemap/USCOURTS/USCOURTS_jpml_\d{4}_sitemap\.xml", body.decode())))
    packages = {}
    for url in maps:
        sm, _, st = fetch(url, "govinfo/sitemaps", refresh=True)
        year = re.search(r"jpml_(\d{4})_", url).group(1)
        for pkg in re.findall(r"/app/details/(USCOURTS-jpml-[^<\s]+)</loc>", sm.decode()):
            packages[pkg] = year
        time.sleep(0.2)
    print(json.dumps({"sitemaps": len(maps), "packages": len(packages)}), flush=True)

    def grab(pkg):
        url = f"https://www.govinfo.gov/metadata/pkg/{pkg}/mods.xml"
        data, path, st = fetch(url, "govinfo/mods")
        return pkg, st, path.name

    results = {}
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for i, (pkg, st, name) in enumerate(pool.map(grab, sorted(packages))):
            results[pkg] = {"status": st, "file": name, "sitemap_year": packages[pkg]}
            if i % 100 == 0:
                print(i, pkg, st, flush=True)
    (OUT / "packages.json").write_text(json.dumps(results, indent=1))
    print(json.dumps({"mods_ok": sum(1 for r in results.values() if r["status"] == 200), "total": len(results)}))


if __name__ == "__main__":
    main()
