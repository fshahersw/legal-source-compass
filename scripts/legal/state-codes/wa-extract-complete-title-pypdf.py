import hashlib
import json
import pathlib
import re
import sys

from pypdf import PdfReader

wa = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "private/audit-2026-10-05/full-state-codes/wa")
run = wa / "complete-title-pdfs-20261005"
capture = run / "capture-v2"
output = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else run / "text-v4-pypdf"
sha256 = lambda data: hashlib.sha256(data).hexdigest()
receipt_path = capture / "receipt.json"
receipt_bytes = receipt_path.read_bytes()
receipt = json.loads(receipt_bytes)
pilot_path = wa / "capture-pilot-20261005/receipt.json"
pilot_bytes = pilot_path.read_bytes()
pilot = json.loads(pilot_bytes)
plan_path = capture / "capture-plan.json"
plan_bytes = plan_path.read_bytes()
plan = json.loads(plan_bytes)
if receipt.get("planSha256") != sha256(plan_bytes) or receipt.get("storedBodies") != 47 or receipt.get("stopReason") != "transport-error":
    raise ValueError("capture receipt mismatch; expected the preserved 47-PDF stopped pass")
title1 = next((row for row in pilot["results"] if row["id"] == "title-1-complete-pdf"), None)
captured = [row for row in receipt["results"] if row["outcome"] == "captured"]
if not title1 or title1["outcome"] != "captured" or len(captured) != 47:
    raise ValueError("expected the prior Title 1 PDF and 47 new captured PDFs")
rows = [{**title1, "id": "complete-title-1", "titleId": "1", "retainedPriorCapture": True}] + [
    {**row, "titleId": row["id"].removeprefix("complete-title-")}
    for row in captured
]
if len({row["titleId"] for row in rows}) != 48:
    raise ValueError("source set must contain 48 distinct title IDs")
output.mkdir(parents=True, exist_ok=False)
text_dir = output / "text"
text_dir.mkdir()
results = []
for row in rows:
    body = pathlib.Path(row["rawPath"]).read_bytes()
    if len(body) != row["bytes"] or sha256(body) != row["sha256"]:
        raise ValueError(f"raw PDF hash/length mismatch: {row['id']}")
    if not row.get("retainedPriorCapture") and row["outcome"] != "captured":
        raise ValueError(f"PDF was not captured: {row['id']}")
    reader = PdfReader(pathlib.Path(row["rawPath"]))
    page_texts = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        page_texts.append(text)
    if len(page_texts) != len(reader.pages):
        raise ValueError(f"page sequence mismatch: {row['id']}")
    text_bytes = ("\n\n\f\n\n".join(page_texts)).encode("utf-8")
    text_path = text_dir / f"{row['id']}.txt"
    with text_path.open("xb") as handle:
        handle.write(text_bytes)
    page_metrics = []
    for number, text in enumerate(page_texts, start=1):
        page_metrics.append({
            "page": number,
            "chars": len(text.strip()),
            "hasText": bool(text.strip()),
            "replacementChars": text.count("\ufffd"),
            "controlChars": len(re.findall(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text)),
        })
    normalized = "\n".join(page_texts)
    footer_dates = re.findall(r"Certified\s+on\s+(\d{1,2}/\d{1,2}/\d{4})", normalized, flags=re.I)
    footer_counts = {}
    for date in footer_dates:
        footer_counts[date] = footer_counts.get(date, 0) + 1
    text_chars = sum(len(text) for text in page_texts)
    citation_count = len(re.findall(r"\bRCW\s+\d+[A-Z]?\.\d+[A-Z]?\.\d+[A-Z]?(?:\.\d+[A-Z]?)?\b", normalized, flags=re.I))
    results.append({
        "id": row["id"], "titleId": row["titleId"], "existingPriorCapture": bool(row.get("retainedPriorCapture")),
        "sourceUrl": row["url"], "finalUrl": row.get("finalUrl"), "rawPath": row["rawPath"], "rawBytes": len(body), "rawSha256": sha256(body),
        "contentType": row.get("contentType"), "sourceLastModified": row.get("lastModified"), "sourceEtag": row.get("etag"),
        "pdfPages": len(reader.pages), "extractedPages": len(page_texts), "pageOrder": "ascending PDF page index, 1 through N",
        "textPath": text_path.as_posix(), "textBytes": len(text_bytes), "textSha256": sha256(text_bytes), "textChars": text_chars,
        "emptyPages": sum(not page["hasText"] for page in page_metrics), "lowTextPagesUnder30Chars": sum(0 < page["chars"] < 30 for page in page_metrics),
        "replacementChars": sum(page["replacementChars"] for page in page_metrics), "controlChars": sum(page["controlChars"] for page in page_metrics),
        "apparentRcwCitationOccurrences": citation_count,
        "footerDateObservations": {"matches": len(footer_dates), "distinctDateCounts": footer_counts},
        "pageMetrics": page_metrics,
    })
    print(json.dumps({"titleId": row["titleId"], "pages": len(page_texts), "chars": text_chars, "emptyPages": sum(not page["hasText"] for page in page_metrics)}))

totals = {
    "pdfs": len(results), "rawBytes": sum(row["rawBytes"] for row in results), "textBytes": sum(row["textBytes"] for row in results),
    "textChars": sum(row["textChars"] for row in results), "pages": sum(row["pdfPages"] for row in results),
    "emptyPages": sum(row["emptyPages"] for row in results), "lowTextPages": sum(row["lowTextPagesUnder30Chars"] for row in results),
    "replacementChars": sum(row["replacementChars"] for row in results), "controlChars": sum(row["controlChars"] for row in results),
    "apparentRcwCitationOccurrences": sum(row["apparentRcwCitationOccurrences"] for row in results),
    "uniqueFooterDates": sorted({date for row in results for date in row["footerDateObservations"]["distinctDateCounts"]}),
}
manifest = {
    "schemaVersion": 1,
    "scope": "Independent pypdf text extraction from the retained Title 1 PDF and 47 successfully captured PDFs in the stopped 2026 WA Complete Title pass. This derivative is not legal completeness/currentness proof.",
    "createdAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "captureReceiptPath": str(receipt_path), "captureReceiptSha256": sha256(receipt_bytes),
    "retainedTitle1ReceiptPath": str(pilot_path), "retainedTitle1ReceiptSha256": sha256(pilot_bytes),
    "extractionLibrary": f"pypdf {__import__('pypdf').__version__}",
    "results": results, "totals": totals,
}
manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
manifest_path = output / "extraction-manifest.json"
with manifest_path.open("xb") as handle:
    handle.write(manifest_bytes)
print(json.dumps({"manifestPath": str(manifest_path), "manifestSha256": sha256(manifest_bytes), "totals": totals}))
