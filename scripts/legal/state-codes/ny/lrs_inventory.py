#!/usr/bin/env python3
"""Independent table-of-contents inventory of the Consolidated Laws from the Legislative Retrieval System (LRS).

public.leginfo.state.ny.us answers only on plain HTTP (HTTPS never connects) and roughly 4 in 10 requests hang, so each
request has a short timeout and is retried; reruns reuse the kept pages. LRS pages are form posts to lawssrch.cgi?NVLWO: with QLAWDATA set:
@LL<law> is a law's table of contents, @SL<id> a container listing its documents, $$<doc>$$@TX<key> one document.
A container's first document is its own heading ("Article 1", "Title 3"); the rest are sections. The section labels per
law are written to ROOT/lrs-inventory.json for comparison with the nysenate.gov capture. Every page is kept content-
addressed with a receipt (ROOT/receipts.jsonl). This is a cross-check only: the intake contract registers https sources.

    lrs_inventory.py [--root /tmp/sc/NY-LRS] [--workers 8]
"""
import argparse
import hashlib
import json
import pathlib
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from bs4 import BeautifulSoup

URL = "http://public.leginfo.state.ny.us/lawssrch.cgi?NVLWO:"
ENTRY = re.compile(r'<td id="[^"]+" onclick=javascript:getlaw\("LAWS","([^"]+)","LAW"\)>\s*([^<]*)</td><td[^>]*>([^<]*)')
LAW = re.compile(r'getlaw\("LAWS","@LL([A-Z0-9]+)","LAW","","","([^"]+)","[A-Z0-9]+"\) id=')
CURRENCY = re.compile(r"As of\s*<font[^>]*>\s*([^<]+?)\s*</font>\s*the Laws database is current\s*through\s*(\d{4})\s*<font[^>]*>\s*([^<]+?)\s*</font>", re.S)
HEADING_WORDS = ("ARTICLE", "TITLE", "PART", "SUBPART", "SUBTITLE", "CHAPTER", "SUB-ARTICLE", "SUBARTICLE", "DIVISION",
                 "SUBDIVISION", "SUB-PART", "SUB-TITLE", "BOOK")
_lock = threading.Lock()


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class LRS:
    def __init__(self, root):
        self.root = pathlib.Path(root)
        (self.root / "raw").mkdir(parents=True, exist_ok=True)
        self.receipts = self.root / "receipts.jsonl"
        self.fields = None
        self.cached = {}
        if self.receipts.exists():
            for line in self.receipts.read_text(encoding="utf8").splitlines():
                r = json.loads(line)
                self.cached.setdefault(r["QLAWDATA"], self.root / r["stored_path"])

    def post(self, qdata, tries=40):
        if qdata and qdata in self.cached:
            return self.cached[qdata].read_bytes().decode("utf-8", "replace")
        data = dict(self.fields or {}, hwebpage="LAWS", QLAWDATA=qdata, LIST="LAW")
        for attempt in range(1, tries + 1):
            started = now_iso()
            try:
                r = requests.post(URL, data=data, timeout=3) if self.fields else requests.get(URL, timeout=3)
            except requests.RequestException:
                continue
            if r.status_code != 200 or b"</html>" not in r.content[-200:].lower():
                continue
            sha = hashlib.sha256(r.content).hexdigest()
            path = self.root / "raw" / sha[:2] / sha
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.content)
            receipt = {"url": URL, "method": "POST", "QLAWDATA": qdata, "retrieved_at": started, "status": r.status_code,
                       "bytes": len(r.content), "sha256": sha, "stored_path": str(path.relative_to(self.root)),
                       "attempt": attempt, "retrieval_method": "direct"}
            with _lock, open(self.receipts, "a", encoding="utf8") as f:
                f.write(json.dumps(receipt, sort_keys=True) + "\n")
            return r.content.decode("utf-8", "replace")
        raise RuntimeError("LRS did not answer for " + qdata)


def entries(html):
    return [(q, label.strip(), desc.strip()) for q, label, desc in ENTRY.findall(html)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc/NY-LRS")
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    lrs = LRS(a.root)
    menu = lrs.post("")
    form = BeautifulSoup(menu, "lxml").find("form")
    lrs.fields = {i["name"]: i.get("value", "") for i in form.find_all("input")
                  if i.get("name") and i.get("type", "text").lower() in ("hidden", "text")}
    currency = CURRENCY.search(menu)
    start = menu.find("Consolidated Laws")
    stop = menu.find("Unconsolidated Laws")
    laws = LAW.findall(menu[start:stop])
    print(json.dumps({"consolidated_laws": len(laws), "currency": currency.groups() if currency else None}), flush=True)
    result = {}

    def walk_law(item):
        code, desc = item
        html = lrs.post("@LL" + code)
        containers = [q for q, _, _ in entries(html) if q.startswith("@SL")]
        sections = [{"doc": q, "label": label, "heading": d} for q, label, d in entries(html)
                    if q.startswith("$$") and label.split(" ", 1)[0].upper() not in HEADING_WORDS]
        seen = set(containers)
        queue = list(containers)
        while queue:
            q = queue.pop(0)
            for q2, label, d in entries(lrs.post(q)):
                if q2.startswith("@SL"):
                    if q2 not in seen:
                        seen.add(q2)
                        queue.append(q2)
                elif label.split(" ", 1)[0].upper() not in HEADING_WORDS:
                    sections.append({"doc": q2, "label": label, "heading": d})
        result[code] = {"name": desc.replace("%", " "), "containers": len(seen), "sections": sections}
        print(json.dumps({"law": code, "containers": len(seen), "sections": len(sections)}), flush=True)

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(walk_law, laws))
    out = {"source": URL, "currency": {"as_of": currency.group(1), "through": currency.group(2) + " " + currency.group(3)} if currency else None,
           "laws": dict(sorted(result.items())), "total_sections": sum(len(v["sections"]) for v in result.values())}
    (pathlib.Path(a.root) / "lrs-inventory.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({"laws": len(result), "total_sections": out["total_sections"]}), flush=True)


if __name__ == "__main__":
    main()
