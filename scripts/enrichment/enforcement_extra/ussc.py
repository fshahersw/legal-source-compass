"""Stream a USSC individual offender datafile and aggregate it to fiscal year x district x offense x sentence type.

No person-level row leaves this module: the readers yield the handful of coded fields needed, and aggregate()
keeps only counts and the per-cell lists of imprisonment months needed for exact medians (discarded after summary).

Definitions (USSC Public Release Codebook FY1999-FY2025, revised April 7, 2026):
  cases            every record in the datafile for the district (each record is one sentenced individual's case)
  offense type     OFFTYPE2 (FY2002-FY2009), OFFTYPSB (FY2010-FY2017), OFFGUIDE (FY2018+): the variable the
                   Commission's Sourcebook used in that year; categories are not comparable across those schemes
  sentence type    SENTIMP 0-4
  imprisonment     length of imprisonment in months for cases with a prison term: SENTTCAP (FY2018+; >470 capped
                   at 469.99, life = 470) or SENTTOT (FY2002-FY2017; values capped here at 470, life = 470);
                   probation-only and fine-only cases have no value and are excluded; median and mean over the cases
                   that have a value
  sentence length  the Commission's "sentence length" (Statistical Information Packet Table 7): SENSPCAP (FY2018+)
                   or SENSPLT0 capped at 470 (FY2002-FY2017): prison plus alternative confinement, probation-only
                   and fine-only cases counted as zero months; median and mean over every case with a value
  guideline range  SENTRNGE (FY2018+), BOOKERCD (FY2005-FY2017), DEPART_A (FY2003-FY2004), DEPART (FY2002),
                   grouped into within / above / below (government-sponsored, other, mixed); cases with a missing
                   or not-applicable code are excluded from the denominator
  mandatory min    STATMIN > 0 (total statutory minimum prison term for the counts of conviction); cases with a
                   missing STATMIN are excluded from the denominator
"""
from __future__ import annotations

import io
import re
import statistics
import zipfile

from ussc_codes import DISTRICTS, OFFENSE_TABLES, RANGE_SCHEMES, SENTIMP

PRISON_CAP = 470.0


def to_int(value) -> int | None:
    s = str(value).strip() if value is not None else ""
    if not s or s == ".":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else None


def to_float(value) -> float | None:
    s = str(value).strip() if value is not None else ""
    if not s or s == ".":
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ------------------------------------------------------------------------------------------------ readers
def sas_positions(sas_program: str, names: list[str]) -> dict[str, tuple[int, int]]:
    """Column positions (1-based inclusive start, end) of the named variables in the SAS INPUT statement shipped
    with the fixed-width .dat file ('NAME  147-148', 'NAME $ 22529-22681' or 'NAME  224')."""
    block = re.search(r"(?im)^\s*INPUT\b(.*?);", sas_program, flags=re.S)
    if not block:
        raise ValueError("no INPUT statement in the SAS program")
    text = block.group(1) + " "
    out = {}
    for name in names:
        # some years spell the variable names in lower case (FY2010)
        m = re.search(r"(?<![A-Za-z0-9_])" + re.escape(name) + r"\s+(?:\$\s*)?(\d+)(?:\s*-\s*(\d+))?(?=\s)", text, flags=re.I)
        if m:
            start = int(m.group(1))
            out[name] = (start, int(m.group(2)) if m.group(2) else start)
    return out


def available_variables(zip_path: str, names: list[str]) -> set[str]:
    """Which of the named variables the year's file carries (SAS INPUT statement or CSV header)."""
    with zipfile.ZipFile(zip_path) as z:
        csvs = [i for i in z.infolist() if i.filename.lower().endswith(".csv")]
        if csvs:
            with z.open(csvs[0]) as raw:
                header = raw.readline().decode("latin-1")
            cols = {c.strip().strip('"').upper() for c in header.rstrip("\r\n").split(",")}
            return {n for n in names if n.upper() in cols}
        sas = [i for i in z.infolist() if i.filename.lower().endswith(".sas")]
        return set(sas_positions(z.read(sas[0]).decode("latin-1"), names)) if sas else set()


def iter_fixed(zip_path: str, names: list[str]):
    """Yield {name: raw string} for each record of the fixed-width .dat inside a FY2002-FY2011 zip."""
    with zipfile.ZipFile(zip_path) as z:
        sas = [i for i in z.infolist() if i.filename.lower().endswith(".sas")]
        dat = [i for i in z.infolist() if i.filename.lower().endswith(".dat")]
        if len(sas) != 1 or len(dat) != 1:
            raise ValueError(f"{zip_path}: expected one .sas and one .dat")
        pos = sas_positions(z.read(sas[0]).decode("latin-1"), names)
        with z.open(dat[0]) as raw:
            for line in io.TextIOWrapper(raw, encoding="latin-1", newline=""):
                yield {n: line[a - 1:b] for n, (a, b) in pos.items()}


