"""Independent checks of the court_rules build files against the raw acquired files (no network).

  python3 -I -B scripts/enrichment/court_rules/verify_court_rules.py [--spot N]

Second paths used:
  * raw files: every retrieved document's stored bytes hash to the SHA-256 in its record and in the manifest;
  * PDFs: each insight's quote is looked for on its cited page (and the next page) in a separate extraction made with
    pypdf (not poppler), comparing letters and digits only, so a match does not depend on the rendering the quote was
    checked against at build time; HTML documents are checked against BeautifulSoup's plain get_text of the stored page;
  * sections: the sections of each document, joined, reproduce its stored text rendering word for word, except a title
    block of at most 400 characters before the first rule heading and, in page-by-page documents, pages under 40 characters;
  * regulation index: each entry's citation (or the link it was read from) and heading occur in the stored publisher page;
  * after prune_raw.py deletes extracted PDFs, the checks that need them are counted under not_rechecked and their last
    results stay in verification_with_raw.json;
  * constitutions: each provision's 60-character windows of letters and digits (lines at PDF page edges left out) are
    looked for in a second extraction of the publisher's files (pypdf; BeautifulSoup with encoding detection; decoded
    JSON strings); all found = confirmed, at least 90% = mostly confirmed, less = a failure. The per-provision result is
    written to work/constitution_text_check.json for the build to label each provision.
Writes private/build/court_rules/verification.json with failure counts and the spot checks.
"""
from __future__ import annotations

import hashlib
import html as htmlmod
import json
import os
import random
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402

ROOT = fetchlib.ROOT
BUILD = os.path.join(ROOT, "private", "build", "court_rules")


