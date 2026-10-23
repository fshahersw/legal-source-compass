"""Independent checks of the parsed vacancy reports and judicial_vacancies. Prints a JSON summary; writes verify_vacancies.json.

1. Quote check: every parsed value (court, names, reason, raw dates, days pending, filings) occurs verbatim in the row's
   source text, which is the report's own cell / line text.
2. Second path: the raw HTML of every HTML report is re-read with a different method (BeautifulSoup table walk instead of the
   regex row splitter) and the number of data rows with a date is compared with the number of parsed rows.
3. Published totals: where a report prints "Total Vacancies: N" (or Confirmations / Emergencies), the parsed row count is
   compared with N.
4. Current lists: the open / announced / emergency counts in the build equal the rows on the current pages.
"""
from __future__ import annotations

import collections
import gzip
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402
import parse_vacancies as pv  # noqa: E402
from bs4 import BeautifulSoup  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
FIELDS = ["incumbent", "reason", "nominee", "vacancy_date_raw", "nomination_date_raw", "confirmation_date_raw", "notification_date_raw",
          "days_pending", "weighted", "adjusted"]
DATE = re.compile(r"^\d{1,2}/\d{1,2}/(\d{2}|\d{4})$")


def bs_count(path: Path) -> int:
    soup = BeautifulSoup(gzip.decompress(path.read_bytes()).decode("utf-8", "replace"), "html.parser")
    n = 0
    for tr in soup.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        if any(DATE.match(c) for c in cells if c) and not any(c in pv.HEADER_KEYS for c in cells):
            n += 1
    return n


def main() -> None:
    data = json.loads((BUILD / "vacancies_parsed.json").read_text())
    failures, checks = [], 0
    for r in data["rows"]:
        for f in FIELDS:
            v = r.get(f)
            if v:
                checks += 1
                if v not in r["source_text"]:
                    failures.append({"check": "quote", "field": f, "value": v, "source": r["source_text"][:200]})
    parsed_by = collections.Counter((r["month"], r["kind"]) for r in data["rows"] if r["kind"] != "summary")
    totals_cmp = collections.Counter()
    second = collections.Counter()
    diffs = []
    for c in data["coverage"]:
        key = (c["month"], c["kind"])
        name = {"vacancies": "Vacancies", "confirmations": "Confirmations", "future": "Vacancies"}.get(c["kind"])
        tot = (c.get("published_totals") or {}).get(name) if name else None
        if tot is not None and c["status"] == "parsed":
            checks += 1
            totals_cmp["compared"] += 1
            if parsed_by[key] == tot:
                totals_cmp["exact"] += 1
            else:
                diffs.append({"report": key, "parsed": parsed_by[key], "published_total": tot})
        if c["format"] == "html" and c["kind"] != "summary" and c["month"] != "current":
            y, m = c["month"].split("-")
            path = pv.ARCHIVE / y / m / f"{c['kind']}.gz"
            n = bs_count(path)
            checks += 1
            second["compared"] += 1
            if n == parsed_by[key]:
                second["exact"] += 1
            else:
                second["different"] += 1
                if len(diffs) < 400:
                    diffs.append({"report": key, "parsed": parsed_by[key], "bs4_rows_with_date": n})
    for c in data["coverage"]:
        if c["month"] == "current" and c["kind"] in ("vacancies", "future", "emergencies", "confirmations"):
            name = {"vacancies": "current-judicial-vacancies", "future": "future-judicial-vacancies",
                    "emergencies": "judicial-emergencies", "confirmations": "confirmation-listing"}[c["kind"]]
            n = bs_count(pv.CURRENT / (name + ".gz"))
            checks += 1
            if n != parsed_by[("current", c["kind"])]:
                failures.append({"check": "current page rows", "kind": c["kind"], "parsed": parsed_by[("current", c["kind"])], "bs4": n})
    build = json.loads((BUILD / "judicial_vacancies.json").read_text())
    nat = next(r for r in build["rows"] if r["id"] == "national")["item"]
    for kind, key in (("vacancies", "open"), ("future", "announced"), ("emergencies", "emergencies")):
        checks += 1
        if nat["current_counts"][key] != parsed_by[("current", kind)]:
            failures.append({"check": "current counts", "kind": kind, "build": nat["current_counts"][key], "parsed": parsed_by[("current", kind)]})
    tot_fail = [d for d in diffs if "published_total" in d]
    for d in tot_fail:
        failures.append({"check": "published total", **d})
    report = {"checks": checks, "failures": len(failures), "failure_examples": failures[:25], "published_totals": dict(totals_cmp),
              "second_path_bs4": dict(second), "differences": diffs[:60]}
    (BUILD / "verify_vacancies.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ("checks", "failures", "published_totals", "second_path_bs4")}))


if __name__ == "__main__":
    main()
