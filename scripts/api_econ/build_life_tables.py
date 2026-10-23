"""United States life tables (NCHS, National Vital Statistics Reports) → econ_nchs_life_tables.

Source: the XLSX tables NCHS publishes beside each "United States Life Tables, <year>" report on its file server
(https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/NVSR/<vol>-<no>/TableNN.xlsx), listed on
https://www.cdc.gov/nchs/products/life_tables.htm. One row per report year and table (total population, males,
females, and the race and Hispanic-origin groups NCHS publishes for that year), with every age row exactly as stored in
the workbook: q(x), l(x), d(x), L(x), T(x), e(x). Nothing is interpolated; ages are the single-year intervals as
published ("0-1" … "99-100", "100 and over"). Group and sex come from the table title as published; a title the builder
does not recognise stops the build.

  python3 -I -B scripts/api_econ/build_life_tables.py --acquire [--years 2024,2023]   download the workbooks (raw kept)
  python3 -I -B scripts/api_econ/build_life_tables.py [--years ...] [--out DIR]        build from the downloaded files

NCHS data are U.S. government works (public domain); NCHS asks for citation of the report.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

DATASET = "econ_nchs_life_tables"
PAGE = "https://www.cdc.gov/nchs/products/life_tables.htm"
FTP = "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/NVSR"
# report year -> (NVSR volume-number, number of tables, report PDF, file-name case)
REPORTS = {
    2024: ("75-05", 18, "https://www.cdc.gov/nchs/data/nvsr/nvsr75/nvsr75-05.pdf", "Table{:02d}.xlsx"),
    2023: ("74-06", 18, "https://www.cdc.gov/nchs/data/nvsr/nvsr74/nvsr74-06.pdf", "Table{:02d}.xlsx"),
    2022: ("74-02", 18, "https://www.cdc.gov/nchs/data/nvsr/nvsr74/nvsr74-02.pdf", "table{:02d}.xlsx"),
    2021: ("72-12", 18, "https://www.cdc.gov/nchs/data/nvsr/nvsr72/nvsr72-12.pdf", "Table{:02d}.xlsx"),
    2020: ("71-01", 18, "https://www.cdc.gov/nchs/data/nvsr/nvsr71/nvsr71-01.pdf", "table{:02d}.xlsx"),
    2019: ("70-19", 18, "https://www.cdc.gov/nchs/data/nvsr/nvsr70/nvsr70-19.pdf", "Table{:02d}.xlsx"),
    2018: ("69-12", 12, "https://www.cdc.gov/nchs/data/nvsr/nvsr69/nvsr69-12-508.pdf", "Table{:02d}.xlsx"),
}
COLUMNS = ["age", "qx", "lx", "dx", "Lx", "Tx", "ex"]
COLUMN_LABELS = {
    "qx": "Probability of dying between ages x and x + 1",
    "lx": "Number surviving to age x (of 100,000 born alive)",
    "dx": "Number dying between ages x and x + 1",
    "Lx": "Person-years lived between ages x and x + 1",
    "Tx": "Total person-years lived above age x",
    "ex": "Expectation of life at age x",
}
GROUP_LABELS = {
    "total": "Total population",
    "hispanic": "Hispanic",
    "nh_white": "Non-Hispanic White",
    "nh_black": "Non-Hispanic Black",
    "nh_asian": "Non-Hispanic Asian",
    "nh_aian": "Non-Hispanic American Indian and Alaska Native",
}
SEX_LABELS = {"total": "Both sexes", "male": "Male", "female": "Female"}

_RACES = [("nh_aian", r"american indian"), ("nh_asian", r"\basian\b"), ("nh_black", r"\bblack\b"), ("nh_white", r"\bwhite\b")]


def classify(title: str) -> tuple[str, str]:
    """(group, sex) from a published table title, e.g. 'Table 8. Life table for American Indian and Alaska Native,
    non-Hispanic males: United States, 2024' -> ('nh_aian', 'male')."""
    t = re.sub(r"\s+", " ", title.lower())
    if "life table" not in t:
        raise ValueError(f"not a life table title: {title!r}")
    head = t.split(":")[0]
    sex = "female" if re.search(r"\bfemales?\b", head) else "male" if re.search(r"\bmales?\b", head) else "total"
    races = [g for g, pat in _RACES if re.search(pat, head)]
    non_hispanic = bool(re.search(r"non-?hispanic", head))
    if len(races) > 1:
        raise ValueError(f"more than one race group in title: {title!r}")
    if races:
        if not non_hispanic:
            raise ValueError(f"race group without non-Hispanic origin in title: {title!r}")
        return races[0], sex
    if non_hispanic:
        raise ValueError(f"non-Hispanic title without a race group: {title!r}")
    if "hispanic" in head:
        return "hispanic", sex
    if re.search(r"total population|for (fe)?males\b", head):
        return "total", sex
    raise ValueError(f"unrecognised group in title: {title!r}")


