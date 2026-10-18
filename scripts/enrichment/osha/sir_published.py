"""Parse and cross-check the OSHA Severe Injury Report (SIR) figures saved in private/acq/osha/_pages/sir_published_tables_*.md.

The record-level SIR zip is not obtainable from this environment (osha.gov answers 403), so the only SIR figures in the build are
the aggregates OSHA published in its dashboard text and annual reports. Pure functions, no I/O except `load_sections`.
Every validator raises ValueError when a transcribed table disagrees with its own printed totals, so a copying error cannot
reach the build.
"""
import re

YEARS = tuple(range(2015, 2026))
STATE_YEARS = tuple(range(2015, 2022))
BODY_PARTS = ("Upper extremities", "Lower extremities", "Trunk", "Multiple body parts", "Head", "Body systems",
              "Other body parts", "Neck, including throat")


def number(text):
    """'1,058' -> 1058; '21.9' -> 21.9; '-', 'N/A', '' -> None (never 0)."""
    cleaned = (text or "").strip().replace(",", "")
    if cleaned in ("", "-", "N/A", "n/a"):
        return None
    try:
        value = float(cleaned)
    except ValueError:
        raise ValueError(f"not a number: {text!r}")
    return int(value) if value == int(value) and "." not in cleaned else value


def load_sections(text):
    """{section name: [row cells...]} for the '## SECTION name' blocks; only '| ... |' lines are rows and each section's first
    row is its header."""
    sections, current = {}, None
    for line in text.splitlines():
        match = re.match(r"^## SECTION (\w+)\s*$", line)
        if match:
            current = match.group(1)
            sections[current] = []
        elif current and line.startswith("|"):
            sections[current].append([cell.strip() for cell in line.strip().strip("|").split("|")])
    return {name: rows for name, rows in sections.items()}


def body(rows):
    """Data rows of a section (drops the header row)."""
    return rows[1:]


def parse_national(rows):
    out = []
    for cells in body(rows):
        year, amp, hosp, reports, eye = (number(c) for c in cells[:5])
        out.append({"year": year, "amputations": amp, "hospitalized": hosp, "reports": reports, "eye_losses": eye})
    out.sort(key=lambda r: r["year"])
    years = [r["year"] for r in out]
    if tuple(years) != YEARS:
        raise ValueError(f"national dashboard years {years}")
    for r in out:
        if r["reports"] > r["amputations"] + r["hospitalized"] + r["eye_losses"]:
            raise ValueError(f"{r['year']}: more reports than hospitalizations + amputations + eye losses")
    return out


def parse_text_facts(rows):
    return {cells[0]: number(cells[1]) for cells in body(rows)}


def parse_state_counts(rows, names_to_code):
    out = []
    for cells in body(rows):
        name = cells[0]
        code = names_to_code.get(name)
        if code is None:
            raise ValueError(f"unknown jurisdiction {name!r}")
        years = {y: number(c) for y, c in zip(STATE_YEARS, cells[1:8])}
        total = number(cells[8])
        if any(v is None for v in years.values()) or sum(years.values()) != total:
            raise ValueError(f"{name}: years sum {sum(v or 0 for v in years.values())} != printed total {total}")
        out.append({"code": code, "name": name, "by_year": years, "total": total, "rate": number(cells[9])})
    return out


def split_sector(label):
    """'31-33 Manufacturing' -> ('31-33', 'Manufacturing')."""
    match = re.match(r"^(\d{2}(?:-\d{2})?)\s+(.*)$", label.strip())
    if not match:
        raise ValueError(f"sector label {label!r}")
    return match.group(1), match.group(2)


def parse_sector_counts(rows):
    sectors, total = {}, None
    for cells in body(rows):
        values = [number(c) for c in cells[1:5]]
        if cells[0] == "Total":
            total = values
            continue
        code, title = split_sector(cells[0])
        sectors[code] = {"title": title, "hosp_avg_2015_2023": values[0], "hosp_2024": values[1], "amp_avg_2015_2023": values[2], "amp_2024": values[3]}
    if total is None:
        raise ValueError("sector counts: no Total row")
    # the printed 2015-2023 columns are rounded annual averages, so only the 2024 columns must add up exactly
    for index, key in ((1, "hosp_2024"), (3, "amp_2024")):
        if sum(s[key] for s in sectors.values()) != total[index]:
            raise ValueError(f"sector counts: {key} sums to {sum(s[key] for s in sectors.values())}, printed {total[index]}")
    return sectors, {"hosp_avg_2015_2023": total[0], "hosp_2024": total[1], "amp_avg_2015_2023": total[2], "amp_2024": total[3]}


