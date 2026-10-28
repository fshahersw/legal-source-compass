"""Pure record builder for dataset fjc_idb_mdl_cases: one corpus record per FJC Integrated Database civil case row that carries an
MDL docket number, as mirrored by CourtListener (bulk file fjc-integrated-database-2026-09-30.csv.bz2) and held in
corpus_ingest.entities (source_system 'courtlistener', entity_type 'fjc-integrated-database').

Rules (AGENTS.md):
* MDL association = the IDB field MDLDOCK on the case row, labelled "FJC IDB (historical)". It is not JPML membership, a transfer
  ruling or a master designation, and nothing is inferred from caption, product, judge or court.
* Courts link only by the exact CourtListener court id the row carries (district_id). Dockets link only through CourtListener's own
  foreign key (dockets.idb_data_id = this row's id) AND an exact court + docket-number match (court_id = district_id and the docket's
  2-digit year + 5-digit sequence = the IDB DOCKET field). Anything else gets no docket link.
* Codes are decoded from the FJC civil codebook (idb_codes.py); a code outside it is shown as "Code <n> (not in the codebook)".
  Missing values are "Not recorded". Parties are shown exactly as the IDB records them (first-listed plaintiff / defendant).
No network and no I/O here, so the unit tests run anywhere.
"""
from __future__ import annotations

import re

import idb_codes as ic

DATASET = "fjc_idb_mdl_cases"
LABEL = "MDL member cases in the FJC Integrated Database (civil case rows carrying an MDL docket number; historical association)"
SOURCE_URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/fjc-integrated-database-2026-09-30.csv.bz2"
SOURCE_SHA256 = "7615684b31e06199a20f0ecd1424398f4cca0f17fd3797ccd637e0669492d957"
FJC_PAGE = "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present"
CODEBOOK = "https://www.fjc.gov/sites/default/files/idb/codebooks/Civil%20Codebook%201988%20Forward%2010252023.pdf"
CL_DOCKET = "https://www.courtlistener.com/docket/{}/"
EVIDENCE = "FJC IDB (historical)"
NR = "Not recorded"

ARBITRATION = {"M": "Mandatory", "V": "Voluntary", "E": "Exempt", "Y": "Yes, type unknown"}
CL_DOCKET_NUMBER = re.compile(r"^\d+:(\d{2})-[a-z]{2}-0*(\d{1,5})(?:-.*)?$")
MDL_VALUE = re.compile(r"^0*([1-9]\d{0,4})$")


def s(v) -> str | None:
    """Trimmed string or None for missing (None, '', '-8')."""
    if v is None:
        return None
    t = str(v).strip()
    return None if t in ("", "-8") else t


def code(v) -> int | None:
    t = s(v)
    return int(t) if t is not None and re.fullmatch(r"-?\d+", t) else None


def mdl_number(v) -> str | None:
    """'02885' -> '2885'; anything that is not a positive whole number -> None (never guessed)."""
    t = s(v)
    m = MDL_VALUE.match(t) if t else None
    return m.group(1) if m else None


def docket_display(dn: str | None) -> str | None:
    """IDB DOCKET '1201931' (2-digit docket year + 5-digit sequence, per the codebook) -> '12-01931'."""
    return f"{dn[:2]}-{dn[2:]}" if dn and re.fullmatch(r"\d{7}", dn) else None


def cl_docket_core(docket_number: str | None) -> str | None:
    """CourtListener '1:12-cv-01931' -> '1201931' (the IDB DOCKET form); None when the number is blank or not in that form."""
    m = CL_DOCKET_NUMBER.match((docket_number or "").strip())
    return m.group(1) + m.group(2).zfill(5) if m else None


def docket_link(fjc_id: str, district_id: str | None, docket_number: str | None, dockets: dict) -> dict | None:
    """The CourtListener docket whose own idb_data_id is this row, when its court and docket number equal the row's exactly."""
    d = dockets.get(fjc_id)
    if not d or not district_id or not docket_number:
        return None
    if d.get("court_id") != district_id or cl_docket_core(d.get("docket_number")) != docket_number:
        return None
    return d


