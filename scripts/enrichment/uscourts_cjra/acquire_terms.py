"""Record robots.txt and the site's privacy and security policy page (public GET only; nothing is submitted or accepted).

Saved unchanged under private/acq/uscourts_cjra/pages/ and listed in the manifest like every other fetch.
Usage: python3 -I -B acquire_terms.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquire_cjra as A  # noqa: E402

TARGETS = [
    (A.BASE + "/robots.txt", "robots_uscourts.txt"),
    (A.BASE + "/privacy-security-policy", "privacy_security_policy.html"),
]

if __name__ == "__main__":
    pages = A.OUT / "pages"
    pages.mkdir(parents=True, exist_ok=True)
    for url, name in TARGETS:
        status, data = A.fetch_to(url, pages / name)
        print(status, len(data), url)
