"""Which annual editions of the US Code GovInfo publishes for each title (1994-2024), from GovInfo's own sitemaps,
and a check that GovInfo's link service resolves the section URL pattern used on the section pages.

  python3 -I -B scripts/enrichment/uscode/govinfo_editions.py            sitemaps -> editions.json
  python3 -I -B scripts/enrichment/uscode/govinfo_editions.py --check N  + resolve N sample section links

Sitemaps: https://www.govinfo.gov/sitemap/USCODE_sitemap_index.xml lists one sitemap per edition year; each lists one
package per title (https://www.govinfo.gov/app/details/USCODE-<year>-title<N>). Output:
private/build/uscode/govinfo_editions.json {"years": {title_key: [years]}, "packages": n, "sitemaps": [...],
"link_checks": [...]}. Link pattern (GovInfo link service, https://www.govinfo.gov/link-docs):
https://www.govinfo.gov/link/uscode/<title>/<section>?year=<yyyy>&type=usc&link-type=html
"""
import argparse
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetchlib  # noqa: E402

MANIFEST = fetchlib.ACQ / "_manifest.jsonl"
INDEX = "https://www.govinfo.gov/sitemap/USCODE_sitemap_index.xml"
OUT = fetchlib.BUILD / "govinfo_editions.json"
PKG = re.compile(r"/app/details/USCODE-(\d{4})-title(\d{1,2}[A-Za-z]?)</loc>")


def link_url(title_key, section_key, year, link_type="html"):
    return (f"https://www.govinfo.gov/link/uscode/{title_key}/{section_key}?year={year}&type=usc"
            f"&link-type={link_type}")


def read(url, name):
    path = fetchlib.ACQ / "govinfo_sitemaps" / name
    fetchlib.fetch_file(url, path, MANIFEST, gzip_body=True)
    with fetchlib.open_raw(path) as handle:
        return handle.read().decode("utf-8")


def editions():
    index = read(INDEX, "USCODE_sitemap_index.xml.gz")
    maps = sorted(re.findall(r"<loc>(https://www\.govinfo\.gov/sitemap/USCODE_(\d{4})_sitemap\.xml)</loc>", index))
    years, packages = {}, 0
    for url, year in maps:
        body = read(url, f"USCODE_{year}_sitemap.xml.gz")
        for y, t in PKG.findall(body):
            if y != year:
                continue
            key = t.lower().lstrip("0")
            years.setdefault(key, set()).add(int(y))
            packages += 1
    return {"years": {k: sorted(v) for k, v in sorted(years.items(), key=lambda kv: (int(re.match(r"\d+", kv[0]).group()), kv[0]))},
            "packages": packages, "sitemaps": [u for u, _ in maps], "retrieved_at": fetchlib.now()}


def check_links(result, samples):
    """Resolve sample links without following the redirect: 302 to a /content/pkg/USCODE-<year>-title<N>/ URL is a pass."""
    parsed = fetchlib.BUILD / "parsed"
    rels = sorted(p for p in parsed.iterdir() if p.is_dir())
    import parse_release  # noqa: E402
    rng = random.Random(1994)
    pool = []
    for f in sorted(rels[-1].glob("t*.jsonl.gz")):
        head, _, units = parse_release.read_parsed(f)
        if head["key"] not in result["years"]:
            continue
        for u in units:
            if u["kind"] == "section" and u["identifier"] and u["status"] is None and "..." not in u["key"]:
                pool.append((head["key"], u["key"]))
    checks = []
    for title, sec in rng.sample(pool, samples):
        latest = max(result["years"][title])
        for year in sorted({latest, rng.choice(result["years"][title])}):
            try:
                status, _, hdrs, _ = fetchlib.request(link_url(title, sec, year), follow=False, retries=3,
                                                      interval=1.0)
            except RuntimeError as error:   # GovInfo answers 400 "No results" for a section absent that year
                status, hdrs = (400, {}) if "HTTP 400" in str(error) else (None, {})
            loc = hdrs.get("location", "")
            ok = status == 302 and f"/content/pkg/USCODE-{year}-title{title}" in loc
            checks.append({"title": title, "section": sec, "year": year, "latest": year == latest, "status": status,
                           "location": loc[:200], "resolved": ok})
    return checks


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", type=int, default=0)
    args = ap.parse_args()
    result = editions()
    if args.check:
        result["link_checks"] = check_links(result, args.check)
    elif OUT.exists():
        result["link_checks"] = json.loads(OUT.read_text()).get("link_checks", [])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=1))
    print(json.dumps({"titles": len(result["years"]), "packages": result["packages"],
                      "years": sorted({y for v in result["years"].values() for y in v})[:1] + ["..."] +
                      sorted({y for v in result["years"].values() for y in v})[-1:],
                      "link_checks": sum(1 for c in result.get("link_checks", []) if c["resolved"]),
                      "of": len(result.get("link_checks", [])), "requests": fetchlib.COUNTS}))
