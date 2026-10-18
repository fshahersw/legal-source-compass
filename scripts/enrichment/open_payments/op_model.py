"""Load the raw Open Payments acquisitions into one per-entity / per-year model (no network)."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "open-payments")
API = os.path.join(ACQ, "api")

API_YEARS = ["2019", "2020", "2021", "2022", "2023", "2024", "2025"]
ARCHIVE_YEARS = ["2017", "2018"]
YEARS = ARCHIVE_YEARS + API_YEARS


def money(value):
    """Parse a CMS dollar string; None when it is not a number (never guessed)."""
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if text == "":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def count(value):
    amount = money(value)
    return None if amount is None else int(round(amount))


def load_api(name):
    path = os.path.join(API, f"{name}.json")
    return json.load(open(path))


def load_archive(year):
    return json.load(open(os.path.join(ACQ, f"archive_{year}.json")))


def load_detail(year):
    """Local aggregate of the official detail-file zip for any program year (archive_ or detail_ file)."""
    name = f"archive_{year}.json" if year in ARCHIVE_YEARS else f"detail_{year}.json"
    return json.load(open(os.path.join(ACQ, name)))


def entity_years():
    """{entity_id: {year: {general, generalRecords, research, researchRecords, source}}} plus entity names."""
    out, names = {}, {}
    raw = load_api("by_entity")
    for row in raw["rows"]:
        eid = str(row.get("amgpo_making_payment_id") or "").strip()
        year = str(row.get("program_year") or "").strip()
        if not eid or year not in API_YEARS:
            continue
        general, research = money(row.get("total_amount_general")), money(row.get("total_amount_research"))
        if general is None or research is None:
            continue
        out.setdefault(eid, {})[year] = {
            "general": round(general, 2),
            "generalRecords": count(row.get("trans_general")),
            "research": round(research, 2),
            "researchRecords": count(row.get("trans_research")),
            "source": "summary",
        }
        names.setdefault(eid, {})[year] = {
            "name": (row.get("amgpo_making_payment_name") or "").strip(),
            "state": (row.get("amgpo_making_payment_state") or "").strip(),
            "country": (row.get("amgpo_making_payment_country") or "").strip(),
        }
    for year in ARCHIVE_YEARS:
        arc = load_archive(year)
        general = {r[0]: (r[1], r[2]) for r in arc["general_by_entity"]}
        research = {r[0]: (r[1], r[2]) for r in arc["research_by_entity"]}
        for eid in set(general) | set(research):
            g, r = general.get(eid, (0, 0)), research.get(eid, (0, 0))
            out.setdefault(eid, {})[year] = {
                "general": round(g[0] / 100, 2),
                "generalRecords": g[1],
                "research": round(r[0] / 100, 2),
                "researchRecords": r[1],
                "source": "archive",
            }
            names.setdefault(eid, {})[year] = arc["entities"].get(eid, {})
    return out, names


def ranked(limit=300):
    years, names = entity_years()
    totals = []
    for eid, by_year in years.items():
        general = sum(v["general"] for v in by_year.values())
        research = sum(v["research"] for v in by_year.values())
        totals.append((eid, general + research, general, research))
    totals.sort(key=lambda t: (-t[1], t[0]))
    return totals[:limit], years, names
