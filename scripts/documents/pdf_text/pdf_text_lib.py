"""Pure helpers of the private PDF full-text extractor (no network, no database).

A PDF is opened from bytes whose SHA-256 the caller has already verified. Every page is classified:
  text         the PDF text layer is used (engine 'pdf-text-layer')
  blank        no text and no meaningful graphics
  ocr_pending  no/near-empty/garbled text layer on a page that carries an image or vector artwork: machine OCR is needed
  ocr_empty    OCR ran and read nothing
A page that was OCR'd is stored as engine 'surya-ocr' with the mean line confidence; a consumer must label it machine OCR.
The staged record is the exact payload of corpus_admin_register_pdf_texts_v1 plus provenance fields the loader strips.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import time
import unicodedata

EXTRACTOR_VERSION = "pdf-text/2"   # v2: U+FFFD dropped from stored text; a page is 'garbled' only above 35% unreadable characters (v1 used 5% and sent readable pages to OCR)
RECORD_SCHEMA = "pdf-text-record/1"
MAX_PAGE_CHARS = 200_000          # the database check allows 250000; a page is cut here and flagged truncated
TEXT_OK_ALNUM = 100               # a page with at least this many letters/digits keeps its text layer
TEXT_SHORT_ALNUM = 25             # short but real text (signature page, one-paragraph order) when no large image sits on the page
IMAGE_COVER_OCR = 0.30            # share of the page covered by images that makes a thin text layer insufficient
BLANK_IMAGE_COVER = 0.05
VECTOR_PATHS_OCR = 200            # outlined-text scans: lots of vector paths, no text

_LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
_TRANSLATE = {ord(k): v for k, v in _LIGATURES.items()}
_TRANSLATE.update({ord(c): None for c in "​‌‍⁠﻿­�"})  # zero-width, soft hyphen and the replacement character carry no words
_SURROGATES = re.compile("[\ud800-\udfff]")
_CONTROLS = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")
_HSPACE = re.compile(r"[^\S\n]+")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_text(raw: str | None) -> str:
    """Deterministic clean-up that keeps the words as extracted: NFC, ligatures expanded, zero-width and soft hyphens removed,
    control characters and lone surrogates dropped, runs of spaces collapsed, at most one blank line in a row."""
    if not raw:
        return ""
    s = _SURROGATES.sub("", raw)
    s = unicodedata.normalize("NFC", s)
    s = s.translate(_TRANSLATE)
    s = _CONTROLS.sub(" ", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    out: list[str] = []
    blank = 0
    for line in s.split("\n"):
        line = _HSPACE.sub(" ", line).strip()
        if line:
            out.append(line)
            blank = 0
        else:
            blank += 1
            if blank == 1 and out:
                out.append("")
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def alnum_count(s: str) -> int:
    return sum(1 for c in s if c.isalnum())


GARBLE_UNREADABLE = 0.35  # share of the raw characters that are replacement characters / CID placeholders above which the text layer is unusable


def garble_ratio(raw: str) -> float:
    """Unreadable share of the RAW text-layer characters: U+FFFD replacement characters and '(cid:N)' placeholders (counted as the 6 characters they replace)."""
    nonspace = sum(1 for c in raw if not c.isspace())
    if nonspace < 40:
        return 0.0  # a page number or a stray glyph is not a garbled page
    return (raw.count("�") + raw.count("(cid:") * 6) / nonspace


def looks_garbled(s: str, garble: float = 0.0) -> bool:
    """A text layer that is mostly unreadable (replacement characters / CID placeholders) or mostly symbols is not usable text. A page with a few unmappable glyphs
    (bullets, odd quotes: 5-15% replacement characters is common) is still perfectly searchable."""
    nonspace = sum(1 for c in s if not c.isspace())
    if garble > GARBLE_UNREADABLE:
        return True
    if nonspace < 40:
        return False
    return nonspace >= 200 and alnum_count(s) / nonspace < 0.25


def classify_page(text: str, image_cover: float, vector_paths, garble: float = 0.0) -> tuple[str, str | None]:
    """Returns (state, reason). vector_paths is a zero-argument callable, evaluated only when it can change the answer."""
    alnum = alnum_count(text)
    if alnum >= TEXT_OK_ALNUM or garble > GARBLE_UNREADABLE:
        if looks_garbled(text, garble):
            return "ocr_pending", "bad_text_layer"
        return "text", None
    if image_cover >= IMAGE_COVER_OCR:
        return "ocr_pending", "image_page"
    if alnum >= TEXT_SHORT_ALNUM:
        return "text", None
    if image_cover >= BLANK_IMAGE_COVER or vector_paths() >= VECTOR_PATHS_OCR:
        return "ocr_pending", "image_or_vector_page"
    if alnum > 0:
        return "text", None
    return "blank", None


def _fitz():
    import fitz  # PyMuPDF; imported lazily so the pure helpers stay importable without it

    return fitz


def page_image_cover(page) -> float:
    fitz = _fitz()
    rect = page.rect
    area = max(rect.width * rect.height, 1.0)
    cover = 0.0
    try:
        infos = page.get_image_info()
    except Exception:  # noqa: BLE001 - a damaged page simply reports no images
        infos = []
    for info in infos:
        box = fitz.Rect(info["bbox"]) & rect
        if not box.is_empty:
            cover += box.width * box.height
    return min(cover / area, 1.0)


def open_pdf(data: bytes):
    """Opens verified bytes; returns (doc, None) or (None, reason)."""
    fitz = _fitz()
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        return None, "open_failed:" + type(exc).__name__
    if doc.needs_pass and not doc.authenticate(""):
        doc.close()
        return None, "encrypted"
    if doc.page_count < 1:
        doc.close()
        return None, "no_pages"
    return doc, None


def extract_text_layer(doc) -> list[dict]:
    """One dict per page: {'page','text','state','reason','image_cover'}; the text is normalised, never OCR'd here."""
    fitz = _fitz()
    flags = fitz.TEXT_MEDIABOX_CLIP  # ligatures expanded, off-page text ignored
    pages = []
    for index in range(doc.page_count):
        page = doc[index]
        try:
            raw = page.get_text("text", flags=flags)
        except Exception as exc:  # noqa: BLE001
            pages.append({"page": index + 1, "text": "", "state": "error", "reason": "text_failed:" + type(exc).__name__, "image_cover": 0.0})
            continue
        text = normalize_text(raw)
        cover = page_image_cover(page)
        state, reason = classify_page(text, cover, lambda p=page: len(p.get_cdrawings()), garble_ratio(raw))
        pages.append({"page": index + 1, "text": text if state == "text" else "", "state": state, "reason": reason, "image_cover": round(cover, 3)})
    return pages


