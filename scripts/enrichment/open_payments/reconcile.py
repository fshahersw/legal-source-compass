"""Reconcile the raw CMS summary datasets against the CMS national Summary Dashboard (no network).

Prints, per program year, the summed totals of each summary dataset next to the dashboard figure. Used as a
gate by build_open_payments.py: a builder run fails if any check differs by more than $1.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from op_model import API_YEARS, count, load_api, money  # noqa: E402

TOL = 1.0


def dashboard():
    rows = load_api("dashboard")["rows"]
    out = {}
    for row in rows:
        out[row["data_metrics"].strip()] = {y: money(row.get(f"py_{y}")) for y in API_YEARS}
    return out


def checks():
    dash = dashboard()
    general = dash["Total Dollar Amount of all Payment Records - General Payments"]
    research = dash["Total Dollar Amount of all Payment Records - Research Payments"]
    gen_records = dash["Total Number of all Payment Records - General Payments"]
    gen_to_covered = {
        y: sum(
            dash[k][y] or 0
            for k in (
                "Total Dollar Amount of all Payment Records to Physicians - General Payments",
                "Total Dollar Amount of all Payment Records to Non-Physician Practitioners - General Payments",
                "Total Dollar Amount of all Payment Records to Teaching Hospitals - General Payments",
            )
        )
        for y in API_YEARS
    }
    by_entity = {y: [0.0, 0.0, 0] for y in API_YEARS}
    for row in load_api("by_entity")["rows"]:
        y = str(row.get("program_year"))
        if y in by_entity:
            by_entity[y][0] += money(row.get("total_amount_general")) or 0
            by_entity[y][1] += money(row.get("total_amount_research")) or 0
            by_entity[y][2] += count(row.get("trans_general")) or 0
    results = []
    for y in API_YEARS:
        nature = sum(money(r.get("total_amount")) or 0 for r in load_api(f"nature_by_entity_{y}")["rows"])
        state_general = sum(
            (money(r.get("total_payment_amount_physician")) or 0)
            + (money(r.get("total_payment_amount_non_physician_practitioner")) or 0)
            + (money(r.get("total_payment_amount_teaching_hospital")) or 0)
            for r in load_api("state_totals")["rows"]
            if str(r.get("program_year")) == y and r.get("payment_type") == "General"
        )
        results += [
            (y, "entity general vs dashboard general", by_entity[y][0], general[y]),
            (y, "entity research vs dashboard research", by_entity[y][1], research[y]),
            (y, "entity general records vs dashboard", by_entity[y][2], gen_records[y]),
            (y, "entity x nature general vs dashboard general", nature, general[y]),
            (y, "state general (all US + territories) vs dashboard general to covered recipients", state_general, gen_to_covered[y]),
        ]
    return results


def main():
    failed = 0
    for y, label, ours, theirs in checks():
        diff = None if theirs is None else ours - theirs
        ok = diff is not None and abs(diff) <= TOL
        failed += 0 if ok else 1
        print(f"{y} {'OK ' if ok else 'DIFF'} {label}: {ours:,.2f} vs {theirs if theirs is None else f'{theirs:,.2f}'}" + ("" if ok else f" (diff {diff})"))
    return failed


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
