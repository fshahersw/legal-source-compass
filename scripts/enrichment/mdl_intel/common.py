"""Shared helpers for the mdl-intel builders."""
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import corpus_writer as cw  # noqa: E402,F401
from fetchutil import ACQ, ROOT  # noqa: E402,F401

JPML = "https://www.jpml.uscourts.gov"
STATS_PAGE = f"{JPML}/statistics-info"
ARCHIVE_PAGE = f"{JPML}/hearing-session-orders-archive"
HEARING_PAGE = f"{JPML}/hearing-information"
ORDERS_PAGE = f"{JPML}/panel-orders"
GOVINFO_JPML = "https://www.govinfo.gov/app/collection/uscourts/national/jpml/"
TODAY = date.today().isoformat()


def manifest():
    return json.loads((ACQ / "jpml_manifest.json").read_text())


def pdftotext(path: Path, layout=True, first=None, last=None) -> str:
    args = ["pdftotext"] + (["-layout"] if layout else ["-raw"])
    if first:
        args += ["-f", str(first)]
    if last:
        args += ["-l", str(last)]
    return subprocess.run(args + [str(path), "-"], capture_output=True, text=True, check=True).stdout


def page_count(path: Path) -> int:
    info = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"Pages:\s+(\d+)", info).group(1))


def fmt(n):
    if n is None:
        return "Not recorded"
    if isinstance(n, float):
        return f"{n:,.1f}"
    return f"{n:,}" if isinstance(n, int) else str(n)


def pct(n):
    return "Not recorded" if n is None else f"{n:.1f}%"


def file_url(entry):
    return entry["url"]


def months_between(a: str, b: str):
    if not a or not b:
        return None
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return round((db - da).days / 30.4375, 1)


_DIR = {"northern": "N", "southern": "S", "eastern": "E", "western": "W", "middle": "M", "central": "C"}


def normalize_district(text: str | None):
    """One label style for transferee courts: 'Northern District of Illinois' / 'N.D. Illinois' / 'the D. New Jersey'
    -> 'N.D. Illinois' / 'D. New Jersey'. The order's own wording stays in the evidence text."""
    if not text:
        return None
    t = " ".join(text.split()).strip(" .,")
    t = re.sub(r"^the\s+", "", t, flags=re.I)
    m = re.match(r"^(Northern|Southern|Eastern|Western|Middle|Central)\s+District\s+(?:of\s+)?(.+)$", t, re.I)
    if m:
        return f"{_DIR[m.group(1).lower()]}.D. {m.group(2).strip()}"
    m = re.match(r"^District\s+of\s+(.+)$", t, re.I)
    if m:
        return f"D. {m.group(1).strip()}"
    return t


def district_name(code: str):
    return DISTRICTS.get(code or "", code or "Not recorded")


DISTRICTS = {
    "ALN": "N.D. Alabama", "ARE": "E.D. Arkansas", "AZ": "D. Arizona", "CAC": "C.D. California", "CAN": "N.D. California",
    "CAS": "S.D. California", "CAE": "E.D. California", "CO": "D. Colorado", "CT": "D. Connecticut", "DC": "D. District of Columbia", "DE": "D. Delaware",
    "FLM": "M.D. Florida", "FLN": "N.D. Florida", "FLS": "S.D. Florida", "GAN": "N.D. Georgia", "GAS": "S.D. Georgia", "HI": "D. Hawaii",
    "IAN": "N.D. Iowa", "IAS": "S.D. Iowa", "ID": "D. Idaho", "ILN": "N.D. Illinois", "ILS": "S.D. Illinois", "ILC": "C.D. Illinois", "INN": "N.D. Indiana",
    "INS": "S.D. Indiana", "KS": "D. Kansas", "KYE": "E.D. Kentucky", "KYW": "W.D. Kentucky", "LAE": "E.D. Louisiana", "LAM": "M.D. Louisiana",
    "LAW": "W.D. Louisiana", "MA": "D. Massachusetts", "MD": "D. Maryland", "ME": "D. Maine", "MIE": "E.D. Michigan", "MIW": "W.D. Michigan",
    "MN": "D. Minnesota", "MOE": "E.D. Missouri", "MOW": "W.D. Missouri", "MSN": "N.D. Mississippi", "MSS": "S.D. Mississippi", "MT": "D. Montana",
    "NCE": "E.D. North Carolina", "NCM": "M.D. North Carolina", "NCW": "W.D. North Carolina", "ND": "D. North Dakota", "NE": "D. Nebraska",
    "NH": "D. New Hampshire", "NJ": "D. New Jersey", "NM": "D. New Mexico", "NV": "D. Nevada", "NYE": "E.D. New York", "NYN": "N.D. New York",
    "NYS": "S.D. New York", "NYW": "W.D. New York", "OHN": "N.D. Ohio", "OHS": "S.D. Ohio", "OKE": "E.D. Oklahoma", "OKN": "N.D. Oklahoma",
    "OKW": "W.D. Oklahoma", "OR": "D. Oregon", "PAE": "E.D. Pennsylvania", "PAM": "M.D. Pennsylvania", "PAW": "W.D. Pennsylvania", "PR": "D. Puerto Rico",
    "RI": "D. Rhode Island", "SC": "D. South Carolina", "SD": "D. South Dakota", "TNE": "E.D. Tennessee", "TNM": "M.D. Tennessee", "TNW": "W.D. Tennessee",
    "TXE": "E.D. Texas", "TXN": "N.D. Texas", "TXS": "S.D. Texas", "TXW": "W.D. Texas", "UT": "D. Utah", "VAE": "E.D. Virginia", "VAW": "W.D. Virginia",
    "VT": "D. Vermont", "WAE": "E.D. Washington", "WAW": "W.D. Washington", "WIE": "E.D. Wisconsin", "WIW": "W.D. Wisconsin", "WVN": "N.D. West Virginia",
    "WVS": "S.D. West Virginia", "WY": "D. Wyoming", "AK": "D. Alaska", "AR": "D. Arkansas",
}
