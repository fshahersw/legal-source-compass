"""Re-publish only mdl_terminated_history from private/acq/jpml/mdl_meta.json (after re-running parse_meta.py).

The district headings of the JPML terminated-litigations report include non-numeric codes (53L, 108x) and a heading
printed without parentheses; parse_meta.py records each heading's printed litigation count so per-district parsing
can be checked. Districts whose parsed rows differ from the printed count are listed in the dataset summary.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_mdl_analytics as bma  # noqa: E402
import corpus_writer as cw  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def main():
    history = bma.terminated_history()
    check = json.loads((ROOT / "private" / "scratch" / "parse_meta_out.json").read_text())
    cw.publish(
        "mdl_terminated_history", "Terminated MDLs 1968–2025 (JPML)", history,
        listing_block=cw.listing(
            [("mdl", "MDL"), ("caption", "Caption"), ("district", "District"), ("judge", "Judge"), ("transferred", "Transferred"),
             ("closed", "Closed"), ("remanded", "Remanded"), ("year", "Terminated")],
            [("decade", "Decade terminated", {f"{d}s": f"{d}s" for d in range(1960, 2030, 10)})],
        ),
        summary={
            "source": "JPML FY2025 terminated litigations report", "rows": len(history),
            "districts": check.get("terminated_districts"), "printed_total": check.get("printed_total"),
            "unparsed_lines": check.get("cumulative_unparsed"),
            "district_count_differences": [
                {"code": c, "district": n, "printed": p, "parsed": q} for c, n, p, q in check.get("district_count_mismatches", [])
            ],
            "note": "District headings fixed 2026-10-18 (non-numeric codes and unparenthesised counts); rows were previously filed under the preceding district for about 250 litigations.",
        },
    )


if __name__ == "__main__":
    main()
