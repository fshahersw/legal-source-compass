"""State prejudgment and post-judgment interest rates, only where an official state statute or agency page states the
rate → econ_state_judgment_rates.

Each entry names the provision, the official page it was read from, the exact words that state the rate (checked
against the captured page: response bytes kept unchanged as .raw, the plain-text rendering every quote is checked
against as .txt), the rate as stated (a fixed rate, the same rate as another provision, or a rate published
periodically by a named official with the current published value and its period where that publication was read),
and the effective date only where the page states one. Every other state, and every rate a page does not state, is
"Not recorded" in the app. Sources that refused this environment (California, New York and New Jersey answered 403;
Illinois' certificate chain did not verify) are listed in the summary and not used.

  python3 -I -B scripts/api_econ/build_state_rates.py --acquire
  python3 -I -B scripts/api_econ/build_state_rates.py
"""
from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import econ_common as ec  # noqa: E402

DATASET = "econ_state_judgment_rates"
RAW = ec.ACQ / "state_rates"

SOURCES = {
    "ma_231_6b": "https://malegislature.gov/Laws/GeneralLaws/PartIII/TitleII/Chapter231/Section6B",
    "ma_231_6c": "https://malegislature.gov/Laws/GeneralLaws/PartIII/TitleII/Chapter231/Section6C",
    "ma_235_8": "https://malegislature.gov/Laws/GeneralLaws/PartIII/TitleII/Chapter235/Section8",
    "fl_55_03": "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0055/Sections/0055.03.html",
    "tx_occc_letter": "https://occc.texas.gov/wp-content/uploads/2026/09/09-16-2026.pdf",
    "tx_occc_page": "https://occc.texas.gov/publications/interest-rates",
}

# state, kind, provision, source key, exact quote (whitespace-normalised), rate fields
ENTRIES = [
    {"state": "MA", "kind": "prejudgment", "applies_to": "Tort actions: personal injury, consequential damages and property damage",
     "provision": "Mass. Gen. Laws ch. 231, § 6B", "source": "ma_231_6b",
     "quote": "there shall be added by the clerk of court to the amount of damages interest thereon at the rate of twelve per cent per annum from the date of commencement of the action",
     "rate_type": "fixed", "rate_percent": "12", "accrues_from": "Commencement of the action"},
    {"state": "MA", "kind": "prejudgment", "applies_to": "Contract actions",
     "provision": "Mass. Gen. Laws ch. 231, § 6C", "source": "ma_231_6c",
     "quote": "at the contract rate, if established, or at the rate of twelve per cent per annum from the date of the breach or demand",
     "rate_type": "fixed", "rate_percent": "12", "accrues_from": "Breach or demand (contract rate if established)"},
    {"state": "MA", "kind": "postjudgment", "applies_to": "Every judgment for the payment of money",
     "provision": "Mass. Gen. Laws ch. 235, § 8", "source": "ma_235_8",
     "quote": "Every judgment for the payment of money shall bear interest from the day of its entry at the same rate per annum as provided for prejudgment interest in such award, report, verdict or finding.",
     "rate_type": "same_as_prejudgment", "rate_percent": None, "accrues_from": "Entry of judgment"},
    {"state": "FL", "kind": "postjudgment", "applies_to": "Judgments and decrees (unless a written contract or obligation sets a rate)",
     "provision": "Fla. Stat. § 55.03", "source": "fl_55_03",
     "quote": "the Chief Financial Officer shall set the rate of interest that shall be payable on judgments or decrees for the calendar quarter beginning January 1 and adjust the rate quarterly on April 1, July 1, and October 1 by averaging the discount rate of the Federal Reserve Bank of New York for the preceding 12 months, then adding 400 basis points to the averaged federal discount rate.",
     "rate_type": "published_periodically", "rate_percent": None, "publisher": "Florida Chief Financial Officer (quarterly)",
     "accrues_from": "Entry of judgment"},
    {"state": "TX", "kind": "postjudgment", "applies_to": "Money judgments of Texas courts",
     "provision": "Tex. Fin. Code § 304.003", "source": "tx_occc_letter",
     "quote": "Postjudgment Interest Rate - Sec. 304.003, TEX. FIN. CODE 10/01/26-10/31/26 6.75% 6.75%",
     "rate_type": "published_periodically", "rate_percent": "6.75", "publisher": "Texas Consumer Credit Commissioner (monthly, Texas Credit Letter)",
     "effective_from": "2026-10-01", "effective_to": "2026-10-31", "accrues_from": "Entry of judgment",
     "note": "The rate stated is the one published for October 2026 (Texas Credit Letter, Vol. 46, No. 12, September 16, 2026); later months are published by the Commissioner and are not recorded here until read."},
]
REFUSED = {
    "CA": "leginfo.legislature.ca.gov answered HTTP 403",
    "NY": "www.nysenate.gov answered HTTP 403",
    "NJ": "www.njcourts.gov answered HTTP 403",
    "IL": "www.ilga.gov: TLS certificate chain did not verify; not fetched",
}


