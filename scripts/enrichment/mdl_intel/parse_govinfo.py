"""Parse GovInfo MODS for JPML packages into per-order rows (one per granule = one Panel order).

Each granule's subTitle is the CM/ECF docket text of the order as published by GovInfo, e.g.
"TRANSFER ORDER re: pldg. (1 in MDL No. 3134) Transferring 1 action(s) to Judge Zahid N. Quraishi in the
D. New Jersey.Signed by Judge Karen K. Caldwell, Chair, ... on 2/6/2025. Associated Cases: ..."
We keep that text verbatim and derive only what the text states explicitly.
"""
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://www.loc.gov/mods/v3", "xlink": "http://www.w3.org/1999/xlink"}

# Order kinds by docket-text prefix (case-insensitive). Order matters: first match wins.
KINDS = [
    ("order_denying_transfer", re.compile(r"^\s*ORDER\s+DENYING\s+TRANSFER", re.I)),
    ("transfer_order", re.compile(r"^\s*(?:AMENDED\s+|CORRECTED\s+)?TRANSFER\s+ORDER", re.I)),
    ("order_vacating_cto", re.compile(r"^\s*ORDER\s+VACATING\s+CONDITIONAL\s+TRANSFER", re.I)),
    ("order_denying_remand", re.compile(r"^\s*ORDER\s+DENYING\s+(?:MOTION\s+TO\s+)?(?:REMAND|VACAT\w*\s+(?:CONDITIONAL\s+)?REMAND)", re.I)),
    ("remand_order", re.compile(r"^\s*(?:SUGGESTION\s+OF\s+)?REMAND|ORDER\s+(?:OF\s+)?REMAND", re.I)),
    ("order_vacating_cro", re.compile(r"^\s*ORDER\s+VACATING\s+CONDITIONAL\s+REMAND", re.I)),
    ("order_deeming_moot", re.compile(r"^\s*ORDER\s+DEEMING\s+MOTION\s+MOOT", re.I)),
    ("order_deeming_withdrawn", re.compile(r"^\s*ORDER\s+DEEMING\s+MOTION\s+WITHDRAWN", re.I)),
    ("order_denying_motion", re.compile(r"^\s*ORDER\s+DENYING", re.I)),
    ("order_granting_motion", re.compile(r"^\s*ORDER\s+GRANTING", re.I)),
    ("order_vacating", re.compile(r"^\s*ORDER\s+VACATING", re.I)),
    ("order", re.compile(r"^\s*(?:ORDER|OPINION)", re.I)),
]

RE_PLDG = re.compile(r"re:\s*pldg\.?\s*\(\s*([0-9][0-9;,\s]*)\s+in\s+MDL\s+No\.?\s*(\d+)", re.I)
RE_ACTIONS = re.compile(r"Transferring\s+(\d+)\s+action\(s\)", re.I)
RE_TO = re.compile(r"action\(s\)\s+to\s+(?:the\s+)?(?:Honorable\s+)?(?:(?:Chief|Senior)\s+)?(?:Judge\s+)+(.+?)\s+in\s+the\s+(.+?)\.?\s*Signed\s+by", re.I)
RE_SIGNED = re.compile(r"Signed\s+by\s+(.+?)\s+on\s+(\d{1,2}/\d{1,2}/\d{4})", re.I)
RE_MDL_IN_CASE = re.compile(r"F-0*(\d+)$")


RE_ORDER_START = re.compile(r"(ORDER DENYING TRANSFER|(?:AMENDED |CORRECTED )?TRANSFER ORDER|ORDER VACATING CONDITIONAL TRANSFER|ORDER DEEMING MOTION (?:MOOT|WITHDRAWN)|ORDER DENYING|ORDER GRANTING|ORDER VACATING|SUGGESTION OF REMAND|REMAND ORDER|ORDER)", re.I)


def order_text(text: str) -> str:
    """Docket text from the first order keyword onward (some granules prefix associated-case lists)."""
    t = " ".join((text or "").split())
    if re.fullmatch(r"DOCKET SHEET(?: \(\w+\))?", t, re.I):
        return t
    m = RE_ORDER_START.search(t)
    return t[m.start():] if m else t


