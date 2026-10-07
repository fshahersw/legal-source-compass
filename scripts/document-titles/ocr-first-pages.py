#!/usr/bin/env python3
"""Owner-authorised OCR of image-only first pages (court_documents rows whose saved PDF has no text layer on page 1); only the top 60% of the page is read (titles are at the top).

Downloads the saved file (SHA-256 verified against corpus_artifacts), renders page 1 at 200 dpi, runs RapidOCR (ONNX, local, no network
service), and writes line text, size (box height in points), vertical/horizontal position and recognition confidence to a JSONL file in the
same shape as extract-first-pages.py plus `c` (confidence) and `ocr` metadata. No bytes are kept; nothing is written to the corpus.

  python3 ocr-first-pages.py --artifacts artifacts.json --ids ids.txt --out ocr-first-pages.jsonl [--workers 3]
"""
import argparse, hashlib, importlib.util, json, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pymupdf
from rapidocr_onnxruntime import RapidOCR

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("efp", os.path.join(HERE, "extract-first-pages.py"))
efp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(efp)

DPI = 200
TOP_FRACTION = 0.6
SCALE = 72.0 / DPI
ENGINE = "rapidocr-onnxruntime-1.4.4"
_tls = {}


def engine():
    import threading

    t = threading.get_ident()
    if t not in _tls:
        _tls[t] = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
    return _tls[t]


def process(art):
    out = {"id": art["id"], "sha256": art["sha256"], "object_key": art["object_key"], "ocr": ENGINE, "dpi": DPI}
    data = efp.download(art["object_key"])
    if data is None:
        out["status"] = "object_missing"
        return out
    out["sha256_verified"] = hashlib.sha256(data).hexdigest() == art["sha256"]
    if not out["sha256_verified"]:
        out["status"] = "sha256_mismatch"
        return out
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        page = doc[0]
        clip = pymupdf.Rect(page.rect.x0, page.rect.y0, page.rect.x1, page.rect.y0 + page.rect.height * TOP_FRACTION)
        pix = page.get_pixmap(dpi=DPI, colorspace=pymupdf.csRGB, clip=clip)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
        out["page_w"], out["page_h"] = round(page.rect.width, 1), round(page.rect.height, 1)
        out["pages"] = doc.page_count
        doc.close()
        result, _ = engine()(img)
    except Exception as e:
        out["status"] = "ocr_error"
        out["error"] = str(e)[:120]
        return out
    lines = []
    for box, text, score in result or []:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        h = (max(ys) - min(ys)) * SCALE
        lines.append({"t": text.strip(), "s": round(h, 1), "b": False, "y": round(min(ys) * SCALE, 1), "x": round(min(xs) * SCALE, 1),
                      "x1": round(max(xs) * SCALE, 1), "c": round(float(score), 3)})
    lines = [l for l in lines if l["t"]]
    lines.sort(key=lambda l: (round(l["y"] / 4), l["x"]))
    out["lines"] = lines[: efp.MAX_LINES]
    out["status"] = "ok" if lines else "ocr_no_text"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--artifacts", required=True)
    ap.add_argument("--ids", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()
    arts = {x["route"].rsplit("/", 1)[-1]: x for x in json.load(open(a.artifacts))}
    ids = [l.strip() for l in open(a.ids) if l.strip()]
    done = set()
    if os.path.exists(a.out):
        done = {json.loads(l)["id"] for l in open(a.out) if l.strip()}
    todo = [{"id": i, "sha256": arts[i]["sha256"], "object_key": arts[i]["object_key"]} for i in ids if i in arts and i not in done]
    print(f"{len(ids)} ids, {len(done)} done, {len(todo)} to do", flush=True)
    n = 0
    with open(a.out, "a") as f, ThreadPoolExecutor(a.workers) as ex:
        for fu in as_completed([ex.submit(process, t) for t in todo]):
            f.write(json.dumps(fu.result(), ensure_ascii=False) + "\n")
            n += 1
            if n % 25 == 0:
                f.flush()
                print(n, flush=True)


if __name__ == "__main__":
    main()
