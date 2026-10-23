"""Cross-check the stored weekly 1-year Treasury averages (FRED WGS1YR, the 28 U.S.C. § 1961 rate) against the
federal judiciary's published post-judgment rate tables on uscourts.gov:

  * District of New Mexico (https://www.nmid.uscourts.gov/post-judgment-interest-rates, one table per year 2010–2026):
    every row's "week ending" rate must equal the stored weekly average, and its "effective date" range must equal the
    calculator's rule (the Monday to Sunday after the week-ending Friday, src/lib/calculators/postJudgment.ts).
  * District of Utah correction table (Oct 2016 – Dec 2019): the court's "corrected rate" must equal the stored value
    (the court's originally published rates are listed beside them and are expected to differ).

Writes private/build/w1025_api-econ/fred/crosscheck_pji.json. Pages are kept unchanged under
private/acq/w1025_api-econ/pji/ with a manifest.

  python3 -I -B scripts/api_econ/crosscheck_pji.py [--fred-build private/build/w1025_api-econ/fred/econ_fred_observations.json]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

RAW = ec.ACQ / "pji"
NMID = "https://www.nmid.uscourts.gov/post-judgment-interest-rates?field_rate_year_value%5Bvalue%5D%5Byear%5D={year}"
UTD = "https://www.utd.uscourts.gov/sites/utd/files/Post%20%20Judgment%20Interest%20Rates%20Reconcilation%20FINAL%204-2022.pdf"


def mdy(s: str) -> str:
    m, d, y = s.strip().split("/")
    return f"{y}-{int(m):02d}-{int(d):02d}"


def week_for(judgment: str) -> tuple[str, str, str]:
    """Same rule as rateWeekFor in src/lib/calculators/postJudgment.ts."""
    d = date.fromisoformat(judgment)
    monday = d - timedelta(days=d.weekday())
    return (monday - timedelta(days=3)).isoformat(), monday.isoformat(), (monday + timedelta(days=6)).isoformat()


def fetch(http: ec.Http, url: str, name: str) -> bytes:
    path = RAW / name
    if path.exists():
        return path.read_bytes()
    body = http.get(url)
    ec.save_raw(path, body, url, RAW / "_manifest.jsonl")
    return body


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fred-build", default=str(ec.BUILD / "fred" / "econ_fred_observations.json"))
    ap.add_argument("--years", default=",".join(str(y) for y in range(2010, 2027)))
    a = ap.parse_args(argv)
    build = json.loads(Path(a.fred_build).read_text())
    stored = {o[0]: o for r in build["rows"] if r["id"].startswith("fred:WGS1YR:") for o in r["item"]["fred"]["obs"]}
    http = ec.Http(min_interval=2.0)
    report = {"nmid": {"rows": 0, "rate_equal": 0, "window_equal": 0, "not_stored": [], "rate_differs": [], "window_differs": []},
              "utd": {"rows": 0, "corrected_equal": 0, "published_differs_from_corrected": 0, "differs": [], "not_stored": []}}
    for y in [int(x) for x in a.years.split(",") if x]:
        text = fetch(http, NMID.format(year=y), f"nmid_{y}.html").decode("utf-8", errors="replace")
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S):
            cells = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", c))).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) < 3 or not re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", cells[0]):
                continue
            we = mdy(cells[0])
            rate = cells[1].replace("%", "").strip()
            report["nmid"]["rows"] += 1
            o = stored.get(we)
            if not o:
                report["nmid"]["not_stored"].append(we)
                continue
            if o[1] is not None and abs(float(o[1]) - float(rate)) < 1e-9:
                report["nmid"]["rate_equal"] += 1
            else:
                report["nmid"]["rate_differs"].append({"week_ending": we, "court": rate, "stored": o[1]})
            m = re.fullmatch(r"(\d{1,2}/\d{1,2}/\d{4})\s*to\s*(\d{1,2}/\d{1,2}/\d{4})", cells[2])
            if m:
                frm, to = mdy(m.group(1)), mdy(m.group(2))
                if week_for(frm) == (we, frm, to) and week_for(to) == (we, frm, to):
                    report["nmid"]["window_equal"] += 1
                else:
                    report["nmid"]["window_differs"].append({"week_ending": we, "court_window": [frm, to], "rule": list(week_for(frm))})
    pdf = fetch(http, UTD, "utd_corrections.pdf")
    tmp = RAW / "_utd.pdf"
    tmp.write_bytes(pdf)
    text = subprocess.run(["pdftotext", "-layout", str(tmp), "-"], capture_output=True, text=True, check=True).stdout
    tmp.unlink()
    for line in text.splitlines():
        m = re.match(r"^\s*(\d{1,2}/\d{1,2}/\d{4})(\*?)\s+(\d*\.\d+)%\s+(\d*\.\d+)%", line)
        if not m:
            continue
        we = mdy(m.group(1))
        if m.group(2):  # the table marks 11/10/2016 with "*The date is 11/11/2016"
            star = re.search(r"\*The date is (\d{1,2}/\d{1,2}/\d{4})", text[text.find(line):text.find(line) + 2000])
            if star:
                we = mdy(star.group(1))
        report["utd"]["rows"] += 1
        published, corrected = float(m.group(3)), float(m.group(4))
        if abs(published - corrected) > 1e-9:
            report["utd"]["published_differs_from_corrected"] += 1
        o = stored.get(we)
        if not o:
            report["utd"]["not_stored"].append(we)
        elif o[1] is not None and abs(float(o[1]) - corrected) < 1e-9:
            report["utd"]["corrected_equal"] += 1
        else:
            report["utd"]["differs"].append({"week_ending": we, "court_corrected": corrected, "stored": o[1]})
    out = ec.BUILD / "fred" / "crosscheck_pji.json"
    out.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: {kk: (vv if not isinstance(vv, list) else len(vv)) for kk, vv in v.items()} for k, v in report.items()}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
