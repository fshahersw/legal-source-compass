"""Probe official hosts: status, size and content type for each URL given on the command line (nothing saved).

  python3 -I -B scripts/enrichment/court_rules/probe.py <url> [<url> ...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchlib  # noqa: E402


def main(urls):
    for url in urls:
        try:
            allowed = fetchlib.robots_allows(url)
            if not allowed:
                print(f"ROBOTS-DISALLOW {url}")
                continue
            status, body, headers = fetchlib.fetch(url, None, retries=1, check_robots=False, timeout=45)
            head = body[:160].decode("utf-8", "replace").replace("\n", " ")
            print(f"{status} {len(body)} {headers.get('Content-Type', '')} {headers.get('X-Final-URL')} :: {head[:120]}")
        except Exception as error:  # report and continue
            print(f"ERR {url} {error}")


if __name__ == "__main__":
    main(sys.argv[1:])
