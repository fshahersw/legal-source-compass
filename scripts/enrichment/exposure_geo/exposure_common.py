"""Shared helpers for the exposure-geography builders (CMS Part D, CDC PLACES, EPA UCMR 5).

Builders only read raw files already acquired under private/acq/de-exposure/ and write dry-run packets beside them:

    <acq>/packets/<dataset>/dataset.json    label, listing block and summary (what corpus_writer.publish sends)
    <acq>/packets/<dataset>/records.jsonl   one corpus_records row per line, in publish order
    <acq>/packets/<dataset>/manifest.json   record count, sha256 (the same digest corpus_writer.publish computes)

Nothing here talks to the corpus. Publishing is a separate, explicit step (publish_packets.py) that the lead runs.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DEFAULT_ACQ = os.path.join(REPO, "private", "acq", "de-exposure")
MAP_PATH = os.path.join(HERE, "mdl_exposure_map.json")

sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))
import corpus_writer  # noqa: E402  (record/listing shapes only; publish is never called from builders)

# State FIPS -> (USPS, name). 50 states, DC, Puerto Rico and the inhabited territories; exact codes only.
STATE_FIPS = {
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"), "05": ("AR", "Arkansas"),
    "06": ("CA", "California"), "08": ("CO", "Colorado"), "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"), "12": ("FL", "Florida"), "13": ("GA", "Georgia"), "15": ("HI", "Hawaii"),
    "16": ("ID", "Idaho"), "17": ("IL", "Illinois"), "18": ("IN", "Indiana"), "19": ("IA", "Iowa"),
    "20": ("KS", "Kansas"), "21": ("KY", "Kentucky"), "22": ("LA", "Louisiana"), "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"), "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"), "27": ("MN", "Minnesota"),
    "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"), "30": ("MT", "Montana"), "31": ("NE", "Nebraska"),
    "32": ("NV", "Nevada"), "33": ("NH", "New Hampshire"), "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"), "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"), "39": ("OH", "Ohio"),
    "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"), "42": ("PA", "Pennsylvania"), "44": ("RI", "Rhode Island"),
    "45": ("SC", "South Carolina"), "46": ("SD", "South Dakota"), "47": ("TN", "Tennessee"), "48": ("TX", "Texas"),
    "49": ("UT", "Utah"), "50": ("VT", "Vermont"), "51": ("VA", "Virginia"), "53": ("WA", "Washington"),
    "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"), "56": ("WY", "Wyoming"), "60": ("AS", "American Samoa"),
    "66": ("GU", "Guam"), "69": ("MP", "Northern Mariana Islands"), "72": ("PR", "Puerto Rico"),
    "78": ("VI", "U.S. Virgin Islands"),
}
USPS_NAME = {usps: name for usps, name in STATE_FIPS.values()}


def load_map(path: str = MAP_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    validate_map(data)
    return data


def validate_map(data: dict) -> None:
    """Refuse a mapping that is not explicit: every included entry names exact strings and cites its basis."""
    for entry in data["partd"]:
        mdl = entry.get("mdl")
        if not isinstance(mdl, str) or not mdl.isdigit():
            raise ValueError(f"partd entry without an exact MDL number: {entry!r}")
        if not entry.get("mdl_title", "").startswith("IN RE:"):
            raise ValueError(f"MDL {mdl}: mdl_title must be the JPML title as published")
        if not entry.get("include"):
            if not entry.get("exclude_reason"):
                raise ValueError(f"MDL {mdl}: an excluded entry needs exclude_reason")
            continue
        scope = entry.get("scope")
        if scope not in ("ingredient", "brand"):
            raise ValueError(f"MDL {mdl}: scope must be 'ingredient' or 'brand'")
        if not entry.get("generic_names"):
            raise ValueError(f"MDL {mdl}: generic_names must list exact CMS Gnrc_Name strings")
        if scope == "brand" and not entry.get("brand_names"):
            raise ValueError(f"MDL {mdl}: a brand-scope entry must list exact CMS Brnd_Name strings")
        basis = entry.get("basis")
        if basis not in ("title_names_drug", "title_names_brand", "title_names_class"):
            raise ValueError(f"MDL {mdl}: unknown basis {basis!r}")
        if basis == "title_names_class" and not entry.get("class_source_url", "").startswith("https://"):
            raise ValueError(f"MDL {mdl}: a class mapping must cite the official class membership source")
    for entry in data["places"]:
        if entry.get("basis") not in ("label_indication", "title_names_injury", "candidate_unreviewed"):
            raise ValueError(f"PLACES {entry.get('measure')}: unknown basis")
        if entry["basis"] != "candidate_unreviewed" and not entry.get("source_url", "").startswith("https://"):
            raise ValueError(f"PLACES {entry.get('measure')}: reviewed links must cite a source")
        for extra in entry.get("more_sources", []):
            if not extra.get("label") or not str(extra.get("url", "")).startswith("https://"):
                raise ValueError(f"PLACES {entry.get('measure')}: every extra source needs a label and an https URL")
        if entry["basis"] != "candidate_unreviewed" and "jpml.uscourts.gov" in entry["source_url"] and entry["source_url"].rstrip("/").endswith("uscourts.gov"):
            raise ValueError(f"PLACES {entry.get('measure')}: cite the JPML document, not the JPML home page")


def num(raw: str | None) -> float | None:
    """A published number, or None when the cell is blank or suppressed. Never a guessed zero."""
    if raw is None:
        return None
    text = raw.strip().replace(",", "")
    if not text or text in ("*", "-", "NA", "N/A"):
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return int(value) if value.is_integer() else value


def digest(rows: list[dict]) -> str:
    """Same digest corpus_writer.publish records as manifest_sha256 (rows before ordinals are added)."""
    return hashlib.sha256("\n".join(json.dumps(row, sort_keys=True) for row in rows).encode()).hexdigest()


def write_packet(acq: str, dataset: str, label: str, rows: list[dict], *, listing_block: dict, summary: dict) -> str:
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{dataset}: duplicate record ids")
    out = os.path.join(acq, "packets", dataset)
    os.makedirs(out, exist_ok=True)
    sha = digest(rows)
    with open(os.path.join(out, "dataset.json"), "w", encoding="utf-8") as fh:
        json.dump({"id": dataset, "label": label, "listing_block": listing_block, "summary": summary}, fh, indent=1, sort_keys=True)
    with open(os.path.join(out, "records.jsonl"), "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"dataset": dataset, "records": len(rows), "sha256": sha}, fh, indent=1)
    return out


def read_packet(path: str) -> tuple[dict, list[dict], dict]:
    with open(os.path.join(path, "dataset.json"), encoding="utf-8") as fh:
        meta = json.load(fh)
    with open(os.path.join(path, "records.jsonl"), encoding="utf-8") as fh:
        rows = [json.loads(line) for line in fh if line.strip()]
    with open(os.path.join(path, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest["records"] != len(rows) or manifest["sha256"] != digest(rows):
        raise ValueError(f"{path}: packet does not match its manifest")
    return meta, rows, manifest


def record(dataset, rid, title, **kwargs):
    return corpus_writer.record(dataset, rid, title, **kwargs)


def listing(columns, filters=()):
    return corpus_writer.listing(columns, filters)
