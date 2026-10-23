"""Resolve the official uscode.house.gov page of every Code unit whose URL is not the plain t<title>/s<section>
pattern (court rules, appendix acts, reorganization plans), and check a random sample of plain section URLs.

  python3 -I -B scripts/enrichment/uscode/check_official_urls.py <release> [--sample 200]

A page counts as found when GET returns HTTP 200 (no body is stored). Results go to
private/build/uscode/official_urls_<release>.json: {"units": {"<title>:<key>": {"url", "status"}}, "plain_sample": [...]}.
Units whose candidates all fail are linked to their title's page, labelled as such on the section page.
"""
import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cite  # noqa: E402
import fetchlib  # noqa: E402
import parse_release  # noqa: E402


def out_path(release):
    return fetchlib.BUILD / f"official_urls_{release}.json"


def parent_identifier(unit, containers):
    for idx in reversed(unit["ancestors"]):
        ident = containers[idx].get("identifier")
        if ident:
            return ident
    return None


def probe(url):
    """GET status of url, one request per second. A 403 (the host's rate limit) pauses 90 s and retries once;
    a second 403 stops the run (never worked around)."""
    for attempt in range(2):
        try:
            status, _, _, _ = fetchlib.request(url, retries=3, interval=1.0)
            return status
        except RuntimeError as error:
            if "HTTP 403" not in str(error) or attempt:
                raise
            time.sleep(90)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("release")
    ap.add_argument("--sample", type=int, default=200)
    ap.add_argument("--retry-failed", action="store_true", help="probe again the units whose candidates all failed")
    ap.add_argument("--keep-sample", action="store_true", help="reuse the stored plain-URL sample (no requests)")
    args = ap.parse_args()
    prior = json.loads(out_path(args.release).read_text()) if out_path(args.release).exists() else {"units": {}}
    units_out = prior.get("units", {})
    if args.retry_failed:
        units_out = {k: v for k, v in units_out.items() if v["url"]}
    plain = []
    for f in sorted(parse_release.parsed_dir(args.release).glob("t*.jsonl.gz")):
        head, containers, units = parse_release.read_parsed(f)
        tkey = head["key"]
        for u in units:
            uid = f"{tkey}:{u['key']}"
            path = cite.plain_section_path(tkey, u)
            if path:
                plain.append((uid, cite.BASE + f"{args.release}/" + path))
                continue
            if uid in units_out:
                continue
            found = None
            tried = []
            for url in cite.url_candidates(args.release, tkey, u, parent_identifier(u, containers)):
                status = probe(url)
                tried.append([url, status])
                if status == 200:
                    found = url
                    break
            units_out[uid] = {"url": found, "tried": tried}
            if tried:
                print(json.dumps({"unit": uid, "url": found, "tried": len(tried)}), flush=True)
                if len(units_out) % 25 == 0:
                    out_path(args.release).write_text(json.dumps({"release": args.release, "units": units_out,
                                                                  "partial": True}, indent=1))
    rng = random.Random(124)
    sample = prior.get("plain_sample", []) if args.keep_sample else []
    if not sample:
        for uid, url in rng.sample(plain, min(args.sample, len(plain))):
            sample.append({"unit": uid, "url": url, "status": probe(url)})
    result = {"release": args.release, "units": units_out, "plain_sample": sample, "checked_at": fetchlib.now(),
              "requests": fetchlib.COUNTS}
    out_path(args.release).write_text(json.dumps(result, indent=1))
    found = sum(1 for v in units_out.values() if v["url"])
    print(json.dumps({"non_plain_units": len(units_out), "found": found, "plain_units": len(plain),
                      "plain_sample_ok": sum(1 for s in sample if s["status"] == 200), "of": len(sample),
                      "requests": fetchlib.COUNTS}))


if __name__ == "__main__":
    main()
