import hashlib
import json
import pathlib
import re
import sys

from pypdf import PdfReader
import pdfplumber

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "private/audit-2026-10-05/full-state-codes/wa")
manifest_path = root / "complete-title-pdfs-20261005/text-v4-pypdf/extraction-manifest.json"
manifest_bytes = manifest_path.read_bytes()
manifest = json.loads(manifest_bytes)
selected = [("1", None), ("4", "4.16.080"), ("26", None)]
results = []
for title_id, target in selected:
    item = next(row for row in manifest["results"] if row["titleId"] == title_id)
    raw_path = pathlib.Path(item["rawPath"])
    raw = raw_path.read_bytes()
    raw_hash = hashlib.sha256(raw).hexdigest()
    if len(raw) != item["rawBytes"] or raw_hash != item["rawSha256"]:
        raise ValueError(f"raw PDF integrity mismatch: title {title_id}")
    corrected_text = pathlib.Path(item["textPath"]).read_text(encoding="utf-8")
    corrected_hash = hashlib.sha256(corrected_text.encode("utf-8")).hexdigest()
    if corrected_hash != item["textSha256"]:
        raise ValueError(f"corrected pypdf derivative integrity mismatch: title {title_id}")
    legacy_path = root / "complete-title-pdfs-20261005/text-v2-with-title1/text" / f"complete-title-{title_id}.txt"
    legacy_text = legacy_path.read_text(encoding="utf-8")
    legacy_pages = legacy_text.split("\n\n")
    corrected_pages = corrected_text.split("\n\n\f\n\n")
    parsed = PdfReader(str(raw_path))
    pypdf_pages = [(page.extract_text() or "") for page in parsed.pages]
    hit_pages = [i for i, text in enumerate(pypdf_pages) if target and re.search(rf"\bRCW\s+{re.escape(target)}\s+Actions limited to three years\.", text)]
    sample_index = hit_pages[0] if hit_pages else min(1, len(pypdf_pages) - 1)
    with pdfplumber.open(raw_path) as pdf:
        plumber_text = pdf.pages[sample_index].extract_text(layout=True) or ""
    sample_texts = {
        "legacy_pdfjs_page": re.sub(r"\s+", " ", legacy_pages[sample_index]).strip()[:700],
        "corrected_pypdf_page": re.sub(r"\s+", " ", corrected_pages[sample_index]).strip()[:700],
        "independent_pdfplumber_layout": re.sub(r"\s+", " ", plumber_text).strip()[:700],
    }
    results.append({
        "titleId": title_id,
        "sourceUrl": item["sourceUrl"],
        "rawPath": item["rawPath"],
        "rawBytes": len(raw),
        "rawSha256": raw_hash,
        "correctedPypdfTextSha256": corrected_hash,
        "pypdfVersion": __import__("pypdf").__version__,
        "pdfplumberVersion": __import__("pdfplumber").__version__,
        "pypdfPages": len(pypdf_pages),
        "correctedPages": item["pdfPages"],
        "pageOrder": "explicit ascending PDF page index, 1 through N",
        "independentPypdfChars": sum(map(len, pypdf_pages)),
        "correctedTextChars": item["textChars"],
        "targetCitation": target,
        "targetBodyHeadingPages": [i + 1 for i in hit_pages],
        "samplePage": sample_index + 1,
        "sampleTexts": sample_texts,
    })

out = {"schemaVersion": 1, "scope": "Independent text-layout comparison for retained Title 1, Title 4 (RCW 4.16.080 body heading), and Title 26; sample pages are not a statewide fidelity proof.", "manifestPath": str(manifest_path), "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "results": results}
dest = root / "complete-title-pdfs-20261005/text-v4-pypdf/independent-extractor-comparison-v3.json"
with dest.open("x", encoding="utf-8", newline="\n") as handle:
    handle.write(json.dumps(out, indent=2) + "\n")
print(json.dumps({"output": str(dest), "titles": [{k: v for k, v in row.items() if k not in ("sampleTexts",)} for row in results]}, indent=2))