def thousands(v, *, received: bool = False) -> str:
    n = code(v)
    if n is None:
        return NR
    if n == 9999:
        return ("9999 (codebook: some courts use 9999 for amounts over $1 million, others as a filler or for an unknown amount)" if received
                else "9999 (codebook: the highest value the field holds; larger demands also appear as 9999)")
    return f"{n:,} (thousands of dollars, as recorded)"


def nos_label(n: int | None, nos_names: dict) -> str:
    if n is None:
        return NR
    name = nos_names.get(str(n)) or nos_names.get(n)
    return f"{n} {name}" if name and not name.startswith("Code ") else f"Code {n} (not in the codebook)"


def decode(data: dict, nos_names: dict) -> dict:
    """Every field of the row, decoded where the codebook gives a meaning; raw codes kept beside the labels."""
    origin, juris, nos = code(data.get("origin")), code(data.get("jurisdiction")), code(data.get("nature_of_suit"))
    disp, prog = code(data.get("disposition")), code(data.get("procedural_progress"))
    noj, judgment, pro_se = code(data.get("nature_of_judgement")), code(data.get("judgment")), code(data.get("pro_se"))
    trcl = code(data.get("termination_class_action_status"))
    tape = code(data.get("year_of_tape"))
    terminated = s(data.get("date_terminated"))
    county = s(data.get("county_of_residence"))
    classact = s(data.get("class_action"))
    title, section, subsection = s(data.get("title")), s(data.get("section")), s(data.get("subsection"))
    cause = None
    if title or section:
        cause = " ".join(p for p in [f"Title {title}" if title else None, f"section {section}{subsection or ''}" if section else None] if p)
    return {
        "plaintiff": s(data.get("plaintiff")),
        "defendant": s(data.get("defendant")),
        "court_id": s(data.get("district_id")),
        "circuit_id": s(data.get("circuit_id")),
        "office": s(data.get("office")),
        "docket_number": s(data.get("docket_number")),
        "date_filed": s(data.get("date_filed")),
        "date_terminated": terminated,
        "pending": terminated is None and tape == 2099,
        "status": (f"Terminated {terminated}" if terminated else
                   "Pending in this IDB file (tape year 2099)" if tape == 2099 else NR),
        "origin_code": origin, "origin": ic.label(ic.ORIGIN, origin),
        "jurisdiction_code": juris, "jurisdiction": ic.label(ic.JURISDICTION, juris),
        "nos_code": nos, "nature_of_suit": nos_label(nos, nos_names), "nos_group": ic.NOS_TO_GROUP.get(nos, "unmapped") if nos is not None else None,
        "cause": cause,
        "diversity_of_residence_code": s(data.get("diversity_of_residence")),
        "class_action": "Yes (class action alleged)" if classact in ("t", "true", "1", "True") else NR,
        "class_action_termination": ic.label(ic.CLASS_ACTION_TERMINATION, trcl),
        "monetary_demand": thousands(data.get("monetary_demand")),
        "county_of_residence": ("88888 (first-listed plaintiff resides outside the home state)" if county == "88888" else county),
        "arbitration_at_filing": ARBITRATION.get(s(data.get("arbitration_at_filing")) or "", s(data.get("arbitration_at_filing"))),
        "arbitration_at_termination": ARBITRATION.get(s(data.get("arbitration_at_termination")) or "", s(data.get("arbitration_at_termination"))),
        "date_transfer": s(data.get("date_transfer")),
        "transfer_office": s(data.get("transfer_office")),
        "transfer_docket_number": s(data.get("transfer_docket_number")),
        "transfer_origin_code": code(data.get("transfer_origin")),
        "transfer_origin": ic.label(ic.ORIGIN, code(data.get("transfer_origin"))) if code(data.get("transfer_origin")) is not None else NR,
        "procedural_progress_code": prog,
        "procedural_progress": (f"{ic.label(ic.PROCEDURAL_PROGRESS, prog)} ({ic.PROCEDURAL_PROGRESS[prog][1].lower()})"
                                if prog in ic.PROCEDURAL_PROGRESS else ic.label(ic.PROCEDURAL_PROGRESS, prog)),
        "disposition_code": disp, "disposition": ic.label(ic.DISPOSITION, disp),
        "disposition_group": ic.DISPOSITION[disp][1] if disp in ic.DISPOSITION else None,
        "nature_of_judgment_code": noj, "nature_of_judgment": ic.label(ic.NATURE_OF_JUDGMENT, noj),
        # codebook: JUDGMENT 0 and -8 are missing
        "judgment_for_code": judgment, "judgment_for": ic.label(ic.JUDGMENT_FOR, judgment if judgment not in (0,) else None),
        "amount_received": thousands(data.get("amount_received"), received=True),
        "pro_se_code": pro_se, "pro_se": ic.label(ic.PRO_SE, pro_se),
        "tape_year": tape,
        "fjc_dataset_source": s(data.get("dataset_source")),
    }