def parse_sector_rates(rows):
    sectors, total = {}, None
    for cells in body(rows):
        values = [number(c) for c in cells[1:5]]
        if cells[0] == "TOTAL":
            total = values
            continue
        code, _ = split_sector(cells[0])
        sectors[code] = {"incidents_avg_2015_2023": values[0], "rate_avg_2015_2023": values[1], "incidents_2024": values[2], "rate_2024": values[3]}
    if total is None:
        raise ValueError("sector rates: no TOTAL row")
    return sectors, {"incidents_avg_2015_2023": total[0], "rate_avg_2015_2023": total[1], "incidents_2024": total[2], "rate_2024": total[3]}


def parse_body_parts(rows):
    header = rows[0]
    columns = tuple(header[2:10])
    if columns != BODY_PARTS:
        raise ValueError(f"body part columns {columns}")
    out = {}
    for cells in body(rows):
        values = [number(c) for c in cells[2:10]]
        total = number(cells[10])
        if sum(values) != total:
            raise ValueError(f"{cells[0]}: body parts sum {sum(values)} != printed total {total}")
        out[cells[1]] = {"label": cells[0], "parts": dict(zip(BODY_PARTS, values)), "total": total}
    return out


def validate(sections, names_to_code):
    """Parse everything and run the cross-checks; returns the parsed pieces."""
    national = parse_national(sections["national_dashboard"])
    states = parse_state_counts(sections["lookback_state_counts"], names_to_code)
    counts, count_total = parse_sector_counts(sections["annual_2024_sector_counts"])
    rates, rate_total = parse_sector_rates(sections["annual_2024_sector_rates"])
    parts = parse_body_parts(sections["lookback_body_parts"])
    lookback = parse_text_facts(sections["lookback_text_facts"])
    annual = parse_text_facts(sections["annual_2024_text_facts"])
    report_2223 = parse_text_facts(sections["report_2022_2023_text"])
    by_year = {r["year"]: r for r in national}
    # the 2024 dashboard figures agree with the 2024 annual report text
    if (by_year[2024]["reports"], by_year[2024]["hospitalized"], by_year[2024]["amputations"], by_year[2024]["eye_losses"]) != (
            annual["Total SIRs 2024"], annual["Inpatient hospitalizations 2024"], annual["Amputations 2024"], annual["Eye losses 2024"]):
        raise ValueError("2024 dashboard totals differ from the 2024 annual report text")
    # the 2022-2023 report's 19,690 (hospitalizations + amputations) equals the dashboard worker counts for those two years
    two_years = sum(by_year[y]["hospitalized"] + by_year[y]["amputations"] for y in (2022, 2023))
    if two_years != report_2223["Hospitalizations plus amputations 2022-2023"]:
        raise ValueError(f"2022-2023 dashboard hospitalizations + amputations {two_years} != 19,690 in the 2022-2023 report")
    if count_total["hosp_2024"] != annual["Inpatient hospitalizations 2024"] or count_total["amp_2024"] != annual["Amputations 2024"]:
        raise ValueError("2024 sector table totals differ from the annual report text")
    # the rate table's 'Number' is hospitalizations + amputations per sector (checked on every sector, both periods)
    for code, c in counts.items():
        r = rates.get(code)
        if r is None:
            raise ValueError(f"sector {code} missing from the rate table")
        if r["incidents_2024"] != c["hosp_2024"] + c["amp_2024"]:
            raise ValueError(f"sector {code}: 2024 number {r['incidents_2024']} != hospitalizations + amputations")
        # the 2015-2023 columns are annual averages OSHA rounded separately, so they may differ by one
        if abs(r["incidents_avg_2015_2023"] - (c["hosp_avg_2015_2023"] + c["amp_avg_2015_2023"])) > 1:
            raise ValueError(f"sector {code}: 2015-2023 number != hospitalizations + amputations")
    # the 2015-2021 body-part table's grand total reconciles with the lookback text (hospitalizations + amputations - overlap)
    grand = sum(p["total"] for p in parts.values())
    expected = lookback["Hospitalization SIRs 2015-2021"] + lookback["Amputation SIRs 2015-2021"] - lookback["Amputations also requiring hospitalization 2015-2021"]
    if grand != expected:
        raise ValueError(f"body-part table total {grand} != {expected} from the lookback text")
    if set(parts) != set(counts):
        raise ValueError("body-part sectors differ from the 2024 sector list")
    return {"national": national, "states": states, "sector_counts": counts, "sector_count_total": count_total, "sector_rates": rates,
            "sector_rate_total": rate_total, "body_parts": parts, "body_part_grand_total": grand, "lookback": lookback, "annual": annual}
