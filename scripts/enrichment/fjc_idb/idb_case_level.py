"""Pure projection of one FJC Integrated Database civil record (CourtListener's copy) into a corpus_records row.

Input rows are corpus_ingest.entities (source_system 'courtlistener', entity_type 'fjc-integrated-database'): CourtListener's
import of the FJC civil IDB, taken from fjc-integrated-database-2026-09-30.csv.bz2. CourtListener turns the IDB's -8
("missing") and blanks into null for integer, date and boolean fields (cl/recap/management/commands/import_idb.py,
normalize_nulls), so null here means "missing in the IDB" and is shown as "Not recorded".

Rules kept here (AGENTS.md):
* Codes are decoded only with the FJC civil codebook tables in idb_codes.py; a code that is not in the codebook table is shown as
  "Not recorded" with the raw code next to it, never guessed.
* The MDL docket number is an FJC IDB association, labelled "FJC IDB (historical)"; it is not current JPML membership.
* Plaintiff and defendant are shown exactly as the FJC recorded them (owner decision 2026-10-22 (3)); nothing is inferred about a
  person and no name is linked to a profile.
* Links are exact: the docket record only when cl_docket_metadata carries this exact FJC record id (idb_data_id), the MDL record
  only when fjc_civil_mdls has "mdl:<n>", the court page by the district's CourtListener court id as CourtListener recorded it.
* Status is the status in the FJC file CourtListener imported (dataset source), not today's status.

No network and no database access here, so the unit tests run anywhere.
"""
from __future__ import annotations

import idb_codes as ic

DATASET = "fjc_idb_civil_cases"
LABEL = "Federal civil cases carrying an MDL docket number - case-level FJC Integrated Database records (via CourtListener)"
NR = "Not recorded"
MDL_LABEL = "FJC IDB (historical)"
FJC_PAGE = "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"
CODEBOOK = "https://www.fjc.gov/sites/default/files/idb/codebooks/Civil%20Codebook%201988%20Forward%2010252023.pdf"
CL_DATASET_SOURCES = {
    # CourtListener cl/recap/constants.py DATASET_SOURCES (label as CourtListener gives it)
    "1": "Civil cases filed and terminated from SY 1970 through SY 1987",
    "2": "Civil cases filed, terminated, and pending from SY 1988 to present (2017)",
    "8": "Civil cases filed, terminated, and pending from SY 1988 to present (2020)",
    "9": "Civil cases filed, terminated, and pending from SY 1988 to present (September 2021)",
    "10": "Civil cases filed, terminated, and pending from SY 1988 to present (March 2022)",
}


def _s(v) -> str:
    """Source text, trimmed; None and blanks become ''."""
    return "" if v is None else str(v).strip()


def _int(v):
    s = _s(v)
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def decode(table: dict, raw) -> tuple[str, str]:
    """(label, raw code text) from a codebook table; a missing code or one outside the table is 'Not recorded'."""
    code = _int(raw)
    raw_text = _s(raw)
    if code is None or code not in table:
        return NR, raw_text
    v = table[code]
    return (v[0] if isinstance(v, tuple) else v), raw_text


def disposition_group(raw) -> str:
    code = _int(raw)
    return ic.DISPOSITION[code][1] if code in ic.DISPOSITION else NR


def thousands(raw) -> str:
    """IDB money fields are whole thousands of dollars as recorded; 9999 is the largest value the field holds."""
    v = _int(raw)
    if v is None:
        return NR
    text = f"{v:,} thousand dollars (as recorded)"
    return text + "; 9,999 is the field's largest value" if v == 9999 else text


def class_action(raw) -> str:
    # CourtListener stores CLASSACT as a boolean: "1" -> true, -8/blank -> null.
    if raw is True or _s(raw).lower() in ("t", "true", "1"):
        return "Yes (CLASSACT = 1)"
    if raw is False or _s(raw).lower() in ("f", "false"):
        return "No class action recorded"
    return NR


def status(data: dict) -> str:
    if _s(data.get("date_terminated")):
        return "terminated"
    return "pending"


def vintage_label(source: str, latest_filed: dict[str, str]) -> str:
    base = CL_DATASET_SOURCES.get(source)
    name = f"CourtListener dataset source {source}" + (f": {base}" if base else " (not in CourtListener's list)")
    last = latest_filed.get(source)
    return name + (f"; latest filing date in these records {last}" if last else "")