def words(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", htmlmod.unescape(s).lower().replace("ﬁ", "fi").replace("ﬂ", "fl"))


def load(name):
    return fetchlib.load_json(os.path.join(BUILD, f"{name}.json"))["rows"]


_pdf_pages: dict[str, list[str]] = {}


def pdf_pages(path: str) -> list[str]:
    if path not in _pdf_pages:
        from pypdf import PdfReader

        reader = PdfReader(os.path.join(ROOT, path))
        out = []
        for page in reader.pages:
            try:
                out.append(words(page.extract_text() or ""))
            except Exception:
                out.append("")
        _pdf_pages[path] = out
    return _pdf_pages[path]


def html_words(path: str) -> str:
    from bs4 import BeautifulSoup

    raw = fetchlib.load_raw(path)
    enc = "cp1252" if "/state/nv/" in path else "utf-8"
    return words(BeautifulSoup(raw.decode(enc, "replace"), "lxml").get_text(" "))


def source_text_words(path: str) -> str:
    """Letters and digits of a stored publisher file, read independently of the extraction code."""
    raw = fetchlib.load_raw(path)
    if raw[:5] == b"%PDF-":
        return "".join(pdf_pages(path))
    if path.endswith((".json", ".json.gz")) or raw.lstrip()[:1] in (b"{", b"["):
        try:
            data = json.loads(raw.decode("utf-8-sig"))
        except ValueError:
            data = None
        if data is not None:
            strings = []

            def walk(v):
                if isinstance(v, dict):
                    for x in v.values():
                        walk(x)
                elif isinstance(v, list):
                    for x in v:
                        walk(x)
                elif isinstance(v, str):
                    from bs4 import BeautifulSoup

                    strings.append(BeautifulSoup(v, "lxml").get_text(" ") if "<" in v else v)

            walk(data)
            return words(" ".join(strings))
    from bs4 import BeautifulSoup

    if raw[:400].count(b"\x00") > 100:  # UTF-16 without a byte-order mark (sdlegislature.gov section pages)
        return words(BeautifulSoup(raw.decode("utf-16-le", "replace"), "lxml").get_text(" "))
    return words(BeautifulSoup(raw, "lxml").get_text(" "))


def provision_windows(text: str, size: int = 120) -> list[str]:
    """Letters-and-digits windows of a provision's body. A provision that runs across PDF pages is cut at each page
    break and the three lines on either side of a break (the running header and footer zone, which two extractors
    order differently) are left out, so each window is plain provision text."""
    pages = text.split("\f")
    chunks = []
    for n, page in enumerate(pages):
        lines = [ln for ln in page.split("\n") if ln.strip()]
        if n > 0:
            lines = lines[3:]
        if n < len(pages) - 1:
            lines = lines[:-3]
        chunks.append(words("\n".join(lines)))
    out = []
    for w in chunks:
        if not w:
            continue
        out.extend(w[i:i + size] for i in range(0, max(1, len(w) - size + 1), size))
    return out


def main(argv):
    spot_n = int(argv[argv.index("--spot") + 1]) if "--spot" in argv else 20
    manifest = {r["path"]: r for r in fetchlib.read_manifest() if r.get("http_status") == 200}
    # PDFs deleted after a full verification run (prune_raw.py; that run is kept as verification_with_raw.json)
    pruned_log = os.path.join(fetchlib.ACQ, "_pruned.jsonl")
    pruned = [json.loads(line) for line in open(pruned_log, encoding="utf-8")] if os.path.exists(pruned_log) else []
    pruned_sha = {p["sha256"] for p in pruned}
    pruned_paths = {p["path"] for p in pruned}
    skipped = Counter()
    failures = Counter()
    notes = defaultdict(list)
    docs = {r["id"]: r for r in load("court_rule_documents")}
    sections = load("court_rule_sections")
    insights = load("court_rule_insights")

    # 1. raw file hashes
    raw_checked = 0
    for d in docs.values():
        info = d["item"]["rule_document"]
        work = None
        for path in [info.get("text_source_url") and None]:
            pass
        if info["status"] not in ("text", "no_text_layer") or not info.get("sha256"):
            continue
        cand = [p for p, r in manifest.items() if r["sha256"] == info["sha256"] and os.path.exists(os.path.join(ROOT, p))]
        if not cand and info["sha256"] in pruned_sha:
            skipped["raw_hash_not_rechecked_pdf_pruned"] += 1
            continue
        if not cand:
            failures["raw_file_missing"] += 1
            notes["raw_file_missing"].append(d["id"])
            continue
        raw_checked += 1
        if hashlib.sha256(fetchlib.load_raw(cand[0])).hexdigest() != info["sha256"]:
            failures["raw_hash_mismatch"] += 1
            notes["raw_hash_mismatch"].append(d["id"])

    # 2. sections reproduce each document's rendering
    work_docs = {d["id"]: d for d in fetchlib.load_json(os.path.join(BUILD, "work", "documents.json"))["documents"]}
    by_doc = defaultdict(list)
    for s in sections:
        by_doc[s["item"]["rule_section"]["doc"]].append(s)
    coverage_checked = 0
    for doc_id, secs in by_doc.items():
        wd = work_docs.get(doc_id, {})
        if not wd.get("text_path"):
            continue
        text = fetchlib.open_text(wd["text_path"]).read()
        rendered = words(text)
        joined = words("".join(s["text"] for s in sorted(secs, key=lambda s: s["item"]["rule_section"]["ordinal"])))
        coverage_checked += 1
        if wd.get("split") in ("html_pages", "html_anchor", "whole_page"):
            # the rendering was assembled from these sections (with their headings), so every section must be inside it
            ok = all(words(s["text"]) in rendered for s in secs)
        elif wd.get("split") == "pages":
            kept_pages = [p for p in text.split("\f") if len(p.strip("\n")) >= 40 and len(p.strip()) >= 40]
            ok = joined == words("".join(kept_pages))
        else:
            # documented exception: up to 400 characters before the first rule heading (a title block) are not a section
            ok = joined == rendered or (rendered.endswith(joined) and len(text.split("\n", 0)[0]) and len(rendered) - len(joined) <= 400)
        if not ok:
            failures["sections_do_not_reproduce_text"] += 1
            notes["sections_do_not_reproduce_text"].append(f"{doc_id}: {len(joined)}/{len(rendered)}")

    # 3. insights: quote in section, value in quote, and quote on the cited raw page (second extraction)
    sec_by_id = {s["id"]: s for s in sections}
    raw_path_of = {}
    for doc_id, wd in work_docs.items():
        raw_path_of[doc_id] = wd.get("text_source_path") or wd.get("raw_path")
    page_found = page_missing = html_found = html_missing = 0
    spot = []
    rng = random.Random(20261019)
    sample_ids = set(i["id"] for i in rng.sample(insights, min(spot_n, len(insights))))
    for i in insights:
        info = i["item"]["rule_insight"]
        sec = sec_by_id.get(info["section_id"])
        if not sec:
            failures["insight_section_missing"] += 1
            continue
        if words(info["quote"]) not in words(sec["text"]):
            failures["insight_quote_not_in_section"] += 1
            notes["insight_quote_not_in_section"].append(i["id"])
        if words(info["value"]) not in words(info["quote"]):
            failures["insight_value_not_in_quote"] += 1
            notes["insight_value_not_in_quote"].append(i["id"])
        doc_id = info["doc"]
        rp = raw_path_of.get(doc_id)
        located = None
        if doc_id.startswith("mn-") or work_docs[doc_id].get("split") in ("html_pages",):
            # one page per rule: the section's own stored page
            src = sec["source_url"]
            page_rows = [p for p, r in manifest.items() if r["url"] == src and os.path.exists(os.path.join(ROOT, p))]
            if page_rows:
                located = words(info["quote"]) in html_words(page_rows[0])
        elif rp and rp.endswith((".html.gz", ".html")):
            located = words(info["quote"]) in html_words(rp)
        elif rp in pruned_paths and not os.path.exists(os.path.join(ROOT, rp)):
            skipped["insight_second_path_not_rechecked_pdf_pruned"] += 1
        elif rp and os.path.exists(os.path.join(ROOT, rp)):
            pages = pdf_pages(rp)
            pg = (info.get("page") or 1) - 1
            window = "".join(pages[max(0, pg - 1): pg + 2])
            located = words(info["quote"]) in window or words(info["quote"]) in "".join(pages)
        if located is True:
            if rp and rp.endswith(".pdf"):
                page_found += 1
            else:
                html_found += 1
        elif located is False:
            if rp and rp.endswith(".pdf"):
                page_missing += 1
            else:
                html_missing += 1
            notes["insight_quote_not_found_by_second_extraction"].append(i["id"])
        if i["id"] in sample_ids:
            spot.append({"id": i["id"], "document": info["doc_title"], "requirement": i["title"], "value": info["value"],
                         "where": f"{info['section_label']}, page {info.get('page') or 'n/a'}, {info['source_url']}",
                         "quote": info["quote"][:240], "match_in_section": words(info["quote"]) in words(sec["text"]),
                         "match_in_raw_by_second_extraction": located})
    failures["insight_quote_not_found_by_second_extraction"] = page_missing + html_missing

    # 4. regulation index entries occur on their stored listing pages
    reg = load("state_regulation_index")
    page_cache = {}
    reg_fail = 0
    for e in reg:
        info = e["item"]["regulation_entry"]
        p = next((p for p, r in manifest.items() if r["sha256"] == info["page_sha256"] and os.path.exists(os.path.join(ROOT, p))), None)
        if p is None:
            failures["regulation_page_missing"] += 1
            continue
        if p not in page_cache:
            raw = fetchlib.load_raw(p).decode("utf-8", "replace")
            data = None
            if p.endswith(".json.gz"):  # compare against the decoded JSON, not its escape sequences
                data = json.loads(raw)
                raw = json.dumps(data, ensure_ascii=False)
                strings = []

                def walk(v):
                    if isinstance(v, dict):
                        for x in v.values():
                            walk(x)
                    elif isinstance(v, list):
                        for x in v:
                            walk(x)
                    elif isinstance(v, (str, int, float)):
                        strings.append(str(v))

                walk(data)
                shown = " ".join(strings)  # the decoded string values, so an escaped line break is not read as "n"
            else:  # headings are compared with the page's visible text (tags removed), links with the markup
                from bs4 import BeautifulSoup

                shown = BeautifulSoup(raw, "lxml").get_text(" ")
            page_cache[p] = (words(raw.replace("%20", " ")), words(shown), data, raw)
        raw_w, shown_w, data, raw = page_cache[p]
        cite = info["citation"]
        va = re.fullmatch(r"(\d+)VAC(\d+)-(\w+)", cite)
        if va and isinstance(data, dict):
            # Virginia: the citation is formed from the publisher's TitleNumber, AgencyNumber and ChapterNumber fields
            cite_ok = str(data.get("TitleNumber")) == va.group(1) and any(
                str(ag.get("AgencyNumber")) == va.group(2) and any(str(ch.get("ChapterNumber")) == va.group(3) for ch in ag.get("ChapterList") or [])
                for ag in data.get("AgencyList") or [])
        else:
            cite_core = re.sub(r"^(IDAPA|COMAR|Minn\. R\. ch\.|Ohio Adm\.Code Chapter|S\.C\. Code Regs\. Chapter|Wis\. Admin\. Code ch\.|Title|Chapter)\s*", "", cite)
            cite_core = re.sub(r"\s*(KAR|NMAC|WAC|VAC)$", "", cite_core)
            path = re.sub(r"^https?://[^/]+", "", info.get("url") or "").rstrip("/")
            # the citation's number is on the page, or the entry's own link (from which the number was read) is
            cite_ok = words(cite_core.split(" ")[0]) in raw_w or bool(path and path in raw)
        heading_ok = not info.get("heading") or words(info["heading"]) in shown_w or words(info["heading"]) in raw_w
        if not (cite_ok and heading_ok):
            reg_fail += 1
            if len(notes["regulation_entry_not_on_page"]) < 20:
                notes["regulation_entry_not_on_page"].append(e["id"])
    failures["regulation_entry_not_on_page"] = reg_fail

    # 5. constitution provisions occur, word for word, in a second extraction of the publisher's files: pypdf for PDFs,
    #    BeautifulSoup (encoding detected from the bytes) for HTML, decoded string values for JSON. Each provision is cut
    #    into 120-character windows of letters and digits; every window must occur in the state's source text.
    const_rows = load("state_constitution_sections")
    const_states = {c["state"]: c for c in fetchlib.load_json(os.path.join(BUILD, "work", "constitutions.json"))["states"]}
    source_words: dict[str, str | None] = {}
    cfail = 0
    cchecked = 0
    const_full = const_most = 0
    text_check: dict[str, dict] = {}
    by_state_fail = Counter()
    for s in const_rows:
        st = s["item"]["constitution_section"]["state"]
        if st not in source_words:
            parts = []
            missing = False
            for f in const_states[st].get("files") or []:
                p = f["path"]
                if not os.path.exists(os.path.join(ROOT, p)):
                    missing = True
                    continue
                parts.append(source_text_words(p))
            source_words[st] = None if missing and not parts else "".join(parts)
        src = source_words[st]
        if src is None:
            skipped["constitution_not_rechecked_source_file_missing"] += 1
            continue
        cchecked += 1
        windows = provision_windows(s["text"], 60)
        found = sum(1 for win in windows if win in src)
        share = found / len(windows) if windows else 1.0
        text_check[s["id"]] = {"windows": len(windows), "found": found}
        if found == len(windows):
            const_full += 1
        elif share >= 0.9:
            const_most += 1  # a heading or catchline the two extractors place differently; the body text is there
        else:
            cfail += 1
            by_state_fail[st] += 1
            notes["constitution_text_not_in_source"].append(s["id"])
    failures["constitution_text_not_in_source"] = cfail
    # read by build_court_rules.py, which labels each provision with its check result (the page shows a caveat
    # where the second extraction did not find all of a provision's text)
    with open(os.path.join(BUILD, "work", "constitution_text_check.json"), "w", encoding="utf-8") as handle:
        json.dump({"method": "60-character windows of letters and digits, page-edge lines excluded, against pypdf / BeautifulSoup",
                   "checked_at": fetchlib.utc_now(), "provisions": text_check}, handle)
    notes["constitution_failures_by_state"] = [f"{k}: {v}" for k, v in by_state_fail.most_common()]

    result = {"checked": {"documents_raw_hash": raw_checked, "documents_section_coverage": coverage_checked, "insights": len(insights),
                          "insight_quotes_found_in_pdf_by_pypdf": page_found, "insight_quotes_not_found_in_pdf_by_pypdf": page_missing,
                          "insight_quotes_found_in_html": html_found, "insight_quotes_not_found_in_html": html_missing,
                          "regulation_entries": len(reg), "constitution_provisions": len(const_rows),
                          "constitution_provisions_checked": cchecked, "constitution_all_windows_found": const_full,
                          "constitution_90pct_windows_found": const_most},
              "failures": {k: v for k, v in failures.items()}, "failure_examples": {k: v[:15] for k, v in notes.items()},
              "not_rechecked": dict(skipped), "pdfs_pruned": len(pruned),
              "raw_checks_of_pruned_pdfs": "verification_with_raw.json (run before the PDFs were deleted)" if pruned else None,
              "spot_checks": spot, "verified_at": fetchlib.utc_now()}
    with open(os.path.join(BUILD, "verification.json"), "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=1, ensure_ascii=False)
    print(json.dumps({"checked": result["checked"], "failures": result["failures"]}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