def file_url(year: int, n: int) -> str:
    vol, _, _, pattern = REPORTS[year]
    return f"{FTP}/{vol}/{pattern.format(n)}"


def raw_path(year: int, n: int) -> Path:
    return ec.ACQ / "nchs" / REPORTS[year][0] / f"Table{n:02d}.xlsx"


def acquire(years: list[int]) -> None:
    http = ec.Http(min_interval=1.0)
    manifest = ec.ACQ / "nchs" / "_manifest.jsonl"
    for y in years:
        for n in range(1, REPORTS[y][1] + 1):
            p = raw_path(y, n)
            if p.exists():
                continue
            body = http.get(file_url(y, n))
            ec.save_raw(p, body, file_url(y, n), manifest)
    print(json.dumps({"downloaded": len(http.requests)}))


def parse_table(path: Path) -> tuple[str, list[list[str]]]:
    cells = ec.read_xlsx(path)
    title = next((r[0] for r in cells if r and r[0] and re.match(r"(?i)table \d+\.? ", r[0].strip())), None)
    if not title:
        raise ValueError(f"{path}: no table title")
    rows = []
    for r in cells:
        if not r or not r[0]:
            continue
        # workbooks write the interval with an en dash or a figure dash ("0–1", "0‒1"); stored with a hyphen
        # and the 2021 workbooks write the open interval "100 and older"; both are stored in one form ("100 and over")
        age = re.sub(r"\s+", " ", re.sub("[\u2010-\u2015\u2212]", "-", r[0].strip())).replace(" and older", " and over")
        if not re.fullmatch(r"\d{1,3}-\d{1,3}|\d{1,3} and over", age):
            continue
        vals = (r + [None] * 7)[1:7]
        if any(v is None or not re.fullmatch(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", v.strip()) for v in vals):
            raise ValueError(f"{path}: age {age} has a non-numeric cell")
        rows.append([age, *[v.strip() for v in vals]])
    ages = [r[0] for r in rows]
    if ages[0] != "0-1" or not ages[-1].endswith("and over") or len(ages) != len(set(ages)):
        raise ValueError(f"{path}: unexpected age rows {ages[:2]}…{ages[-2:]}")
    for i, a in enumerate(ages[:-1]):
        if a != f"{i}-{i + 1}":
            raise ValueError(f"{path}: age rows are not consecutive single years at {a}")
    return re.sub(r"\s+", " ", title.strip()), rows


def ex_display(v: str) -> str:
    """e(x) to one decimal place, as the NVSR report tables print it."""
    from decimal import ROUND_HALF_UP, Decimal
    return str(Decimal(v).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def build_rows(years: list[int]) -> tuple[list[dict], list[dict]]:
    rows, inputs = [], []
    manifest = {}
    mpath = ec.ACQ / "nchs" / "_manifest.jsonl"
    if mpath.exists():
        for line in mpath.read_text().splitlines():
            e = json.loads(line)
            manifest[e["path"]] = e
    for y in sorted(years, reverse=True):
        vol, count, pdf, _ = REPORTS[y]
        seen = set()
        for n in range(1, count + 1):
            p = raw_path(y, n)
            title, table = parse_table(p)
            group, sex = classify(title)
            if (group, sex) in seen:
                raise ValueError(f"{p}: two tables for {group}/{sex}")
            seen.add((group, sex))
            if not re.search(rf"\b{y}\b", title):
                raise ValueError(f"{p}: title does not name {y}: {title}")
            entry = manifest.get(str(p.relative_to(ec.ROOT)))
            if entry:
                inputs.append({"url": entry["url"], "path": entry["path"], "sha256": entry["sha256"]})
            url = file_url(y, n)
            e0 = table[0][6]
            rid = f"nchs-lt:{y}:{n:02d}"
            label = f"{GROUP_LABELS[group]}, {SEX_LABELS[sex].lower()}"
            name = f"United States life table, {y}: {label}"
            facts = [
                ["Table (as published)", title],
                ["Report", f"United States Life Tables, {y}. National Vital Statistics Reports, Volume {int(vol.split('-')[0])}, Number {int(vol.split('-')[1])}"],
                ["Group", GROUP_LABELS[group]],
                ["Sex", SEX_LABELS[sex]],
                ["Life expectancy at birth", f"{ex_display(e0)} years (workbook value {e0})"],
                ["Ages", f"{table[0][0]} to {table[-1][0]} ({len(table)} rows)"],
                ["Columns", "; ".join(f"{k}: {COLUMN_LABELS[k]}" for k in COLUMNS[1:])],
                ["Values", "Exactly as stored in the NCHS workbook (age labels stored in one form: 0-1 with a hyphen, 100 and over); the report prints e(x) to one decimal place."],
                ["Source file", url],
            ]
            rows.append(ec.record(
                DATASET, rid, name, source_url=url,
                subtitle=f"NVSR {vol} · Table {n} · life expectancy at birth {ex_display(e0)} years",
                cells={"year": str(y), "table": str(n), "group": GROUP_LABELS[group], "sex": SEX_LABELS[sex],
                       "e0": ex_display(e0), "report": f"NVSR {vol}"},
                facts=facts,
                text=f"life table life expectancy {title} {GROUP_LABELS[group]} {SEX_LABELS[sex]} {y}",
                filters={"year": [str(y)], "group": [group], "sex": [sex]},
                links=[{"url": pdf, "label": f"Report (NVSR {vol}, PDF)"}, {"url": url, "label": f"Table {n} workbook"},
                       {"url": PAGE, "label": "NCHS life tables"}],
                extra={"kind": "life_table", "lifetable": {
                    "year": y, "report": f"NVSR {vol}", "report_url": pdf, "table": n, "title": title,
                    "group": group, "sex": sex, "columns": COLUMNS, "rows": table, "source_url": url}},
            ))
    return rows, inputs


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acquire", action="store_true")
    ap.add_argument("--years", default=",".join(str(y) for y in REPORTS))
    ap.add_argument("--out", default=str(ec.BUILD / "nchs"))
    a = ap.parse_args(argv)
    years = [int(y) for y in a.years.split(",") if y]
    if a.acquire:
        acquire(years)
        return
    rows, inputs = build_rows(years)
    verification = None
    vpath = ec.BUILD / "nchs" / "verify_life_tables.json"
    if vpath.exists():
        v = json.loads(vpath.read_text())
        verification = {
            "method": "Every age row of every table, rounded as the report prints it (q(x) six decimals; l(x), d(x), L(x), T(x) whole numbers; e(x) one decimal), compared with the report PDF text (scripts/api_econ/verify_life_tables.py).",
            "tables": v["tables"], "rows_checked": v["checked_rows"],
            "differences": [{k: m[k] for k in ("year", "table", "age", "columns_differing", "workbook_rounded", "pdf")} for m in v["mismatches"]],
            "format_only": len(v.get("format_only", [])), "report_pdfs": v["pdfs"]}
    groups = {k: v for k, v in GROUP_LABELS.items() if any(r["filters"]["group"] == [k] for r in rows)}
    ec.write_build(
        Path(a.out), DATASET,
        "United States life tables (NCHS): complete period life tables by age, sex, race and Hispanic origin",
        ec.listing([("year", "Year"), ("group", "Group"), ("sex", "Sex"), ("e0", "Life expectancy at birth"),
                    ("report", "Report")],
                   [("year", "Year", {str(y): str(y) for y in sorted(years, reverse=True)}),
                    ("group", "Group", groups), ("sex", "Sex", SEX_LABELS)]),
        {"source": PAGE, "method": "NCHS XLSX workbooks read cell by cell (values as stored); one row per report year and table.",
         "terms": "NCHS publications and data are U.S. government works in the public domain; cite the report (National Vital Statistics Reports).",
         "years": sorted(years), "tables": len(rows), "verification": verification,
         "caveats": ["Period life tables: they describe the mortality of the year named, not the future mortality of a person.",
                     "Race and Hispanic-origin groups are those NCHS published for the year; earlier reports have fewer groups.",
                     "The 2020 and 2021 tables reflect COVID-19 mortality in those years."]},
        rows, inputs)


if __name__ == "__main__":
    main(sys.argv[1:])
