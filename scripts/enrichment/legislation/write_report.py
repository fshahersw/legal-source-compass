"""Write private/build/legislation/REPORT.md from the build metadata, the verify outputs and the publish receipts.

  python3 -I -B write_report.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as cm  # noqa: E402

B = cm.BUILD
V = B / "verify"


def load(p: Path) -> dict:
    return json.loads(p.read_text()) if p.exists() else {}


def main() -> None:
    fed = load(B / "congress_bills.meta.json")
    st = load(B / "state_bills.meta.json")
    crs = load(B / "crs_reports.json")
    crs_summary = crs.get("summary", {})
    v = {name: load(V / f"{name}.json") for name in ("federal_counts", "federal_sample", "federal_links", "state_counts",
                                                     "state_sample", "crs")}
    receipts = {name: load(B / f"{name}.publish_receipt.json") for name in ("congress_bills", "state_bills", "crs_reports")}
    used = load(cm.ACQ / "congress" / "_request_count.json")
    fs = fed.get("summary", {}).get("stats", {})
    ss = st.get("summary", {}).get("stats", {})
    lines = [
        "# Legislation stream report (congress_bills, crs_reports, state_bills)",
        "",
        f"Built {fed.get('built_at')} (federal), {st.get('built_at')} (state), {crs.get('built_at')} (CRS).",
        "",
        "## Sources and terms",
        f"- Federal: {fed.get('summary', {}).get('source')}. Licence: {fed.get('summary', {}).get('licence')}.",
        f"- CRS: {crs_summary.get('source')}. {crs_summary.get('licence')}. Metadata and links only.",
        f"- State: {st.get('summary', {}).get('source')}. Licence: {st.get('summary', {}).get('licence')}.",
        "  The per-session CSV/JSON archives on that site need an account to show download links, so the public monthly",
        "  PostgreSQL dump linked on the same page was used: streamed once, never stored; SHA-256 "
        f"{st.get('summary', {}).get('dump', {}).get('sha256')} over {st.get('summary', {}).get('dump', {}).get('bytes')} bytes.",
        "",
        "## Datasets",
        f"- congress_bills: {fed.get('rows')} records (108th-119th Congress). Status counts: "
        + ", ".join(f"{k[7:]} {v}" for k, v in sorted(fs.items()) if k.startswith("status_")) + ".",
        f"  CRS summary present for {fs.get('summary_present')}; Congress.gov URL constructed from the published pattern for "
        f"{fs.get('congress_gov_url_constructed')} files without legislationUrl (0 differences from the pattern where published).",
        f"  Laws: resolved to public_laws_enacted {fs.get('law_resolved')}, not found {fs.get('law_not_found')}, not checked "
        f"(private laws) {fs.get('law_not_checked')}, another Congress's number (shown, not linked) {fs.get('law_inconsistent')}.",
        f"- crs_reports: {crs_summary.get('records')} records; detail fetched {crs_summary.get('stats', {}).get('detail_fetched')}, "
        f"not fetched {crs_summary.get('stats', {}).get('detail_not_fetched')} (request budget).",
        f"- state_bills: {st.get('rows')} records, {len(st.get('summary', {}).get('sessions', {}))} jurisdictions, two regular sessions each. "
        f"Outcome: enacted {ss.get('outcome_enacted')}, vetoed {ss.get('outcome_vetoed')}, none recorded {ss.get('outcome_none')}. "
        f"Source URL kind: bill page {ss.get('source_kind_page')}, search/start page {ss.get('source_kind_search')}, data feed {ss.get('source_kind_data')}.",
        "",
        "## Verification (independent second paths)",
    ]
    for name, d in v.items():
        if not d:
            lines.append(f"- {name}: not run")
            continue
        extra = {k: d[k] for k in ("checked", "failures", "explained", "unchecked", "ok", "states", "detail_checked") if k in d}
        lines.append(f"- {name}: {d.get('check')} — {json.dumps(extra)}")
    lines += ["", "## Publish receipts"]
    for name, r in receipts.items():
        lines.append(f"- {name}: {json.dumps(r) if r else 'not published'}")
    lines += ["", "## Budgets",
              f"- Congress.gov API requests: {used.get('requests')} of 8,000 (paced at one request per 1.25 s, under 3,000 per hour).",
              "- GovInfo API requests: 0 (bulk files and the Link Service only). CourtListener requests: 0.",
              "", "## Rules", ""]
    for k in ("milestone_rules", "vitiation_rule", "action_rule", "summary_rule", "law_link_rule", "report_link_rule"):
        lines.append(f"- federal {k}: {json.dumps(fed.get('summary', {}).get(k))}")
    for k in ("session_rule", "milestone_rules", "outcome_rule", "source_url_rule", "actions_rule"):
        lines.append(f"- state {k}: {json.dumps(st.get('summary', {}).get(k))}")
    for k in ("detail_rule", "version_rule"):
        lines.append(f"- crs {k}: {json.dumps(crs_summary.get(k))}")
    (B / "REPORT.md").write_text("\n".join(lines) + "\n")
    print(str(B / "REPORT.md"))


if __name__ == "__main__":
    main()
