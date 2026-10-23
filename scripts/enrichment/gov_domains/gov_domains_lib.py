"""Pure parsing and record assembly for the `gov_domains` and `gov_domains_summary` datasets.

Two official registries, kept side by side (never merged into one opinion):

  cisa  CISA / .gov registry, github.com/cisagov/dotgov-data: current-full.csv and current-federal.csv list every domain
        registered in the .gov zone (Domain name, Domain type, Organization name, Suborganization name, City, State,
        Security contact email). gov.txt is the zone export the lists are checked against.
  gsa   GSA, github.com/GSA/govt-urls: government domains that do NOT end in .gov or .mil. 1_govt_urls_full.csv is the full
        list; 2..8 are per-level views with their own columns (Status, Level of Government, Location); 9 lists domains
        out of use and creates no record of its own.

Rules: values are kept as published; an unknown value is None ("Not recorded"), never a guess. A state is a USPS code only
when the publisher's own state field is exactly a state/territory name or code. The Security contact email is reduced to
whether the registry publishes one (the raw file keeps the address). Nothing here touches the network or the disk.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Iterable

DATASET = "gov_domains"
SUMMARY_DATASET = "gov_domains_summary"

# ----------------------------------------------------------------------------------------------------- vocabulary
CISA_LISTS = {"current-full.csv": "cisa_current_full", "current-federal.csv": "cisa_current_federal"}
GSA_LISTS = {
    "1_govt_urls_full.csv": "gsa_full",
    "2_govt_urls_federal_only.csv": "gsa_federal",
    "3_govt_urls_state_only.csv": "gsa_state",
    "4_govt_urls_regional_only.csv": "gsa_regional",
    "5_govt_urls_county_only.csv": "gsa_county",
    "6_govt_urls_local_only.csv": "gsa_local",
    "7_govt_urls_native_sovereign_nations_only.csv": "gsa_native_sovereign_nations",
    "8_govt_urls_quasigovernmental_only.csv": "gsa_quasigovernmental",
}
GSA_NOT_USED_FILE = "9_govt_urls_not_used.csv"
LIST_LABELS = {
    "cisa_current_full": "CISA .gov registry: current-full.csv",
    "cisa_current_federal": "CISA .gov registry: current-federal.csv",
    "gsa_full": "GSA government URLs: full list",
    "gsa_federal": "GSA government URLs: federal only",
    "gsa_state": "GSA government URLs: state only",
    "gsa_regional": "GSA government URLs: regional only",
    "gsa_county": "GSA government URLs: county only",
    "gsa_local": "GSA government URLs: local only",
    "gsa_native_sovereign_nations": "GSA government URLs: native sovereign nations only",
    "gsa_quasigovernmental": "GSA government URLs: quasigovernmental only",
}

# group id -> label shown in the app. A group is derived only from the published type string (tables below).
GROUPS = {
    "state": "State or territory",
    "county": "County",
    "city": "City or local",
    "special_district": "Special district",
    "school_district": "School district",
    "tribal": "Tribal (native sovereign nation)",
    "interstate": "Interstate",
    "regional": "Regional",
    "federal": "Federal",
    "quasi": "Quasigovernmental",
    "unclear": "Level unclear",
}
CISA_TYPE_GROUP = {
    "Federal": "federal",
    "Federal - Executive": "federal",
    "Federal - Legislative": "federal",
    "Federal - Judicial": "federal",
    "State or territory": "state",
    "State or territory - Election": "state",
    "County": "county",
    "County - Election": "county",
    "City": "city",
    "City - Election": "city",
    "Special district": "special_district",
    "Special district - Election": "special_district",
    "School district": "school_district",
    "Tribal": "tribal",
    "Tribal - Election": "tribal",
    "Interstate": "interstate",
}
GSA_TYPE_GROUP = {
    "Federal": "federal",
    "State": "state",
    "County": "county",
    "Local": "city",
    "Regional": "regional",
    "Native Sovereign Nation / Tribal": "tribal",
    "Quasigovernmental": "quasi",
    "Level unclear, see note": "unclear",
}
GSA_LEVEL_GROUP = {
    "Federal Government": "federal",
    "State Government": "state",
    "County Government": "county",
    "Local Government": "city",
    "Regional": "regional",
    "Native Sovereign Nation": "tribal",
    "Quasigovernmental": "quasi",
}

STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
    "connecticut": "CT", "delaware": "DE", "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    # territories the CISA registry also uses as USPS codes
    "american samoa": "AS", "guam": "GU", "northern mariana islands": "MP", "puerto rico": "PR", "virgin islands": "VI",
}
USPS_CODES = frozenset(STATE_NAMES.values())

# --------------------------------------------------------------------------------------------------------- csv
def read_csv(raw: bytes) -> list[dict[str, str]]:
    """Rows of a published CSV as dicts of strings. A UTF-8 byte-order mark is dropped; nothing else is altered."""
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    rows = []
    for row in reader:
        rows.append({k: (v if v is not None else "") for k, v in row.items() if k is not None})
    return rows


def clean(value: str | None) -> str | None:
    """Surrounding whitespace removed; empty or the spreadsheet error `#N/A` becomes None (Not recorded). Any other text,
    including a literal "NA", is a published value and is kept."""
    if value is None:
        return None
    text = value.strip()
    if not text or text == "#N/A":
        return None
    return text


# ------------------------------------------------------------------------------------------------------- entries
IPV4 = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


def normalize_entry(raw: str | None) -> dict | None:
    """One published domain entry -> id/host/path. The host is lower-cased; a path (GSA lists a few hundred pages on
    shared hosts, such as `360eldorado.com/Government`) keeps its published case in `path` and is lower-cased in the id."""
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    host, sep, rest = text.partition("/")
    host = host.strip().lower()
    path = rest.strip().strip("/") if sep else ""
    if not host:
        return None
    entry = host + ("/" + path.lower() if path else "")
    return {
        "id": entry,
        "host": host,
        "path": path or None,
        "host_kind": "ip" if IPV4.match(host) else "domain",
        "tld": host.rsplit(".", 1)[-1] if "." in host else None,
        "published_as": text if text != entry else None,
    }


def state_codes(value: str | None) -> tuple[list[str], str | None]:
    """(USPS codes, unresolved text). Only the publisher's exact state/territory names or exact USPS codes resolve; a
    comma-separated list resolves when every part does. Anything else (a country, free text) returns ([], text)."""
    text = clean(value)
    if text is None:
        return [], None
    parts = [p.strip() for p in text.split(",")]
    codes: list[str] = []
    for part in parts:
        low = part.lower()
        if low in STATE_NAMES:
            code = STATE_NAMES[low]
        elif part in USPS_CODES:
            code = part
        else:
            return [], text
        if code not in codes:
            codes.append(code)
    return codes, None


DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})(?:\s+\d{1,2}:\d{2})?$")


def iso_date(value: str | None) -> str | None:
    """YYYY-MM-DD from `m/d/yy[ h:mm]` or `m/d/yyyy`; a two-digit year is 20yy. None when the text is anything else."""
    text = clean(value)
    m = DATE.match(text) if text else None
    if not m:
        return None
    month, day, year = int(m.group(1)), int(m.group(2)), m.group(3)
    year_n = int(year) if len(year) == 4 else 2000 + int(year)
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year_n:04d}-{month:02d}-{day:02d}"


NOTE_ADDED = re.compile(r"\s*--\s*Note added\s+(\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2})\s*$")


def split_note(comment: str | None) -> tuple[str | None, str | None]:
    """(note text, note-added stamp). GSA appends ` -- Note added m/d/yy h:mm` to most comments; the raw comment is kept
    beside this split by the caller."""
    text = clean(comment)
    if text is None:
        return None, None
    m = NOTE_ADDED.search(text)
    if not m:
        return text, None
    return (text[: m.start()].strip() or None), m.group(1)


def http_link(value: str | None) -> tuple[str | None, str | None]:
    """(link, rejected text): only an http(s) address is a link; anything else the publisher typed is returned as rejected."""
    text = clean(value)
    if text is None:
        return None, None
    return (text, None) if re.match(r"^https?://\S+$", text) else (None, text)


# ------------------------------------------------------------------------------------------------ source parsing
def cisa_zone_domains(zone_text: str) -> set[str]:
    """Second-level names that have NS records in the exported .gov zone file."""
    names: set[str] = set()
    for line in zone_text.splitlines():
        if not line or line.startswith(";"):
            continue
        parts = line.split("\t")
        if len(parts) >= 5 and parts[2] == "IN" and parts[3] == "NS":
            name = parts[0].rstrip(".").lower()
            if name.endswith(".gov") and name.count(".") == 1:
                names.add(name)
    return names


def zone_export_stamp(zone_text: str) -> str | None:
    m = re.search(r"^;; Exported:\s+(.+)$", zone_text, re.M)
    return m.group(1).strip() if m else None


def parse_cisa(rows: Iterable[dict[str, str]], zone: set[str] | None) -> dict[str, dict]:
    """id -> CISA facts for one list file (duplicate domains in a file are an error: the registry is one row per domain)."""
    out: dict[str, dict] = {}
    for row in rows:
        entry = normalize_entry(row.get("Domain name"))
        if entry is None:
            raise ValueError("CISA row without a domain name")
        if entry["id"] in out:
            raise ValueError(f"duplicate CISA domain {entry['id']}")
        codes, unresolved = state_codes(row.get("State"))
        dtype = clean(row.get("Domain type"))
        contact = clean(row.get("Security contact email"))
        out[entry["id"]] = {
            "entry": entry,
            "type": dtype,
            "group": CISA_TYPE_GROUP.get(dtype) if dtype else None,
            "organization": clean(row.get("Organization name")),
            "suborganization": clean(row.get("Suborganization name")),
            "city": clean(row.get("City")),
            "state": codes[0] if len(codes) == 1 else None,
            "state_unresolved": unresolved,
            # the registry publishes "(blank)" when no security contact is on file; the address itself is not kept
            "security_contact": "published" if contact and contact != "(blank)" else "not_published",
            "in_zone": None if zone is None else entry["id"] in zone,
        }
    return out


def gsa_full_row(row: dict[str, str]) -> dict:
    codes, unresolved = state_codes(row.get("State"))
    note, note_added = split_note(row.get("Comments"))
    link, link_rejected = http_link(row.get("Link"))
    dtype = clean(row.get("Type of government"))
    return {
        "type": dtype,
        "group": GSA_TYPE_GROUP.get(dtype) if dtype else None,
        "agency": clean(row.get("Agency")),
        "maintaining_office": clean(row.get("Maintaining office")),
        "use_case": clean(row.get("Use case")),
        "federal_branch": clean(row.get("Federal branch")),
        "state_as_published": clean(row.get("State")),
        "states": codes,
        "state_unresolved": unresolved,
        "comments": clean(row.get("Comments")),
        "note": note,
        "note_added": note_added,
        "link": link,
        "link_rejected": link_rejected,
        "date_added": clean(row.get("Date Added")),
        "date_added_iso": iso_date(row.get("Date Added")),
    }


def parse_gsa_full(rows: Iterable[dict[str, str]]) -> dict[str, list[dict]]:
    """id -> every row the full list gives for it, in file order (a few domains appear twice with different wording)."""
    out: dict[str, list[dict]] = {}
    for row in rows:
        entry = normalize_entry(row.get("Domain name"))
        if entry is None:
            raise ValueError("GSA full-list row without a domain")
        out.setdefault(entry["id"], []).append({"entry": entry, **gsa_full_row(row)})
    return out


def parse_gsa_view(rows: Iterable[dict[str, str]]) -> dict[str, list[dict]]:
    """id -> rows of one per-level view file (columns Domain, Federal Agency, Level of Government, Location, Status, Note,
    Link, Date Added)."""
    out: dict[str, list[dict]] = {}
    for row in rows:
        entry = normalize_entry(row.get("Domain"))
        if entry is None:
            continue
        codes, unresolved = state_codes(row.get("Location"))
        note, note_added = split_note(row.get("Note"))
        link, link_rejected = http_link(row.get("Link"))
        level = clean(row.get("Level of Government"))
        out.setdefault(entry["id"], []).append(
            {
                "entry": entry,
                "federal_agency": clean(row.get("Federal Agency")),
                "level_of_government": level,
                "group": GSA_LEVEL_GROUP.get(level) if level else None,
                "location_as_published": clean(row.get("Location")),
                "states": codes,
                "state_unresolved": unresolved,
                "status": clean(row.get("Status")),
                "note_as_published": clean(row.get("Note")),
                "note": note,
                "link": link,
                "link_rejected": link_rejected,
                "date_added": clean(row.get("Date Added")),
                "date_added_iso": iso_date(row.get("Date Added")),
            }
        )
    return out


def parse_gsa_not_used(rows: Iterable[dict[str, str]]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for row in rows:
        entry = normalize_entry(row.get("Domain"))
        if entry is None:
            continue
        out.setdefault(
            entry["id"],
            {
                "status": clean(row.get("Status")),
                "level_of_government": clean(row.get("Level of Government")),
                "note": clean(row.get("Note")),
            },
        )
    return out


# --------------------------------------------------------------------------------------------------- assembly
def assemble(
    cisa: dict[str, dict[str, dict]],
    gsa_full: dict[str, list[dict]],
    gsa_views: dict[str, dict[str, list[dict]]],
    gsa_not_used: dict[str, dict],
) -> dict[str, dict]:
    """Merge the sources into one structured record per domain entry.

    cisa      {list_key: {id: facts}}                 (cisa_current_full, cisa_current_federal)
    gsa_full  {id: [rows]}
    gsa_views {list_key: {id: [rows]}}                (gsa_federal ... gsa_quasigovernmental)
    A record keeps both registries' fields separately; the top-level group/state/organization follow the CISA registry when
    it lists the domain and otherwise the GSA rows, and any disagreement is listed in `conflicts` instead of being resolved.
    """
    ids: dict[str, dict] = {}
    for per_list in cisa.values():
        for rid, facts in per_list.items():
            ids.setdefault(rid, facts["entry"])
    for rid, rows in gsa_full.items():
        ids.setdefault(rid, rows[0]["entry"])
    for per_list in gsa_views.values():
        for rid, rows in per_list.items():
            ids.setdefault(rid, rows[0]["entry"])

    records: dict[str, dict] = {}
    for rid in sorted(ids):
        entry = ids[rid]
        lists: list[str] = []
        cisa_facts = None
        for key in ("cisa_current_full", "cisa_current_federal"):
            if rid in cisa.get(key, {}):
                lists.append(key)
                cisa_facts = cisa_facts or cisa[key][rid]
        full_rows = gsa_full.get(rid, [])
        if full_rows:
            lists.append("gsa_full")
        views: dict[str, list[dict]] = {}
        for key in GSA_LISTS.values():
            if key == "gsa_full":
                continue
            if rid in gsa_views.get(key, {}):
                lists.append(key)
                views[key] = [{k: v for k, v in r.items() if k != "entry"} for r in gsa_views[key][rid]]
        registries = (["cisa"] if cisa_facts else []) + (["gsa"] if (full_rows or views) else [])

        gsa_states: list[str] = []
        gsa_groups: list[str] = []
        for r in full_rows:
            gsa_states += [s for s in r["states"] if s not in gsa_states]
            if r["group"] and r["group"] not in gsa_groups:
                gsa_groups.append(r["group"])
        if not full_rows:
            for rows in views.values():
                for r in rows:
                    gsa_states += [s for s in r["states"] if s not in gsa_states]
                    if r["group"] and r["group"] not in gsa_groups:
                        gsa_groups.append(r["group"])

        conflicts: list[dict] = []
        if cisa_facts:
            group = cisa_facts["group"]
            # the registrar's state wins when it gives one; a blank there is not a conflict, so the GSA state stands
            states = [cisa_facts["state"]] if cisa_facts["state"] else list(gsa_states)
            if cisa_facts["state"] and gsa_states and cisa_facts["state"] not in gsa_states:
                conflicts.append({"field": "state", "cisa": cisa_facts["state"], "gsa": gsa_states})
            if group and gsa_groups and group not in gsa_groups:
                conflicts.append({"field": "group", "cisa": group, "gsa": gsa_groups})
            organization = cisa_facts["organization"]
            city = cisa_facts["city"]
        else:
            group = gsa_groups[0] if len(gsa_groups) == 1 else None
            states = gsa_states
            if len(gsa_groups) > 1:
                conflicts.append({"field": "group", "gsa": gsa_groups})
            agencies = []
            for r in full_rows:
                if r["agency"] and r["agency"] not in agencies:
                    agencies.append(r["agency"])
            organization = agencies[0] if len(agencies) == 1 else None
            city = None

        records[rid] = {
            "entry": entry,
            "registries": registries,
            "lists": lists,
            "group": group,
            "states": states,
            "state": states[0] if len(states) == 1 else None,
            "organization": organization,
            "city": city,
            "cisa": ({k: v for k, v in cisa_facts.items() if k != "entry"} if cisa_facts else None),
            "gsa": (
                {"rows": [{k: v for k, v in r.items() if k != "entry"} for r in full_rows], "views": views}
                if (full_rows or views)
                else None
            ),
            # GSA's list of domains out of use: it never creates a record, but a listed domain that is also named there says so
            "not_used": gsa_not_used.get(rid),
            "conflicts": conflicts,
        }
    return records


def summarize(records: dict[str, dict]) -> dict:
    """Deterministic counts over assembled records: totals, per registry/list/group/published type, and per state."""
    out: dict = {
        "records": len(records),
        "registries": {"cisa": 0, "gsa": 0, "both": 0},
        "lists": {},
        "groups": {},
        "cisa_types": {},
        "gsa_types": {},
        "with_state": 0,
        "without_state": 0,
        "conflicts": 0,
        "path_entries": 0,
        "states": {},
    }
    for rec in records.values():
        regs = rec["registries"]
        for r in regs:
            out["registries"][r] += 1
        if len(regs) == 2:
            out["registries"]["both"] += 1
        for key in rec["lists"]:
            out["lists"][key] = out["lists"].get(key, 0) + 1
        gkey = rec["group"] or "unassigned"
        out["groups"][gkey] = out["groups"].get(gkey, 0) + 1
        if rec["cisa"] and rec["cisa"]["type"]:
            out["cisa_types"][rec["cisa"]["type"]] = out["cisa_types"].get(rec["cisa"]["type"], 0) + 1
        if rec["gsa"]:
            seen = {r["type"] for r in rec["gsa"]["rows"] if r["type"]}
            if not rec["gsa"]["rows"]:
                seen = {r["level_of_government"] for rows in rec["gsa"]["views"].values() for r in rows if r["level_of_government"]}
            for t in sorted(seen):
                out["gsa_types"][t] = out["gsa_types"].get(t, 0) + 1
        if rec["states"]:
            out["with_state"] += 1
        else:
            out["without_state"] += 1
        if rec["conflicts"]:
            out["conflicts"] += 1
        if rec["entry"]["path"]:
            out["path_entries"] += 1
        for st in rec["states"]:
            slot = out["states"].setdefault(st, {"total": 0, "cisa": 0, "gsa": 0, "groups": {}, "cisa_types": {}})
            slot["total"] += 1
            for r in regs:
                slot[r] += 1
            slot["groups"][gkey] = slot["groups"].get(gkey, 0) + 1
            if rec["cisa"] and rec["cisa"]["type"]:
                t = rec["cisa"]["type"]
                slot["cisa_types"][t] = slot["cisa_types"].get(t, 0) + 1
    return out
