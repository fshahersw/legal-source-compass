"""Turn the reviewer verdicts into counts-only precision estimates for the hazard themes.

  python3 -I -B scripts/enrichment/saferproducts/theme_precision.py

Reads  private/scratch/enrich/saferproducts/theme_verdicts.json   (positions judged incorrect, generic reasons, no text)
Writes private/build/saferproducts/lookups/theme_precision.json    (per theme: sample size, correct, precision, Wilson 95% interval,
                                                                    regex sha256 at review time, sampled/incorrect report numbers)
The build compares the stored regex hash with the current THEMES entry; a changed regex makes the precision 'Not recorded'.
No description text is read into the output.
"""
import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import spdb_lib as L  # noqa: E402
import theme_sample as S  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
VERDICTS = os.path.join(ROOT, "private", "scratch", "enrich", "saferproducts", "theme_verdicts.json")
OUT = os.path.join(ROOT, "private", "build", "saferproducts", "lookups", "theme_precision.json")


def wilson(correct, n, z=1.96):
    """Wilson score interval for a proportion (percent, 1 decimal)."""
    if n == 0:
        return None
    p = correct / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return round(100 * max(0.0, centre - half), 1), round(100 * min(1.0, centre + half), 1)


def pattern_hash(theme):
    return hashlib.sha256(L.THEMES[theme][1].pattern.encode("utf-8")).hexdigest()


def main():
    with open(VERDICTS, encoding="utf-8") as fh:
        verdicts = json.load(fh)
    desc = S.descriptions()
    out = {"method": "hand review of a deterministic hash-ordered sample of matching reports per theme; see definition", "themes": {}}
    for theme, v in verdicts["themes"].items():
        picked, total = S.sample(desc, v["round"], theme, v["size"])
        numbers = [n for n, _t, _m in picked]
        incorrect = sorted(int(k) for k in v["incorrect"])
        if len(numbers) != v["size"] or any(k < 1 or k > v["size"] for k in incorrect):
            raise SystemExit("%s: verdict positions do not fit the sample" % theme)
        correct = v["size"] - len(incorrect)
        out["themes"][theme] = {
            "label": L.THEMES[theme][0],
            "round": v["round"],
            "sample_size": v["size"],
            "correct": correct,
            "precision_pct": round(100.0 * correct / v["size"], 1),
            "wilson95_pct": list(wilson(correct, v["size"])),
            "matches_in_export_at_review": total,
            "pattern_sha256": pattern_hash(theme),
            "sampled_report_nos": numbers,
            "incorrect_report_nos": [numbers[k - 1] for k in incorrect],
            "incorrect_reasons": [v["incorrect"][str(k)] for k in incorrect],
        }
    out["reviewer"] = verdicts["reviewer"]
    out["rule"] = verdicts["_note"]
    S.write_retry(OUT, json.dumps(out, indent=1))
    for theme, row in out["themes"].items():
        print(theme, row["correct"], "/", row["sample_size"], row["precision_pct"], row["wilson95_pct"], row["matches_in_export_at_review"])


if __name__ == "__main__":
    main()