def project(row: dict, lookups: dict) -> dict:
    """corpus_records row for one corpus_ingest.entities row ({native_id, data, provenance, source_as_of, payload_sha256}).

    lookups: nos {code:int -> codebook label}, district_state {court_id -> USPS}, mdl_ids {"mdl:<n>"},
    docket_by_idb {fjc record id -> cl_docket_metadata record id}, latest_filed {dataset_source -> max date_filed}.
    """
    data = row["data"] or {}
    prov = row.get("provenance") or {}
    native = _s(row["native_id"])
    rid = f"idb:{native}"
    source_url = _s(prov.get("source_url"))
    source_as_of = _s(row.get("source_as_of") or prov.get("source_as_of"))
    court = _s(data.get("district_id"))
    circuit = _s(data.get("circuit_id"))
    docket = _s(data.get("docket_number"))
    plt = _s(data.get("plaintiff"))
    dfn = _s(data.get("defendant"))
    filed = _s(data.get("date_filed"))
    terminated = _s(data.get("date_terminated"))
    st = status(data)
    mdl_raw = _s(data.get("multidistrict_litigation_docket_number"))
    mdl_num = _int(mdl_raw)
    mdl_key = f"mdl:{mdl_num}" if mdl_num is not None else ""
    nos_code = _int(data.get("nature_of_suit"))
    nos_label = lookups["nos"].get(nos_code, NR) if nos_code is not None else NR
    origin, origin_raw = decode(ic.ORIGIN, data.get("origin"))
    juris, juris_raw = decode(ic.JURISDICTION, data.get("jurisdiction"))
    pro_se, pro_se_raw = decode(ic.PRO_SE, data.get("pro_se"))
    source = _s(data.get("dataset_source"))
    if st == "pending":
        disp = disp_raw = procprog = procprog_raw = noj = noj_raw = judg = judg_raw = ""
        disp_label = "Not terminated in this file"
        disp_grp = "Pending"
        procprog_label = noj_label = judg_label = "Not terminated in this file"
    else:
        disp_label, disp_raw = decode(ic.DISPOSITION, data.get("disposition"))
        disp_grp = disposition_group(data.get("disposition"))
        procprog_label, procprog_raw = decode(ic.PROCEDURAL_PROGRESS, data.get("procedural_progress"))
        noj_label, noj_raw = decode(ic.NATURE_OF_JUDGMENT, data.get("nature_of_judgement"))
        judg_label, judg_raw = decode(ic.JUDGMENT_FOR, data.get("judgment"))
    trclact_label, trclact_raw = decode(ic.CLASS_ACTION_TERMINATION, data.get("termination_class_action_status"))
    if not trclact_raw:
        trclact_label = NR
    demand = thousands(data.get("monetary_demand"))
    received = thousands(data.get("amount_received")) if st == "terminated" else "Not terminated in this file"
    cls = class_action(data.get("class_action"))
    transfer = {
        "date": _s(data.get("date_transfer")),
        "office": _s(data.get("transfer_office")),
        "docket": _s(data.get("transfer_docket_number")),
        "origin_code": _s(data.get("transfer_origin")),
    }
    has_transfer = any(transfer.values())
    docket_rec = lookups["docket_by_idb"].get(native)
    state = lookups["district_state"].get(court, "")
    vintage = vintage_label(source, lookups.get("latest_filed", {}))

    title = f"{plt or NR} v. {dfn or NR}"
    subtitle = " · ".join(p for p in [
        court or NR,
        f"IDB docket {docket}" if docket else "",
        f"filed {filed}" if filed else "",
        f"MDL {mdl_num}, {MDL_LABEL}" if mdl_num is not None else "",
        "pending in this file" if st == "pending" else f"terminated {terminated}",
    ] if p)
    links = []
    if docket_rec:
        links.append({"url": f"/records/cl_docket_metadata/{docket_rec}", "label": "Docket record (exact FJC record id)"})
        cl_native = docket_rec.rsplit(":", 1)[-1]
        if cl_native.isdigit():
            links.append({"url": f"https://www.courtlistener.com/docket/{cl_native}/", "label": "CourtListener docket"})
    if mdl_key and mdl_key in lookups["mdl_ids"]:
        links.append({"url": f"/records/fjc_civil_mdls/{mdl_key}", "label": f"MDL {mdl_num} in the FJC IDB ({MDL_LABEL})"})
    if court:
        links.append({"url": f"/courts/{court}", "label": "Court profile"})
    links += [
        {"url": FJC_PAGE, "label": "FJC Integrated Database, civil (publisher)"},
        {"url": CODEBOOK, "label": "IDB civil codebook"},
    ]
    if source_url:
        links.append({"url": source_url, "label": "CourtListener bulk file (source copy)"})

    cells = {
        "plaintiff": plt or NR,
        "defendant": dfn or NR,
        "court_id": court or NR,
        "docket": docket or NR,
        "filed": filed or NR,
        "terminated": terminated or ("Pending in this file" if st == "pending" else NR),
        "mdl": mdl_num,
        "nos": f"{nos_code} {nos_label}" if nos_code is not None else NR,
        "origin": origin,
        "disposition": disp_label,
        "judgment_for": judg_label,
        "amount_received": received,
        "class_action": cls,
        "linked_docket": docket_rec or "",
    }
    facts = [
        ["Plaintiff (as recorded by the FJC)", plt or NR],
        ["Defendant (as recorded by the FJC)", dfn or NR],
        ["District court (CourtListener court id)", court or NR],
        ["Circuit (CourtListener court id)", circuit or NR],
        ["Office code / IDB docket number", f"{_s(data.get('office')) or NR} / {docket or NR}"],
        ["Filed", filed or NR],
        ["Terminated", terminated or ("Pending in this file" if st == "pending" else NR)],
        ["MDL docket number", f"{mdl_num} ({MDL_LABEL}; an IDB association, not current JPML membership)" if mdl_num is not None else NR],
        ["Nature of suit", f"{nos_code} {nos_label}" if nos_code is not None else NR],
        ["Origin", f"{origin} (code {origin_raw})" if origin_raw else NR],
        ["Jurisdiction", f"{juris} (code {juris_raw})" if juris_raw else NR],
        ["Statute cited (title / section / subsection, as recorded)", " / ".join(_s(data.get(k)) or NR for k in ("title", "section", "subsection"))],
        ["Class action alleged", cls],
        ["Class action status at termination", f"{trclact_label} (code {trclact_raw})" if trclact_raw else NR],
        ["Pro se", f"{pro_se} (code {pro_se_raw})" if pro_se_raw else NR],
        ["Monetary demand", demand],
        ["Disposition", f"{disp_label} (code {disp_raw})" if disp_raw else disp_label],
        ["Disposition group", disp_grp],
        ["Procedural progress at termination", f"{procprog_label} (code {procprog_raw})" if procprog_raw else procprog_label],
        ["Nature of judgment", f"{noj_label} (code {noj_raw})" if noj_raw else noj_label],
        ["Judgment for", f"{judg_label} (code {judg_raw})" if judg_raw else judg_label],
        ["Amount received", received],
        ["Arbitration at filing (code as recorded)", _s(data.get("arbitration_at_filing")) or NR],
        ["Transfer date / office / docket / origin code (as recorded)",
         " / ".join(transfer[k] or NR for k in ("date", "office", "docket", "origin_code")) if has_transfer else NR],
        ["Linked docket record", docket_rec or "No docket record carries this FJC record id"],
        ["FJC file", vintage],
        ["Status basis", "Status as recorded in that FJC file; later FJC releases may differ"],
        ["CourtListener FJC record id", native],
        ["Source", "Federal Judicial Center Integrated Database (civil), as copied by CourtListener"],
        ["Source snapshot", source_as_of or NR],
        ["Record sha256", _s(prov.get("record_sha256")) or NR],
    ]
    badges = [MDL_LABEL, "Pending in this file" if st == "pending" else "Terminated"]
    if cls.startswith("Yes"):
        badges.append("Class action alleged")
    filters = {
        "court_id": [court] if court else [],
        "mdl": [str(mdl_num)] if mdl_num is not None else [],
        "nos": [str(nos_code)] if nos_code is not None else [],
        "origin": [origin_raw] if origin_raw and origin != NR else [],
        "disposition_group": [disp_grp],
        "status": [st],
        "class_action": ["yes" if cls.startswith("Yes") else "not_recorded"],
        "linked_docket": ["yes" if docket_rec else "no"],
        "transferred": ["yes" if has_transfer else "no"],
        "fjc_source": [source] if source else [],
    }
    text = " ".join(p for p in [plt, dfn, docket, court, f"MDL {mdl_num}" if mdl_num is not None else "", nos_label if nos_label != NR else ""] if p)
    item = {"id": rid, "title": title, "subtitle": subtitle, "cells": cells, "badges": badges, "links": links}
    return {
        "dataset": DATASET,
        "id": rid,
        "category": DATASET,
        "state": state,
        "title": title,
        "source_url": source_url,
        "item": item,
        "detail": {"id": rid, "title": title, "subtitle": subtitle, "facts": facts, "links": links},
        "text": " ".join(str(p) for p in [rid, title, subtitle, text] if p),
        "filters": {"_listing": ["yes"], **filters},
    }


def sort_key(rec: dict) -> tuple:
    """Listing order: MDL number, court, filing date, record id."""
    c = rec["item"]["cells"]
    return (c["mdl"] if c["mdl"] is not None else 10**9, c["court_id"], c["filed"], rec["id"])
