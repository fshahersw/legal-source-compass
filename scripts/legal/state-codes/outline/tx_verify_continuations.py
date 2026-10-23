"""Confirm wrapped Texas headings against the publisher's own chapter HTML (at most one request per second).

    python3 -I -B scripts/legal/state-codes/outline/tx_verify_continuations.py <snapshot dir> <candidates.json> \
        <capture dir> <out.json>

A candidate from tx_heading_continuations.py is kept only when the publisher's chapter page
(https://tcss.legis.texas.gov/resources/<CODE>/htm/<member>) prints the first line as a bold centered heading and the
following line(s) as centered paragraphs that are not bold, with exactly the texts the frozen capture holds. A bold
second line is a separate heading ("ARTICLE 7. EDUCATION" / "THE PUBLIC FREE SCHOOLS"), never a continuation. Pages are
saved unchanged with a manifest line each (url, path, sha256, bytes, retrieved_at, http_status).
"""
import datetime
import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from lxml import html

UA = "legal-source-compass research (contact: notreelai@gmail.com)"
BASE = "https://tcss.legis.texas.gov/resources"


def norm(text):
    return re.sub(r"\s+", " ", text or "").strip()


def centered_lines(raw):
    """[(text, bold)] for the centered paragraphs of a chapter page, in order."""
    doc = html.fromstring(raw.decode("utf-8-sig"))
    out = []
    for p in doc.xpath("//body/pre/p"):
        if p.get("class") != "center":
            out.append((None, None))
            continue
        out.append((norm("".join(p.itertext())), "bold" in (p.get("style") or "")))
    return out


def confirmed(lines, first, joined):
    rest = norm(joined[len(first):])
    for i, (text, bold) in enumerate(lines):
        if text != first or not bold:
            continue
        parts, j = [], i + 1
        while j < len(lines) and lines[j][0] and not lines[j][1]:
            parts.append(lines[j][0])
            if norm(" ".join(parts)) == rest:
                return True
            j += 1
    return False


def main(argv):
    base, cand_path, capture_dir, out_path = Path(argv[0]), Path(argv[1]), Path(argv[2]), Path(argv[3])
    candidates = json.loads(cand_path.read_text(encoding="utf-8"))["headings"]
    codes = json.loads((base / "state-codes/tx/browse-v1/codes.json").read_text(encoding="utf-8"))
    # chapter members whose frozen text holds each candidate
    members = {}
    for code in codes["codes"]:
        index = json.loads((base / code["file"]).read_text(encoding="utf-8"))
        for chapter in index["chapters"]:
            text = (base / chapter["text"]["file"]).read_text(encoding="utf-8")
            for key, joined in candidates.items():
                c, first = key.split("\x1f", 1)
                if c == code["code"] and key not in members and f"{first}\n\n" in text:
                    members[key] = (code["code"], chapter["publisher_member"])
    capture_dir.mkdir(parents=True, exist_ok=True)
    manifest = capture_dir / "_manifest.jsonl"
    pages, kept, rejected = {}, {}, []
    for key in sorted(candidates):
        if key not in members:
            rejected.append({"key": key, "reason": "no chapter text holds the first line"})
            continue
        code, member = members[key]
        if member not in pages:
            url = f"{BASE}/{code}/htm/{member}"
            path = capture_dir / member
            if not path.exists():
                time.sleep(1.1)
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    status, raw = resp.status, resp.read()
                path.write_bytes(raw)
                with manifest.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps({"url": url, "path": str(path.name), "sha256": hashlib.sha256(raw).hexdigest(),
                                         "bytes": len(raw), "http_status": status, "method": "urllib GET",
                                         "retrieved_at": datetime.datetime.now(datetime.timezone.utc)
                                         .strftime("%Y-%m-%dT%H:%M:%SZ")}) + "\n")
            pages[member] = centered_lines(path.read_bytes())
        first = key.split("\x1f", 1)[1]
        if confirmed(pages[member], first, candidates[key]):
            kept[key] = candidates[key]
        else:
            rejected.append({"key": key, "member": member, "reason": "publisher page does not print an unbolded second line"})
    out_path.write_text(json.dumps({"source": "frozen chapter texts, confirmed against " + BASE, "headings": kept,
                                    "rejected": rejected}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"candidates": len(candidates), "confirmed": len(kept), "rejected": len(rejected), "pages": len(pages)}))


if __name__ == "__main__":
    main(sys.argv[1:])