def text_of(raw: bytes, url: str) -> str:
    if url.endswith(".pdf"):
        tmp = RAW / "_tmp.pdf"
        tmp.write_bytes(raw)
        out = subprocess.run(["pdftotext", "-layout", str(tmp), "-"], capture_output=True, text=True, check=True).stdout
        tmp.unlink()
        return out
    t = raw.decode("utf-8", errors="replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", t, flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", t))


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def acquire() -> None:
    http = ec.Http(min_interval=2.0)
    manifest = RAW / "_manifest.jsonl"
    for key, url in SOURCES.items():
        body = http.get(url)
        ext = ".pdf" if url.endswith(".pdf") else ".html"
        ec.save_raw(RAW / f"{key}{ext}.raw", body, url, manifest)
        (RAW / f"{key}.txt").write_text(text_of(body, url))
    print(json.dumps({"captured": len(SOURCES)}))


def build() -> tuple[list[dict], list[dict], dict]:
    manifest = {}
    for line in (RAW / "_manifest.jsonl").read_text().splitlines():
        e = json.loads(line)
        manifest[e["url"]] = e
    rows = []
    for e in ENTRIES:
        url = SOURCES[e["source"]]
        text = norm((RAW / f"{e['source']}.txt").read_text())
        if norm(e["quote"]) not in text:
            raise SystemExit(f"{e['state']} {e['provision']}: quote not found in the captured page {url}")
        cap = manifest[ec.redact(url)]
        rate = (f"{e['rate_percent']}% per year" if e.get("rate_percent") else
                "Same rate as the prejudgment interest in the award" if e["rate_type"] == "same_as_prejudgment" else ec.NOT_RECORDED)
        period = (f"{e['effective_from']} to {e['effective_to']}" if e.get("effective_from") else ec.NOT_RECORDED)
        rid = f"rate:{e['state']}:{e['kind']}:{re.sub(r'[^a-z0-9]+', '-', e['provision'].lower()).strip('-')}"
        facts = [
            ["State", e["state"]], ["Kind", "Prejudgment interest" if e["kind"] == "prejudgment" else "Post-judgment interest"],
            ["Applies to", e["applies_to"]], ["Provision", e["provision"]], ["Rate", rate],
            ["Rate set by", e.get("publisher") or "The statute"], ["Rate period", period],
            ["Interest runs from", e.get("accrues_from") or ec.NOT_RECORDED],
            ["Effective date of the provision", e.get("provision_effective") or ec.NOT_RECORDED],
            ["As stated", e["quote"]], ["Read from", f"{url} (retrieved {cap['retrieved_at'][:10]}, sha256 {cap['sha256'][:16]}…)"],
        ]
        if e.get("note"):
            facts.append(["Note", e["note"]])
        rows.append(ec.record(
            DATASET, rid, f"{e['state']} {('prejudgment' if e['kind'] == 'prejudgment' else 'post-judgment')} interest: {e['provision']}",
            source_url=url, subtitle=f"{rate} · {e['applies_to']}", state=e["state"],
            cells={"state": e["state"], "kind": e["kind"], "provision": e["provision"], "rate": rate, "period": period,
                   "applies_to": e["applies_to"]},
            facts=facts, text=f"judgment interest rate {e['state']} {e['provision']} {e['applies_to']}",
            filters={"kind": [e["kind"]], "rate_type": [e["rate_type"]], "state": [e["state"]]},
            links=[{"url": url, "label": "Official source"}, {"url": f"/places/{e['state']}", "label": "State page"}],
            extra={"kind": "judgment_rate", "rate": {k: e.get(k) for k in ("state", "kind", "applies_to", "provision", "rate_type",
                                                                          "rate_percent", "publisher", "effective_from", "effective_to",
                                                                          "accrues_from", "quote", "note")} | {"source_url": url,
                                                                          "retrieved_at": cap["retrieved_at"], "sha256": cap["sha256"]}},
        ))
    inputs = [{"url": v["url"], "path": v["path"], "sha256": v["sha256"]} for v in manifest.values()]
    return rows, inputs, {"refused_sources": REFUSED}


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acquire", action="store_true")
    ap.add_argument("--out", default=str(ec.BUILD / "state_rates"))
    a = ap.parse_args(argv)
    if a.acquire:
        acquire()
        return
    rows, inputs, extra = build()
    ec.write_build(
        Path(a.out), DATASET, "State judgment interest rates stated in official statutes and agency publications (framework; states without a cited rate are not recorded)",
        ec.listing([("state", "State"), ("kind", "Kind"), ("provision", "Provision"), ("rate", "Rate"), ("period", "Rate period"), ("applies_to", "Applies to")],
                   [("kind", "Kind", {"prejudgment": "Prejudgment", "postjudgment": "Post-judgment"})]),
        {"method": "Official legislature and agency pages captured unchanged (.raw) with a plain-text rendering (.txt); every stated rate is a literal quote found in that rendering.",
         "coverage": f"{len({r['state'] for r in rows})} states with at least one cited rate; every other state is Not recorded.",
         "terms": "State statutes and agency publications are public records.", **extra},
        rows, inputs)


if __name__ == "__main__":
    main(sys.argv[1:])