def fiscal_year(date: str | None) -> int | None:
    if not date or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return None
    y, m = int(date[:4]), int(date[5:7])
    return y + 1 if m >= 10 else y


def build_record(entity: dict, lk: dict, dockets: dict) -> dict:
    """entity = {native_id, data, provenance, payload_sha256, source_as_of, retrieved_at} from corpus_ingest.entities.
    lk = {"nos": {code: name}, "courts": {court_id: name}, "mdls": {mdl: JPML title}, "fjc_civil_mdls": set of 'mdl:N' ids}.
    dockets = {idb_data_id: {"record_id", "native_id", "court_id", "docket_number"}} from the published cl_docket_metadata."""
    import corpus_writer as writer  # imported here so the pure helpers above stay importable without the writer

    fid = str(entity["native_id"])
    data = entity["data"]
    prov = entity.get("provenance") or {}
    mdl = mdl_number(data.get("multidistrict_litigation_docket_number"))
    if mdl is None:
        raise ValueError(f"fjc:{fid}: no positive MDL docket number; the row is outside this dataset")
    d = decode(data, lk.get("nos", {}))
    court = d["court_id"]
    court_name = lk.get("courts", {}).get(court) if court else None
    dk = docket_link(fid, court, d["docket_number"], dockets)
    jpml_title = lk.get("mdls", {}).get(mdl)
    plt, dft = d["plaintiff"], d["defendant"]
    title = f"{plt or 'Plaintiff not recorded'} v. {dft or 'Defendant not recorded'}"
    shown_dn = docket_display(d["docket_number"]) or d["docket_number"] or NR
    subtitle = " · ".join(p for p in [f"MDL {mdl} ({EVIDENCE})", court_name or court or "Court not recorded", f"IDB docket {shown_dn}",
                                      f"filed {d['date_filed']}" if d["date_filed"] else None, d["status"]] if p)
    links = []
    if jpml_title:
        links.append({"url": f"/matters/{mdl}", "label": f"MDL No. {mdl} (JPML record)"})
    if f"mdl:{mdl}" in lk.get("fjc_civil_mdls", set()):
        links.append({"url": f"/records/fjc_civil_mdls/mdl:{mdl}", "label": f"All IDB cases carrying MDL {mdl} (FJC totals)"})
    if court and court in lk.get("courts", {}):
        links.append({"url": f"/courts/{court}", "label": court_name or court})
    if dk:
        links.append({"url": f"/records/cl_docket_metadata/{dk['record_id']}", "label": f"Docket {dk['docket_number']} (exact court + number)"})
        links.append({"url": CL_DOCKET.format(dk["native_id"]), "label": "CourtListener docket"})
    links.append({"url": CODEBOOK, "label": "IDB civil codebook (code meanings)"})
    fy = fiscal_year(d["date_filed"])
    cells = {
        "case": title, "mdl": mdl, "court_id": court or NR, "docket_number": shown_dn,
        "date_filed": d["date_filed"] or NR, "status": d["status"],
        "nature_of_suit": d["nature_of_suit"], "origin": d["origin"], "disposition": d["disposition"],
    }
    facts = [
        ["MDL (IDB field MDLDOCK)", f"{mdl} - {EVIDENCE}; not JPML membership"],
        ["MDL title (JPML record, exact number)", jpml_title or NR],
        ["First-listed plaintiff (as recorded)", plt or NR],
        ["First-listed defendant (as recorded)", dft or NR],
        ["Court", f"{court_name} ({court})" if court_name else (court or NR)],
        ["Office code / circuit", f"{d['office'] or NR} / {d['circuit_id'] or NR}"],
        ["IDB docket number", shown_dn],
        ["Filed (fiscal year)", f"{d['date_filed']} (FY{fy})" if d["date_filed"] and fy else (d["date_filed"] or NR)],
        ["Status in this IDB file", d["status"]],
        ["Origin", d["origin"]],
        ["Jurisdiction", d["jurisdiction"]],
        ["Nature of suit", d["nature_of_suit"]],
        ["Monetary demand", d["monetary_demand"]],
        ["Pro se parties", d["pro_se"]],
    ]
    if d["date_terminated"]:
        facts += [
            ["Procedural progress at termination", d["procedural_progress"]],
            ["Disposition", d["disposition"] + (f" ({d['disposition_group']})" if d["disposition_group"] else "")],
            ["Nature of judgment", d["nature_of_judgment"]],
            ["Judgment for", d["judgment_for"]],
            ["Amount received", d["amount_received"]],
        ]
    optional = [
        ["U.S. Code cause (title and section as recorded)", d["cause"]],
        ["Citizenship of principal parties (RESIDENC code as recorded)", d["diversity_of_residence_code"]],
        ["County of residence of first-listed plaintiff (FIPS code as recorded)", d["county_of_residence"]],
        ["Class action alleged", d["class_action"] if d["class_action"] != NR else None],
        ["Class action at termination", d["class_action_termination"] if d["class_action_termination"] != NR else None],
        ["Transferred: date papers received", d["date_transfer"]],
        ["Transferred: losing office / docket / origin",
         " / ".join([d["transfer_office"] or NR, d["transfer_docket_number"] or NR, d["transfer_origin"]])
         if (d["transfer_office"] or d["transfer_docket_number"] or d["transfer_origin_code"] is not None) else None],
        ["Arbitration at filing / termination",
         f"{d['arbitration_at_filing'] or NR} / {d['arbitration_at_termination'] or NR}" if (d["arbitration_at_filing"] or d["arbitration_at_termination"]) else None],
    ]
    facts += [[k, v] for k, v in optional if v]
    facts += [
        ["IDB tape year", (f"{d['tape_year']} (pending case record)" if d["tape_year"] == 2099 else str(d["tape_year"])) if d["tape_year"] else NR],
        ["CourtListener FJC IDB record id", fid],
        ["Linked docket (exact)", f"{dk['docket_number']} (CourtListener docket {dk['native_id']})" if dk else NR],
    ]
    badges = [EVIDENCE, "Not JPML membership", "Pending in this IDB file" if d["pending"] else ("Terminated" if d["date_terminated"] else "Status not recorded")]
    if dk:
        badges.append("Docket linked")
    text_parts = [plt, dft, f"MDL {mdl}", court, d["docket_number"], shown_dn, d["nature_of_suit"]]
    filters = {
        "mdl": [mdl],
        "court_id": [court] if court else [],
        "status": ["pending" if d["pending"] else "terminated" if d["date_terminated"] else "not_recorded"],
        "origin": [str(d["origin_code"])] if d["origin_code"] is not None else [],
        "nos_group": [d["nos_group"]] if d["nos_group"] else [],
        "disposition_group": [d["disposition_group"]] if d["disposition_group"] else [],
        "fy_filed": [str(fy)] if fy else [],
        "docket_linked": ["yes" if dk else "no"],
    }
    rec = writer.record(DATASET, f"fjc:{fid}", title, source_url=SOURCE_URL, cells=cells, facts=facts,
                        text=" ".join(p for p in text_parts if p), filters=filters, subtitle=subtitle, badges=badges, links=links,
                        extra={"profile": {"fjc_id": fid, "mdl": mdl, "court_id": court, "pending": d["pending"],
                                           "date_filed": d["date_filed"], "date_terminated": d["date_terminated"],
                                           "codes": {k: d[k] for k in CODE_KEYS},
                                           "docket": ({"record_id": dk["record_id"], "cl_docket_id": dk["native_id"], "docket_number": dk["docket_number"]}
                                                      if dk else None)}})
    if (prov.get("source_sha256") or SOURCE_SHA256) != SOURCE_SHA256 or (prov.get("source_url") or SOURCE_URL) != SOURCE_URL:
        raise ValueError(f"fjc:{fid}: provenance is not the pinned CourtListener snapshot; refusing to mix sources")
    # Dataset-level provenance and qualification live in the dataset summary; each row keeps its own hashes and snapshot date.
    rec["detail"]["provenance"] = {
        "source_as_of": prov.get("source_as_of") or entity.get("source_as_of"),
        "record_sha256": prov.get("record_sha256"),
        "payload_sha256": entity.get("payload_sha256"),
    }
    rec["detail"]["qualification"] = QUALIFICATION
    return rec