def classify(text: str) -> str:
    t = order_text(text)
    if re.match(r"DOCKET SHEET", t, re.I):
        return "docket_sheet"
    for kind, pattern in KINDS:
        if pattern.search(t):
            return kind
    return "other"


def mdl_from_case(case_number: str):
    m = RE_MDL_IN_CASE.search(case_number or "")
    return int(m.group(1)) if m else None


def parse_subtitle(sub: str) -> dict:
    sub = " ".join((sub or "").split())
    out = {"kind": classify(sub), "pleadings": None, "pldg_mdl": None, "actions_transferred": None, "transferee_judge": None, "transferee_court": None, "signed_by": None, "signed_date": None}
    body = order_text(sub)
    head = re.split(r"Transferring|Signed by", body, maxsplit=1)[0]
    pairs = [(int(a), int(b)) for a, b in re.findall(r"(\d+)\s+in\s+MDL\s+No\.?\s*(\d+)", head, re.I)]
    if pairs:
        out["pleadings"] = sorted({a for a, _ in pairs})
        out["pldg_mdl"] = pairs[0][1]
    sub = body
    m = RE_ACTIONS.search(sub)
    if m:
        out["actions_transferred"] = int(m.group(1))
    m = RE_TO.search(sub)
    if m and out["kind"] == "transfer_order":
        out["transferee_judge"] = m.group(1).strip().rstrip(",")
        out["transferee_court"] = re.split(r"\.\s+(?=IT IS|[A-Z][a-z]+\s+[a-z])", m.group(2).strip())[0].rstrip(". ")
    m = RE_SIGNED.search(sub)
    if m:
        out["signed_by"] = m.group(1).strip()
        mo, d, y = m.group(2).split("/")
        out["signed_date"] = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    return out


def parse_mods(xml_bytes: bytes) -> dict:
    root = ET.fromstring(xml_bytes)
    pkg = root.findtext("m:recordInfo/m:recordIdentifier", namespaces=NS)
    title = root.findtext("m:titleInfo/m:title", namespaces=NS)
    case = root.findtext("m:extension/m:caseNumber", namespaces=NS)
    nature = root.findtext("m:extension/m:natureSuitCode", namespaces=NS)
    granules = []
    for item in root.findall("m:relatedItem[@type='constituent']", NS):
        sub = item.findtext("m:titleInfo/m:subTitle", namespaces=NS) or ""
        part = item.findtext("m:titleInfo/m:partNumber", namespaces=NS)
        issued = item.findtext("m:originInfo/m:dateIssued", namespaces=NS)
        pdf = None
        for url in item.findall("m:location/m:url", NS):
            if url.get("displayLabel") == "PDF rendition":
                pdf = (url.text or "").strip()
        details = item.findtext("m:identifier[@type='uri']", namespaces=NS)
        granules.append({"part": int(part) if part and part.isdigit() else part, "issued": issued, "text": " ".join(sub.split()), "pdf": pdf, "details": details, **parse_subtitle(sub)})
    return {"package": pkg, "title": " ".join((title or "").split()), "case_number": case, "mdl": mdl_from_case(case), "nature_of_suit": nature, "granules": granules}


def load_all(mods_dir: Path) -> list:
    out = []
    for path in sorted(mods_dir.glob("*mods.xml")):
        try:
            out.append(parse_mods(path.read_bytes()))
        except ET.ParseError:
            continue
    return out


if __name__ == "__main__":
    import collections
    import sys

    rows = load_all(Path(sys.argv[1]))
    kinds = collections.Counter(g["kind"] for r in rows for g in r["granules"])
    print(json.dumps({"packages": len(rows), "granules": sum(len(r["granules"]) for r in rows), "kinds": kinds}, indent=1))
    others = [g["text"][:140] for r in rows for g in r["granules"] if g["kind"] in ("other", "order")]
    print("\n".join(others[:40]))
