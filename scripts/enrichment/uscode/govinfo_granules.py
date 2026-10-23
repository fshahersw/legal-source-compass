"""Which sections each GovInfo annual US Code edition contains, from the GovInfo API granule lists, so section pages
link only to the editions that have the section (GovInfo's link service answers "No results" otherwise).

  python3 -I -B scripts/enrichment/uscode/govinfo_granules.py [--titles 9,42] [--max-requests 4500]

GET https://api.govinfo.gov/packages/USCODE-<year>-title<N>/granules?offsetMark=*&pageSize=1000 (api.data.gov key
from private/scratch/secrets.env via court_rules/secrets_env.py, sent as X-Api-Key; never printed or stored).
Granule ids end in "-sec<number>" for sections. Output: private/build/uscode/govinfo_granules.json
{"sections": {"<title>": {"<section>": [years]}}, "packages": {"<package>": granule count}, "requests": n}; raw
responses are stored gzip-compressed under private/acq/uscode/govinfo_granules/ with manifest lines (URL without
the key). Resumable: packages already stored are not requested again.
"""
import argparse
import gzip
import json
import re
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib  # noqa: E402

API = "https://api.govinfo.gov/packages/"
RAW = fetchlib.ACQ / "govinfo_granules"
OUT = fetchlib.BUILD / "govinfo_granules.json"
MANIFEST = fetchlib.ACQ / "_manifest.jsonl"
SEC = re.compile(r"-sec([0-9A-Za-z.\-]+)$")


def key():
    """The api.data.gov key through the shared loader (scripts/enrichment/court_rules/secrets_env.py)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("secrets_env", HERE.parent / "court_rules" / "secrets_env.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.load("DATA_GOV_API_KEY")


def fetch_package(pkg, api_key, budget):
    """All granule pages of one package; returns (granules, requests used) or (None, used) when over budget."""
    path = RAW / f"{pkg}.json.gz"
    if path.exists():
        with gzip.open(path, "rt") as fh:
            return json.load(fh)["granules"], 0
    granules, mark, used = [], "*", 0
    while mark:
        if used >= budget:
            return None, used
        url = f"{API}{pkg}/granules?offsetMark={urllib.parse.quote(mark)}&pageSize=1000"
        status, body, _, _ = fetchlib.request(url, headers={"X-Api-Key": api_key, "Accept": "application/json"},
                                              interval=0.5)
        used += 1
        if status != 200:
            raise RuntimeError(f"{pkg}: HTTP {status}")
        page = json.loads(body)
        granules.extend(g["granuleId"] for g in page.get("granules", []))
        nxt = page.get("nextPage")
        mark = urllib.parse.parse_qs(urllib.parse.urlsplit(nxt).query).get("offsetMark", [None])[0] if nxt else None
    RAW.mkdir(parents=True, exist_ok=True)
    data = json.dumps({"package": pkg, "granules": granules, "retrieved_at": fetchlib.now()}).encode()
    with gzip.open(path, "wb") as fh:
        fh.write(data)
    fetchlib.append_manifest(MANIFEST, {"url": f"{API}{pkg}/granules (pages of 1000; key omitted)", "path": str(path),
                                        "sha256": __import__("hashlib").sha256(data).hexdigest(), "bytes": len(data),
                                        "retrieved_at": fetchlib.now(), "status": 200,
                                        "method": "GovInfo API granules, granule ids only"})
    return granules, used


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--titles")
    ap.add_argument("--max-requests", type=int, default=4500)
    args = ap.parse_args()
    editions = json.loads((fetchlib.BUILD / "govinfo_editions.json").read_text())["years"]
    want = set(args.titles.split(",")) if args.titles else None
    api_key = key()
    sections, packages, used, skipped = {}, {}, 0, []
    for title, years in editions.items():
        if want and title not in want:
            continue
        for year in years:
            pkg = f"USCODE-{year}-title{title}"
            granules, n = fetch_package(pkg, api_key, args.max_requests - used)
            used += n
            if granules is None:
                skipped.append(pkg)
                continue
            packages[pkg] = len(granules)
            for g in granules:
                m = SEC.search(g)
                if m:
                    sections.setdefault(title, {}).setdefault(m.group(1), []).append(year)
    for t in sections.values():
        for s in t:
            t[s] = sorted(set(t[s]))
    OUT.write_text(json.dumps({"sections": sections, "packages": packages, "requests": used, "skipped": skipped,
                               "built_at": fetchlib.now()}))
    print(json.dumps({"packages": len(packages), "requests": used, "skipped": len(skipped),
                      "sections": sum(len(v) for v in sections.values())}))


if __name__ == "__main__":
    main()