CODE_KEYS = ("origin_code", "jurisdiction_code", "nos_code", "disposition_code", "procedural_progress_code", "nature_of_judgment_code",
             "judgment_for_code", "pro_se_code", "tape_year")
QUALIFICATION = ("FJC IDB case row via CourtListener's mirror. The MDL number is the IDB's own historical field, not JPML membership; "
                 "pending = no termination in this IDB file.")


def listing_block(mdl_labels: dict[str, str], court_labels: dict[str, str]) -> dict:
    import corpus_writer as writer

    return writer.listing(
        [("case", "Case (first-listed parties)"), ("mdl", "MDL"), ("court_id", "Court"), ("docket_number", "IDB docket"),
         ("date_filed", "Filed"), ("status", "Status"), ("nature_of_suit", "Nature of suit"), ("origin", "Origin"), ("disposition", "Disposition")],
        [("mdl", "MDL", {k: f"MDL {k}" + (f" - {v}" if v else "") for k, v in sorted(mdl_labels.items(), key=lambda kv: int(kv[0]))}),
         ("court_id", "Court", dict(sorted(court_labels.items()))),
         ("status", "Status in the IDB file", {"pending": "Pending (no termination in this file)", "terminated": "Terminated", "not_recorded": NR}),
         ("origin", "Origin", {str(k): v for k, v in ic.ORIGIN.items()}),
         ("nos_group", "Nature-of-suit group (this project's grouping)", {**ic.GROUP_LABEL}),
         ("disposition_group", "Disposition group", {g: g for g in sorted({v[1] for v in ic.DISPOSITION.values()})}),
         ("docket_linked", "Linked docket", {"yes": "Yes (exact)", "no": "No"})],
    )


