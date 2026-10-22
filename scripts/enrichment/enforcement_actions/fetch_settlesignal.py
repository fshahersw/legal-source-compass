"""Fetch the SettleSignal lead list and each lead's official settlement page.

  python3 -I -B scripts/enrichment/enforcement_actions/fetch_settlesignal.py [--limit N] [--refetch-sample N]

SettleSignal (https://settlesignal.com/data/settlements.json, "Free to use with attribution. Credit 'SettleSignal
(settlesignal.com)' with a link to https://settlesignal.com/") is used only as a lead list: nothing from it is
published unless the official page confirms it (see build_settlements.py). For every lead, the official_settlement_url
is read once, obeying that host's robots.txt (fetched with our User-Agent; Crawl-delay honoured, at least 2 s between
requests to one host). Pages that answer 401/403 or a bot wall are recorded as blocked and never retried around.
Raw responses are kept unchanged in solid xz packs; robots.txt answers are kept too.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enf_common as ec  # noqa: E402

LEADS_URL = "https://settlesignal.com/data/settlements.json"
LICENCE_URLS = ["https://settlesignal.com/.well-known/rsl.xml", "https://settlesignal.com/robots.txt"]
DIR = os.path.join(ec.ACQ, "settlesignal")
LEADS_PATH = os.path.join(DIR, "settlements.json.gz")
PAGES = os.path.join(DIR, "official_pages")
ROBOTS = os.path.join(DIR, "robots")
STATUS = os.path.join(DIR, "fetch_status.jsonl")
RECHECK = os.path.join(DIR, "recheck_pages")
LOG = os.path.join(ec.SCRATCH, "settlesignal_fetch.log")


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write(f"{ec.now_utc()} {msg}\n")


def fetch_leads(fetcher):
    status, body, _, _ = fetcher.get(LEADS_URL)
    if status != 200:
        raise SystemExit(f"lead list: HTTP {status}")
    ec.write_gz(LEADS_PATH, body)
    ec.record_manifest(LEADS_URL, LEADS_PATH, body, status, "SettleSignal open data (direct GET)")
    for url in LICENCE_URLS:
        st, data, _, _ = fetcher.get(url)
        if st == 200:
            dest = os.path.join(DIR, "licence_" + os.path.basename(urllib.parse.urlsplit(url).path) + ".gz")
            ec.write_gz(dest, data)
            ec.record_manifest(url, dest, data, st, "SettleSignal licence/robots (direct GET)")
    return json.loads(body)


class Robots:
    def __init__(self, fetcher, packs):
        self.fetcher = fetcher
        self.packs = packs
        self.cache = {}

    def check(self, url):
        """(allowed, crawl_delay, note) for url under its host's robots.txt."""
        parts = urllib.parse.urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self.cache:
            robots_url = origin + "/robots.txt"
            parser = urllib.robotparser.RobotFileParser()
            note = "robots.txt read"
            try:
                status, body, final, _ = self.fetcher.get(robots_url)
                self.packs.add(robots_url, body, status, final)
                if status == 200:
                    parser.parse(body.decode("utf-8", "replace").splitlines())
                else:
                    parser.allow_all = True
                    note = f"robots.txt HTTP {status} (no rules)"
            except ec.Blocked as error:
                # RFC 9309 s. 2.3.1.3: a 4xx robots.txt is "unavailable" and sets no rules. The page itself is
                # still requested only once; if it also answers 401/403 it is recorded as blocked, never bypassed.
                parser.allow_all = True
                note = f"robots.txt answered {str(error).split()[0]} (RFC 9309: unavailable, no rules)"
            except RuntimeError as error:
                parser.allow_all = True
                note = f"robots.txt unreachable ({error}); no rules applied"
            self.cache[origin] = (parser, note)
        parser, note = self.cache[origin]
        allowed = parser.can_fetch(ec.USER_AGENT, url)
        delay = parser.crawl_delay(ec.USER_AGENT) if not getattr(parser, "allow_all", False) else None
        return allowed, delay, note


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--refetch-sample", type=int, default=0, help="re-read N confirmed pages for the verify script")
    parser.add_argument("--exclude-host", action="append", default=[], help="defer this host (e.g. while another crawl holds its crawl delay)")
    parser.add_argument("--retry", action="append", default=[], help="re-read URLs whose last outcome is this (e.g. error, robots_disallowed)")
    parser.add_argument("--only-host", action="append", default=[], help="read only URLs on this host")
    args = parser.parse_args()
    fetcher = ec.Fetcher(default_interval=2.0, timeout=45, retries=3)
    if args.refetch_sample:
        return refetch_sample(fetcher, args.refetch_sample)
    data = fetch_leads(fetcher)
    leads = data["settlements"]
    packs = ec.PackWriter(PAGES, per_pack=50, method="official settlement page named by a SettleSignal lead (direct GET)")
    robots_packs = ec.PackWriter(ROBOTS, per_pack=200, method="robots.txt (direct GET)")
    robots = Robots(fetcher, robots_packs)
    done_status = {row["url"]: row for row in ec.load_jsonl(STATUS)}
    urls = []
    for lead in leads:
        url = (lead.get("official_settlement_url") or "").strip()
        if url.startswith(("http://", "https://")) and url not in urls:
            urls.append(url)
    retry = set(args.retry)
    todo = [u for u in urls if (u not in done_status or done_status[u].get("outcome") in retry)
            and urllib.parse.urlsplit(u).hostname not in set(args.exclude_host)
            and (not args.only_host or urllib.parse.urlsplit(u).hostname in set(args.only_host))]
    if args.limit:
        todo = todo[:args.limit]
    log(f"{len(leads)} leads, {len(urls)} distinct official URLs, {len(todo)} to read")

    def one(url):
        entry = {"url": url, "checked_at": ec.now_utc()}
        try:
            allowed, delay, note = robots.check(url)
            entry["robots"] = note
            if not allowed:
                entry["outcome"] = "robots_disallowed"
                return entry
            host = urllib.parse.urlsplit(url).hostname or ""
            if delay:
                fetcher.rates[host] = max(2.0, float(delay))
            status, body, final, headers = fetcher.get(url, headers={"Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5"})
            entry.update({"status": status, "final_url": final, "content_type": headers.get("Content-Type") or headers.get("content-type"), "bytes": len(body)})
            if status == 200:
                packs.add(url, body, status, final)
                entry["outcome"] = "fetched"
            else:
                entry["outcome"] = f"http_{status}"
        except ec.Blocked as error:
            entry["outcome"] = "blocked"
            entry["detail"] = str(error)
        except Exception as error:  # recorded per URL; nothing is guessed
            entry["outcome"] = "error"
            entry["detail"] = f"{type(error).__name__}: {error}"[:300]
        return entry

    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            with open(STATUS, "a", encoding="utf-8") as status_file:
                for n, entry in enumerate(pool.map(one, todo), 1):
                    status_file.write(json.dumps(entry) + "\n")
                    status_file.flush()
                    if n % 50 == 0:
                        log(f"{n}/{len(todo)} read; stats {fetcher.stats}")
    finally:
        packs.close()
        robots_packs.close()
    log(f"done; stats {fetcher.stats}")


def refetch_sample(fetcher, n):
    """Re-read a deterministic sample of confirmed official pages (for verify_settlements.py)."""
    build = json.load(open(os.path.join(ec.BUILD, "settlement_claims_official.json"), encoding="utf-8"))
    # ftc.gov is left out of the sample while the FTC case crawl holds its 5 s crawl delay
    rows = sorted((r for r in build["rows"] if urllib.parse.urlsplit(r["source_url"]).hostname != "www.ftc.gov"),
                  key=lambda r: ec.sha256(r["id"].encode()))[:n]
    packs = ec.PackWriter(RECHECK, per_pack=50, method="official settlement page re-read for verification (direct GET)")
    try:
        for row in rows:
            url = row["source_url"]
            if packs.has(url):
                continue
            try:
                status, body, final, _ = fetcher.get(url)
            except Exception as error:
                log(f"recheck {url}: {error}")
                continue
            if status == 200:
                packs.add(url, body, status, final)
    finally:
        packs.close()
    log(f"recheck done; stats {fetcher.stats}")


if __name__ == "__main__":
    main()
