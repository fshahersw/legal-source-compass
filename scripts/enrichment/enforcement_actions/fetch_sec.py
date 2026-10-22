"""Read the SEC enforcement lists (litigation releases, administrative proceedings) and every litigation-release page.

  python3 -I -B scripts/enrichment/enforcement_actions/fetch_sec.py --listings
  python3 -I -B scripts/enrichment/enforcement_actions/fetch_sec.py --releases [--limit N]

Sources: https://www.sec.gov/enforcement-litigation/litigation-releases?page=N and
https://www.sec.gov/enforcement-litigation/administrative-proceedings?page=N (100 rows a page, newest first), then
https://www.sec.gov/enforcement-litigation/litigation-releases/lr-NNNNN for each release (civil action number and
court are stated in the release text). SEC fair-access rules: a User-Agent naming the requester with contact, at most
10 requests/s; this stays at no more than 4 request starts per second. Administrative-proceeding documents are PDFs and
are not downloaded (the list's respondents, release and file numbers are published facts). Raw HTML is kept
unchanged in solid xz packs.
"""
import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enf_common as ec  # noqa: E402
import sec_parse  # noqa: E402

BASE = "https://www.sec.gov"
LISTS = {
    "lr": BASE + "/enforcement-litigation/litigation-releases",
    "ap": BASE + "/enforcement-litigation/administrative-proceedings",
}
LIST_DIR = os.path.join(ec.ACQ, "sec", "listing")
LR_DIR = os.path.join(ec.ACQ, "sec", "releases")
LOG = os.path.join(ec.SCRATCH, "sec_fetch.log")


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write(f"{ec.now_utc()} {msg}\n")


def list_url(kind, n):
    return LISTS[kind] if n == 0 else f"{LISTS[kind]}?page={n}"


def crawl_listings(fetcher):
    packs = ec.PackWriter(LIST_DIR, per_pack=40, method="sec.gov enforcement listing (direct GET)")
    try:
        for kind in LISTS:
            first = list_url(kind, 0)
            status, body, final, _ = fetcher.get(first)
            if not packs.has(first):
                packs.add(first, body, status, final)
            last = sec_parse.last_page(body.decode("utf-8", "replace"))
            log(f"{kind}: last page {last}")
            urls = [list_url(kind, n) for n in range(1, last + 1) if not packs.has(list_url(kind, n))]
            with ThreadPoolExecutor(max_workers=4) as pool:
                for url, result in zip(urls, pool.map(lambda u: fetcher.get(u), urls)):
                    status, body, final, _ = result
                    if status != 200:
                        log(f"{url}: HTTP {status}")
                        continue
                    packs.add(url, body, status, final)
    finally:
        packs.close()
    log(f"listings done; stats {fetcher.stats}")


def listed(kind):
    reader = ec.PackReader(LIST_DIR)
    rows = []
    for row in reader.rows_by_pack():
        if not row["url"].startswith(LISTS[kind]):
            continue
        for item in sec_parse.parse_listing(reader.get(row["url"]).decode("utf-8", "replace")):
            item["listing_url"] = row["url"]
            rows.append(item)
    return rows


def crawl_releases(fetcher, limit):
    items = listed("lr")
    urls = []
    seen = set()
    for item in items:
        url = item.get("url")
        release_page = url and (
            url.startswith(BASE + "/enforcement-litigation/litigation-releases/")
            or (url.startswith(BASE + "/files/litigation/litreleases/") and url.lower().endswith((".txt", ".htm", ".html")))
        )
        if release_page and url not in seen:
            seen.add(url)
            urls.append(url)
    packs = ec.PackWriter(LR_DIR, per_pack=100, method="sec.gov litigation release page (direct GET)")
    todo = [u for u in urls if not packs.has(u)]
    if limit:
        todo = todo[:limit]
    log(f"releases: {len(urls)} listed, {len(todo)} to fetch")
    done = failed = 0

    def one(url):
        try:
            return url, fetcher.get(url), None
        except Exception as error:  # counted and logged; a re-run fetches the gap
            return url, None, error

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for url, result, error in pool.map(one, todo):
                if error or result[0] != 200:
                    failed += 1
                    log(f"FAILED {url}: {error or result[0]}")
                    continue
                status, body, final, _ = result
                packs.add(url, body, status, final)
                done += 1
                if done % 500 == 0:
                    log(f"releases: {done}/{len(todo)} fetched, {failed} failed; stats {fetcher.stats}")
    finally:
        packs.close()
    log(f"releases end: {done} fetched, {failed} failed")
    print(json.dumps({"listed": len(urls), "fetched": done, "failed": failed}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listings", action="store_true")
    parser.add_argument("--releases", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    fetcher = ec.Fetcher(default_interval=0.25, timeout=60)
    if args.listings:
        crawl_listings(fetcher)
    if args.releases:
        crawl_releases(fetcher, args.limit)


if __name__ == "__main__":
    main()