def summary(stats: dict, built_at: str) -> dict:
    return {
        "grain": "one record per FJC IDB civil case row (CourtListener mirror) whose MDLDOCK field carries a positive MDL docket number",
        "publisher": "Federal Judicial Center (Integrated Database, civil)",
        "publisher_page": FJC_PAGE,
        "via": "CourtListener bulk data mirror",
        "source_url": SOURCE_URL,
        "source_sha256": SOURCE_SHA256,
        "snapshot": "2026-09-30",
        "codebook": CODEBOOK,
        "evidence_rule": f"{EVIDENCE}: the IDB field MDLDOCK on each case row. Dated administrative association; never current JPML membership, never inferred from caption, product, judge, firm or court.",
        "docket_link_rule": "A docket is linked only when CourtListener's own dockets.idb_data_id equals the row id AND the docket's court id and docket number equal the row's district and IDB docket number exactly.",
        "court_link_rule": "Court pages link by the exact CourtListener court id carried on the row (district_id).",
        "coverage_note": "CourtListener's mirror of the IDB holds case rows filed through 2021-06-30 for these MDLs; FJC's own current file (dataset fjc_civil_mdls) counts more cases for several MDLs. Rows here are not a complete member-case census.",
        "amount_note": "Monetary demand and amount received are in thousands of dollars as recorded. The codebook says amount received is not used uniformly and 9999 can be a cap, a filler or unknown.",
        "parties_note": "First-listed plaintiff and defendant exactly as the IDB records them (public FJC data); nothing is inferred about any person.",
        "ingest": "corpus_ingest.entities (source_system courtlistener, entity_type fjc-integrated-database, selection reason explicit_fjc_mdl_number)",
        "qualification": QUALIFICATION,
        "status_note": "Pending = the row has no termination date and tape year 2099 (the codebook's pending-record marker) in this IDB file; later events are not in this file.",
        "omitted_when_blank": "Cause, residence, county, class-action, transfer and arbitration facts are listed only when the row records them; termination facts only for terminated rows.",
        "withheld": "none: no row carries a source-reported seal or restriction, and no owner or admin hold applies (owner decision 2026-10-27)",
        "stats": stats,
        "built_at": built_at,
    }
