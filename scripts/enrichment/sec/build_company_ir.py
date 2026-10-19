"""Build company_sec_ir_documents: earnings releases, results presentations and other EX-99 exhibits the registrants filed
with 8-K Item 2.02 or 7.01 reports since 2023-10-01 (at most the 12 latest such 8-Ks per registrant).

Text: HTML exhibits are converted to text; PDF exhibits through pdftotext; an exhibit whose PDF has no text layer is
transcribed page by page from images by a vision model (at most 8 pages, marked as transcribed). Earnings releases from the
four latest Item 2.02 filings per registrant get figures read by a small model; only verbatim-quoted figures are kept
(ir_docs.validate_extraction) and revenue, net income and diluted EPS are compared with the XBRL value of the same quarter.
Transcripts are listed only where the company filed one as an exhibit.

    python3 -I -B scripts/enrichment/sec/build_company_ir.py
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import build_company_statements as bcs  # noqa: E402
import corpus_writer as cw  # noqa: E402
import ir_docs as ir  # noqa: E402
import llm  # noqa: E402
import sec_http as h  # noqa: E402

BUILD = h.ROOT / "private" / "build" / "sec_statements"
SINCE = "2023-10-01"
PER_COMPANY = 12
EXTRACT_LATEST = 4
TEXT_LIMIT = 60000
OCR_PAGES = 8


def pdf_text(data: bytes) -> tuple[str, bool]:
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "doc.pdf")
        Path(src).write_bytes(data)
        out = subprocess.run(["pdftotext", "-layout", src, "-"], capture_output=True, timeout=120)
        text = out.stdout.decode("utf-8", errors="replace")
        pages = max(1, text.count("\f"))
        if len(text.strip()) / pages >= 200:
            return re.sub(r"[ \t]+", " ", text).strip(), False
        subprocess.run(["pdftoppm", "-r", "90", "-png", "-l", str(OCR_PAGES), src, os.path.join(tmp, "p")], capture_output=True, timeout=180)
        parts = []
        for name in sorted(f for f in os.listdir(tmp) if f.startswith("p") and f.endswith(".png")):
            img = base64.b64encode(Path(tmp, name).read_bytes()).decode()
            answer = vision_page(img)
            if answer:
                parts.append(answer)
        return "\n\n".join(parts), True


def vision_page(png_b64: str) -> str | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    digest = hashlib.sha256(png_b64.encode()).hexdigest()
    cache = llm.CACHE / f"ocr-{digest}.json"
    if cache.exists():
        return json.loads(cache.read_text())["text"]
    import urllib.request

    body = json.dumps({"model": llm.MODEL, "max_tokens": 3000, "messages": [{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": png_b64}},
        {"type": "text", "text": "Transcribe all text on this page exactly as written, keeping table rows on separate lines. Output only the text."}]}]}).encode()
    request = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST",
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode())
    except Exception:  # noqa: BLE001 - page left out, counted by the caller
        return None
    text = "".join(b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text").strip()
    llm.CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"text": text}))
    return text


def exhibit_text(url: str) -> tuple[str, bool]:
    data = h.get(url, kind="ir_exhibits", suffix=os.path.splitext(url)[1] or ".htm", compress=True, timeout=180)
    if not data:
        return "", False
    if url.lower().endswith(".pdf"):
        return pdf_text(data)
    if url.lower().endswith(".txt"):
        return data.decode("utf-8", errors="replace"), False
    return bcs.html_text(data), False


def company_docs(result: dict) -> list[dict]:
    cik = result["cik"]
    eligible = [f for f in result["filings"] if f["form"] in ("8-K", "8-K/A") and f["date"] >= SINCE and re.search(r"\b(2\.02|7\.01)\b", f.get("items") or "")]
    eligible = sorted(eligible, key=lambda f: f["date"], reverse=True)[:PER_COMPANY]
    docs = []
    for f in eligible:
        index = h.get(f["index_url"], kind="filing_index_html", suffix=".htm", compress=True)
        if not index:
            continue
        for row in ir.exhibit_rows(index.decode("utf-8", errors="replace")):
            if not ir.is_exhibit_99(row):
                continue
            url = "https://www.sec.gov" + row["href"] if row["href"].startswith("/") else row["href"]
            if not url.startswith("https://www.sec.gov/Archives/"):
                continue
            text, transcribed = exhibit_text(url)
            docs.append({"cik": cik, "accn": f["accn"], "date": f["date"], "items": f["items"], "form": f["form"], "index_url": f["index_url"],
                         "exhibit": row["type"], "description": row["description"] or row["document"], "document": row["document"], "url": url,
                         "doc_type": ir.document_type(f["items"], row, text), "text": text, "transcribed": transcribed})
    return docs


def extract(doc: dict, quarters: list[dict], lines: dict) -> dict | None:
    text = doc["text"][:40000]
    if len(text) < 500:
        return None
    answer = llm.ask_json(ir.KPI_SYSTEM, f"Company filing date: {doc['date']}\n\n{text}", max_tokens=2500)
    out = ir.validate_extraction(answer, text)
    if not out:
        return None
    qi = ir.quarter_for(out["period_end"], doc["date"], quarters)
    checks = {}
    for key, tol in (("revenue", 0.005), ("net_income", 0.01), ("eps_diluted", 0.011)):
        cell = (lines.get(key) or {}).get("quarterly", [None] * len(quarters))[qi] if qi is not None else None
        reported = cell[0] if cell else None
        extracted = ir.amount(out[key]) if key != "eps_diluted" else (float(out[key]["value"]) if out.get(key) else None)
        checks[key] = {"status": ir.xbrl_check(extracted, reported, tol, ir.rounding_step(out.get(key))), "xbrl": reported,
                       "extracted": extracted, "xbrl_accn": cell[1] if cell else None, "derived": bool(cell and cell[3] == 1)}
    out["xbrl_quarter"] = quarters[qi] if qi is not None else None
    out["xbrl_checks"] = checks
    return out


def main():
    t0 = time.time()
    results = json.loads((BUILD / "raw_results.json").read_text())
    with ThreadPoolExecutor(max_workers=6) as pool:
        per = list(pool.map(company_docs, results))
    docs = [d for group in per for d in group]
    by_company = {r["cik"]: r for r in results}
    targets = []
    for cik in {d["cik"] for d in docs}:
        releases = sorted([d for d in docs if d["cik"] == cik and d["doc_type"] == "earnings_release" and "2.02" in d["items"]], key=lambda d: d["date"], reverse=True)
        targets += releases[:EXTRACT_LATEST]

    def run(doc):
        r = by_company[doc["cik"]]
        s = r.get("statements") or {}
        try:
            doc["extraction"] = extract(doc, s.get("quarterly_periods") or [], s.get("lines") or {})
        except Exception as error:  # noqa: BLE001 - recorded on the document
            doc["extraction"] = None
            doc["extraction_error"] = str(error)[:200]
        return doc

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(run, targets))
    retrieved = time.strftime("%Y-%m-%d", time.gmtime())
    rows = []
    for d in docs:
        p = by_company[d["cik"]]["profile"]
        text = d["text"][:TEXT_LIMIT]
        label = {"earnings_release": "Earnings release", "presentation": "Presentation", "transcript": "Transcript", "other": "Exhibit"}[d["doc_type"]]
        ex = d.get("extraction")
        rid = f"{d['cik']}:{d['accn']}:{re.sub(r'[^A-Za-z0-9.]', '', d['exhibit'])}:{hashlib.sha1(d['url'].encode()).hexdigest()[:6]}"
        rows.append(cw.record(
            "company_sec_ir_documents", rid, f"{p['name']}: {d['description']} ({d['date']})", source_url=d["url"],
            subtitle=f"{label} · {d['exhibit']} to Form {d['form']} (Item {d['items']}) filed {d['date']}" + (" · transcribed from page images" if d["transcribed"] else ""),
            cells={"company": p["name"], "date": d["date"], "type": label, "exhibit": d["exhibit"], "description": d["description"][:200],
                   "chars": len(d["text"]), "figures": "yes" if ex else "no"},
            facts=[["Company", p["name"]], ["Filed", d["date"]], ["Form", f"{d['form']} (items {d['items']})"], ["Exhibit", d["exhibit"]],
                   ["Document type", label], ["Text", f"{len(d['text']):,} characters" + (" (first 60,000 kept)" if len(d['text']) > TEXT_LIMIT else "") + (", transcribed from page images" if d["transcribed"] else "")],
                   ["Figures", "Read from the text by a model; only figures whose quoted passage appears word for word are kept, and revenue, net income and diluted EPS are compared with the XBRL value for the same quarter" if ex else "Not extracted"],
                   ["Source", f"SEC EDGAR filing exhibit, retrieved {retrieved}"]],
            text=text[:4000],
            filters={"type": [d["doc_type"]], "cik": [d["cik"]]},
            links=[{"url": d["url"], "label": f"{d['exhibit']} on sec.gov"}, {"url": d["index_url"], "label": "Filing index"}, {"url": f"/companies/{d['cik']}", "label": "Company profile"}],
            extra={"profile": {"kind": "ir_document", "cik": d["cik"], "company": p["name"], "accn": d["accn"], "date": d["date"], "form": d["form"], "items": d["items"],
                               "exhibit": d["exhibit"], "description": d["description"], "document": d["document"], "doc_type": d["doc_type"], "url": d["url"],
                               "index_url": d["index_url"], "chars": len(d["text"]), "truncated": len(d["text"]) > TEXT_LIMIT, "transcribed": d["transcribed"],
                               "extraction": ex},
                   "document_text": text}))
    spec = {"dataset": "company_sec_ir_documents", "label": "Earnings releases, presentations and other 8-K exhibits filed with the SEC", "rows": rows,
            "listing_block": cw.listing([("company", "Company"), ("date", "Filed"), ("type", "Type"), ("exhibit", "Exhibit"), ("description", "Description"), ("figures", "Figures")],
                                        [("type", "Type", {"earnings_release": "Earnings release", "presentation": "Presentation", "transcript": "Transcript", "other": "Other exhibit"})]),
            "summary": {"source": "SEC EDGAR 8-K filings (Items 2.02 and 7.01) and their EX-99 exhibits", "since": SINCE,
                        "totals": {"records": len(rows), "by_type": dict(Counter(d["doc_type"] for d in docs)),
                                   "extracted": sum(1 for d in docs if d.get("extraction")), "transcribed": sum(1 for d in docs if d["transcribed"])}},
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputs": [{"url": "https://www.sec.gov/Archives/edgar/data/", "path": "private/acq/sec-companies/ir_exhibits", "sha256": hashlib.sha256("".join(sorted(d["url"] for d in docs)).encode()).hexdigest()}]}
    path = BUILD / "company_sec_ir_documents.json"
    path.write_text(json.dumps(spec, ensure_ascii=False, sort_keys=True, default=str))
    checks = Counter(f"{k}:{v['status']}" for d in docs if d.get("extraction") for k, v in d["extraction"]["xbrl_checks"].items())
    print("documents", len(rows), dict(Counter(d["doc_type"] for d in docs)), "extracted", sum(1 for d in docs if d.get("extraction")),
          "errors", sum(1 for d in docs if d.get("extraction_error")), "transcribed", sum(1 for d in docs if d["transcribed"]),
          path.stat().st_size // 1024, "KB", f"{time.time() - t0:.0f}s")
    print(sorted(checks.items()))


if __name__ == "__main__":
    main()