def render_page(doc, index: int, dpi: int):
    """A PIL RGB image of one page (the OCR engine takes 96 dpi for detection and 192 dpi for recognition)."""
    from PIL import Image

    pm = doc[index].get_pixmap(dpi=dpi, alpha=False)
    return Image.frombytes("RGB", (pm.width, pm.height), pm.samples)


def apply_ocr(pages: list[dict], index: int, text: str, confidence: float, lines: int, low_conf_lines: int) -> None:
    text = normalize_text(text)
    page = pages[index]
    if alnum_count(text) == 0:
        page.update({"text": "", "state": "ocr_empty", "ocr_confidence": None, "ocr_lines": lines})
        return
    page.update({"text": text, "state": "text", "engine": "surya-ocr", "ocr_confidence": round(float(confidence), 4), "ocr_lines": lines, "ocr_low_conf_lines": low_conf_lines})


def engine_version(pymupdf_version: str, ocr_used: bool, ocr_label: str | None = None) -> str:
    base = "pymupdf " + pymupdf_version
    if ocr_used and ocr_label:
        base += "; " + ocr_label
    return base[:400]


def build_record(*, sha256: str, size: int, pages: list[dict], status_hint: str | None, note: str | None, pymupdf_version: str,
                 ocr_label: str | None, source: str, timing_ms: dict | None = None, extracted_at: str | None = None) -> dict:
    """The staged document record. `pages` is the per-page list produced by extract_text_layer (+ apply_ocr)."""
    page_count = len(pages)
    meta, payload = [], []
    chars = pending = with_text = 0
    ocr_used = False
    for p in pages:
        state = p["state"]
        entry: dict = {"p": p["page"], "state": state}
        text = p.get("text") or ""
        if state == "text":
            engine = p.get("engine", "pdf-text-layer")
            truncated = len(text) > MAX_PAGE_CHARS
            if truncated:
                text = text[:MAX_PAGE_CHARS]
            entry.update({"engine": engine, "chars": len(text)})
            row = {"page": p["page"], "text": text, "engine": engine}
            if engine == "surya-ocr":
                ocr_used = True
                entry["ocr_confidence"] = p.get("ocr_confidence")
                if p.get("ocr_low_conf_lines"):
                    entry["low_conf_lines"] = p["ocr_low_conf_lines"]
                row["ocr_confidence"] = p.get("ocr_confidence")
            if truncated:
                entry["truncated"] = True
                row["truncated"] = True
            payload.append(row)
            chars += len(text)
            with_text += 1
        elif state == "ocr_pending":
            pending += 1
            entry["reason"] = p.get("reason")
        elif state == "ocr_empty":
            ocr_used = True
        elif state == "error":
            entry["reason"] = p.get("reason")
        if p.get("image_cover"):
            entry["img"] = p["image_cover"]
        meta.append(entry)
    text_sha256 = sha256_hex("\f".join((next((r["text"] for r in payload if r["page"] == p["page"]), "")) for p in pages).encode("utf-8"))
    if status_hint in ("unreadable",):
        status = "unreadable"
    elif pending:
        status = "partial_ocr_pending"
    elif with_text == 0:
        status = "no_text"
    else:
        status = "complete"
    return {
        "schema": RECORD_SCHEMA,
        "sha256": sha256,
        "bytes": size,
        "status": status,
        "page_count": page_count,
        "ocr_pending_pages": pending,
        "chars": chars,
        "pages_with_text": with_text,
        "engine_version": engine_version(pymupdf_version, ocr_used, ocr_label),
        "extractor_version": EXTRACTOR_VERSION,
        "text_sha256": text_sha256,
        "note": note,
        "pages_meta": meta,
        "pages": payload,
        "extracted_at": extracted_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provenance": {"source": source, "timing_ms": timing_ms or {}},
    }


