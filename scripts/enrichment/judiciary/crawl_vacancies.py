"""uscourts.gov judicial vacancies: the four current pages plus the monthly archive 1981-2026 (every report each year page
links: vacancy list, future vacancies, emergencies, summary, confirmations). Older months are served as PDFs at the same
archive URL (the server redirects); those bytes are kept as served. Stored by fetchlib (gzip, sha256 in the manifest);
a re-run makes no new requests.

  python3 -I -B crawl_vacancies.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

HOST = "https://www.uscourts.gov"
CURRENT = [
    "/data-news/judicial-vacancies/current-judicial-vacancies",
    "/data-news/judicial-vacancies/future-judicial-vacancies",
    "/data-news/judicial-vacancies/confirmation-listing",
    "/data-news/judicial-vacancies/judicial-emergencies",
    "/data-news/judicial-vacancies/judicial-emergencies/judicial-emergency-definition",
]
YEAR = HOST + "/judges-judgeships/judicial-vacancies/archive-judicial-vacancies?year={y}"
LINK = re.compile(r'href="(/judges-judgeships/judicial-vacancies/archive-judicial-vacancies/(\d{4})/(\d{2})/([a-z]+))"')


def month_links(year: int) -> list[str]:
    status, body, _ = fl.fetch(YEAR.format(y=year), "vacancies", method="direct urllib GET (uscourts.gov vacancy archive year page)")
    if status != 200:
        return []
    out = []
    for href, y, _m, _kind in LINK.findall(body.decode("utf-8", "replace")):
        if int(y) == year and href not in out:
            out.append(href)
    return out


def main() -> None:
    for path in CURRENT:
        fl.fetch(HOST + path, "vacancies", method="direct urllib GET (uscourts.gov current vacancy page)")
    total = 0
    missing = []
    for year in range(1981, 2027):
        links = month_links(year)
        for href in links:
            status, body, _ = fl.fetch(HOST + href, "vacancies", method="direct urllib GET (uscourts.gov vacancy archive report)", ok_missing=True)
            total += 1
            if status != 200:
                missing.append([href, status])
        print(json.dumps({"year": year, "reports": len(links), "fetched_total": total}), flush=True)
    print(json.dumps({"reports": total, "missing": missing}), flush=True)


if __name__ == "__main__":
    main()
