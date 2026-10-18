"""Build all three jpml_history datasets in order (offline: reads only private/acq/jpml_history/ and the saved lookups).

  python3 -I -B scripts/enrichment/jpml_history/build_all.py

1. build_jpml_history.build()        monthly pending-MDL reports -> jpml_pending_history_mdls, jpml_pending_history_months
2. build_statistics_extra.build()    fiscal-year Statistical Analysis reports -> jpml_statistics_extra
3. the monthly rows are rebuilt with the fiscal-year context (Sept 30 history and lifetime curve per MDL, cross-check
   sentences per month where a monthly report follows a fiscal-year end), then everything is written to
   private/build/jpml_history/.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import build_jpml_history as bh  # noqa: E402
import build_statistics_extra as bse  # noqa: E402


def main():
    monthly = bh.build()
    fy = bse.build(monthly_hist=monthly["hist"])
    notes = bse.month_notes(fy["reconcile"])
    mdl_notes = bse.mdl_notes(fy["reconcile"])
    for r in monthly["hist"]:
        r["cross_source_notes"] = mdl_notes.get(r["mdl"], [])
    bh.rebuild_rows(monthly, fy=fy["recs"], notes=notes)
    bh.write(monthly)
    bse.write(fy)


if __name__ == "__main__":
    main()