def iter_csv(zip_path: str, names: list[str], chunksize: int = 4000):
    """Yield {name: raw string} for each record of the CSV inside a FY2012+ zip (only the named columns are read)."""
    import pandas as pd

    with zipfile.ZipFile(zip_path) as z:
        members = [i for i in z.infolist() if i.filename.lower().endswith(".csv")]
        if len(members) != 1:
            raise ValueError(f"{zip_path}: expected one .csv")
        with z.open(members[0]) as raw:
            header = raw.readline().decode("latin-1")
        cols = [c.strip().strip('"') for c in header.rstrip("\r\n").split(",")]
        by_upper = {c.upper(): c for c in cols}
        present = {by_upper[n.upper()]: n for n in names if n.upper() in by_upper}
        with z.open(members[0]) as raw:
            reader = pd.read_csv(raw, usecols=list(present), dtype=str, keep_default_na=False, chunksize=chunksize,
                                 encoding="latin-1", low_memory=True)
            for chunk in reader:
                chunk = chunk.rename(columns=present)
                for rec in chunk.to_dict("records"):
                    yield rec


# ------------------------------------------------------------------------------------------------ aggregation
def _empty_cell() -> dict:
    return {"cases": 0, "sentence_types": {}, "months": [], "sentence": [], "range": {}, "mm_yes": 0, "mm_valid": 0}


def aggregate(records, spec: dict) -> dict:
    """records: iterable of {var: raw value}; spec from ussc_codes.year_spec. Returns
    {"districts": {code: {"total": cell, "offenses": {offense_code: cell}, "types": {(off, simp): n}}},
     "national": {...same...}, "unknown_district": n, "records": n}."""
    scheme = RANGE_SCHEMES[spec["range"]]
    out = {"districts": {}, "national": {"total": _empty_cell(), "offenses": {}, "types": {}}, "unknown_district": 0, "records": 0}
    for rec in records:
        out["records"] += 1
        d = to_int(rec.get(spec["district"]))
        off = to_int(rec.get(spec["offense"]))
        simp = to_int(rec.get(spec["sentimp"]))
        months = to_float(rec.get(spec["prison"]))
        sentence = to_float(rec.get(spec["sentence"])) if spec.get("sentence") else None
        rng = to_int(rec.get(spec["range"]))
        statmin = to_float(rec.get(spec["statmin"]))
        targets = [out["national"]]
        if d in DISTRICTS:
            targets.append(out["districts"].setdefault(d, {"total": _empty_cell(), "offenses": {}, "types": {}}))
        else:
            out["unknown_district"] += 1
        off_key = off if off is not None else -1
        bucket = scheme.get(rng) if rng is not None else None
        for t in targets:
            for cell in (t["total"], t["offenses"].setdefault(off_key, _empty_cell())):
                cell["cases"] += 1
                if simp in SENTIMP:
                    cell["sentence_types"][simp] = cell["sentence_types"].get(simp, 0) + 1
                if months is not None and months > 0:
                    cell["months"].append(min(months, PRISON_CAP))
                if sentence is not None and sentence >= 0:
                    cell["sentence"].append(min(sentence, PRISON_CAP))
                if bucket:
                    cell["range"][bucket] = cell["range"].get(bucket, 0) + 1
                if statmin is not None:
                    cell["mm_valid"] += 1
                    cell["mm_yes"] += statmin > 0
            key = (off_key, simp if simp in SENTIMP else -1)
            t["types"][key] = t["types"].get(key, 0) + 1
    return out


def pct(n: int, d: int) -> float | None:
    return round(100.0 * n / d, 1) if d else None


def summarize_cell(cell: dict) -> dict:
    months = cell["months"]
    sentence = cell["sentence"]
    r = cell["range"]
    valid = sum(r.values())
    below = r.get("below_gov", 0) + r.get("below_other", 0) + r.get("below_mixed", 0)
    return {
        "cases": cell["cases"],
        "sentence_types": {str(k): v for k, v in sorted(cell["sentence_types"].items())},
        "prison_n": len(months),
        "prison_median": round(statistics.median(months), 2) if months else None,
        "prison_mean": round(sum(months) / len(months), 2) if months else None,
        "sentence_n": len(sentence),
        "sentence_median": round(statistics.median(sentence), 2) if sentence else None,
        "sentence_mean": round(sum(sentence) / len(sentence), 2) if sentence else None,
        "range_valid": valid,
        "within": r.get("within", 0), "above": r.get("above", 0), "below": below,
        "below_gov": r.get("below_gov", 0), "below_other": r.get("below_other", 0), "below_mixed": r.get("below_mixed", 0),
        "within_pct": pct(r.get("within", 0), valid), "above_pct": pct(r.get("above", 0), valid), "below_pct": pct(below, valid),
        "mm_valid": cell["mm_valid"], "mm_yes": cell["mm_yes"], "mm_pct": pct(cell["mm_yes"], cell["mm_valid"]),
    }


def summarize_unit(unit: dict, offense_var: str) -> dict:
    labels = OFFENSE_TABLES[offense_var]
    offenses = []
    for code, cell in unit["offenses"].items():
        s = summarize_cell(cell)
        s["code"] = code if code >= 0 else None
        s["label"] = labels.get(code, "Missing" if code < 0 else f"Code {code} (not in the codebook table)")
        offenses.append(s)
    offenses.sort(key=lambda s: (-s["cases"], s["label"]))
    cross = [{"offense": o if o >= 0 else None, "sentence_type": t if t >= 0 else None, "cases": n}
             for (o, t), n in sorted(unit["types"].items(), key=lambda kv: (kv[0][0], kv[0][1]))]
    return {"total": summarize_cell(unit["total"]), "offenses": offenses, "offense_by_sentence_type": cross}