def unreadable_record(*, sha256: str, size: int, reason: str, pymupdf_version: str, source: str) -> dict:
    return {
        "schema": RECORD_SCHEMA, "sha256": sha256, "bytes": size, "status": "unreadable", "page_count": 0, "ocr_pending_pages": 0, "chars": 0, "pages_with_text": 0,
        "engine_version": engine_version(pymupdf_version, False), "extractor_version": EXTRACTOR_VERSION, "text_sha256": None, "note": reason[:480],
        "pages_meta": [], "pages": [], "extracted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "provenance": {"source": source, "timing_ms": {}},
    }


def process_pdf(data: bytes, sha256: str, *, source: str, ocr=None, max_ocr_pages: int | None = None) -> dict:
    """Verified bytes in, staged record out. `ocr` (optional) has recognize(low_images, high_images) -> list of OcrPage-like dicts
    {'text','confidence','lines','low_conf_lines'}; without it pages needing OCR stay 'ocr_pending'."""
    fitz = _fitz()
    started = time.time()
    if sha256_hex(data) != sha256:
        raise ValueError("SHA256_MISMATCH")
    doc, reason = open_pdf(data)
    if doc is None:
        return unreadable_record(sha256=sha256, size=len(data), reason=reason or "unreadable", pymupdf_version=fitz.VersionBind, source=source)
    try:
        pages = extract_text_layer(doc)
        t_text = time.time()
        ocr_label = None
        if ocr is not None:
            todo = [i for i, p in enumerate(pages) if p["state"] == "ocr_pending"]
            if max_ocr_pages is not None:
                todo = todo[:max_ocr_pages]
            ocr_label = getattr(ocr, "label", None)
            for i in todo:
                result = ocr.recognize([render_page(doc, i, 96)], [render_page(doc, i, 192)])[0]
                apply_ocr(pages, i, result["text"], result["confidence"], result.get("lines", 0), result.get("low_conf_lines", 0))
        t_ocr = time.time()
        return build_record(sha256=sha256, size=len(data), pages=pages, status_hint=None, note=None, pymupdf_version=fitz.VersionBind, ocr_label=ocr_label, source=source,
                            timing_ms={"text": int((t_text - started) * 1000), "ocr": int((t_ocr - t_text) * 1000)})
    finally:
        doc.close()


# ---- staged files -------------------------------------------------------------------------------------------------------------------------

def retry_io(fn, attempts: int = 30, delay: float = 0.3):
    """Windows briefly denies a rename/append while another process (the loader, a virus scanner, an operator reading a progress file) has the file open.
    Retry for ~10 s before giving up; the caller decides what a final failure means."""
    last = None
    for attempt in range(attempts):
        try:
            return fn()
        except (PermissionError, OSError) as exc:
            last = exc
            time.sleep(delay)
    raise last  # type: ignore[misc]


def record_path(staging: str, sha256: str) -> str:
    return os.path.join(staging, "records", sha256[:2], sha256 + ".json.gz")


def write_record(staging: str, record: dict) -> str:
    path = record_path(staging, record["sha256"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=4) as fh:
        json.dump(record, fh, ensure_ascii=False, separators=(",", ":"))
    retry_io(lambda: os.replace(tmp, path))
    return path


def read_record(staging: str, sha256: str) -> dict | None:
    path = record_path(staging, sha256)
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def append_jsonl(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    line = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"

    def write():
        with open(path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())

    retry_io(write)


def read_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a torn last line after a crash; the document is simply redone
    return out
