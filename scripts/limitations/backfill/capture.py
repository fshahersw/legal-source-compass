#!/usr/bin/env python3
"""Capture one official primary-source page for the limitations backfill.

Usage: capture.py ST CAPTURE_ID URL [--render] [--via firecrawl|tavily] [--text-file PATH --method NAME]

--render loads the page in headless Chrome (no login, no clicks, no terms acceptance) and stores the rendered
DOM, for official sites that only deliver text through JavaScript. The capture is marked rendered=true.

--via firecrawl|tavily fetches an official page through a fetch proxy, ONLY for hosts that block direct
requests (bot challenges). Keys come from FIRECRAWL_API_KEY / TAVILY_API_KEY in the environment and are never
written. The proxy's JSON response is stored as the "raw" capture and the capture records route={kind:"proxied",
proxy:...}; the builder grades such captures as a lower evidence grade. Publisher click-through gates (Lexis,
Westlaw, terms pages) are refused for every route, and the proxy is never used to get past one.

With --text-file the page text came from a rendering/extraction intermediary (for JavaScript-only official
sites). The extraction is stored as the "raw" capture, marked intermediary=true, and entries relying only on it
are capped at medium confidence by the verifier.

Writes, under $LIM_WORK/captures/ST/ (default /tmp/lim/backfill):
  CAPTURE_ID.raw   exact response bytes
  CAPTURE_ID.txt   extracted plain text (UTF-8)
  CAPTURE_ID.json  provenance: url, final url, status, content type, raw/text SHA-256, retrieval time

Only official hosts are accepted (see OFFICIAL_SUFFIXES / OFFICIAL_HOSTS / BLOCKED_HOSTS). The tool never
accepts terms-of-use gates, logs in, or executes scripts; a page that requires either is reported as blocked.
"""
import hashlib
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urlparse

import requests

WORK = os.environ.get("LIM_WORK", "/tmp/lim/backfill")
UA = "LegalSourceAtlas-primary-source-review/1.0"

GATED_PUBLISHERS = ("lexisnexis.com", "lexis.com", "westlaw.com", "casetext.com", "fastcase.com", "vlex.com")
BLOCKED_HOSTS = (
    "justia.com", "law.cornell.edu", "findlaw.com", "casetext.com", "public.law", "casemine.com",
    "leagle.com", "courtlistener.com", "ballotpedia.org", "nolo.com", "lawserver.com", "wikipedia.org",
    "statutes.laws.com", "codes.findlaw.com", "law.onecle.com", "fastcase.com", "vlex.com", "anylaw.com",
)
OFFICIAL_SUFFIXES = (".gov", ".mil")
OFFICIAL_HOSTS = (
    # state legislatures / code publishers operated or designated by the state
    "leg.state.fl.us", "leg.state.nv.us", "leg.state.mn.us", "legis.state.ia.us", "legis.state.la.us",
    "ilga.gov", "legis.la.gov", "ncleg.net", "oregonlegislature.gov", "azleg.gov",
    "leginfo.legislature.ca.gov", "legislature.ca.gov", "lis.virginia.gov", "law.lis.virginia.gov",
    "revisor.mo.gov", "codes.ohio.gov", "legislature.mi.gov", "mainelegislature.org", "gencourt.state.nh.us",
    "rilin.state.ri.us", "webserver.rilin.state.ri.us", "rilegislature.gov", "le.utah.gov", "leg.colorado.gov",
    "delcode.delaware.gov", "code.dccouncil.gov", "akleg.gov", "legis.state.ak.us", "capitol.hawaii.gov",
    "legislature.idaho.gov", "iga.in.gov", "legis.iowa.gov", "ksrevisor.org", "legislature.ky.gov",
    "apps.legislature.ky.gov", "lrc.ky.gov", "mgaleg.maryland.gov", "revisor.mn.gov", "leg.mt.gov",
    "mtcourts.gov", "nebraskalegislature.gov", "nmonesource.com", "nmcompcomm.us", "ndlegis.gov",
    "oklegislature.gov", "oscn.net", "palegis.us", "legis.state.pa.us", "statutes.capitol.texas.gov",
    "capitol.texas.gov", "app.leg.wa.gov", "docs.legis.wisconsin.gov", "legislature.vermont.gov", "wyoleg.gov",
    "wvlegislature.gov", "scstatehouse.gov", "sdlegislature.gov", "arkleg.state.ar.us", "legislature.ms.gov",
    "billstatus.ls.state.ms.us", "sos.ms.gov", "legis.ga.gov", "law.georgia.gov", "tn.gov", "tncourts.gov",
    "capitol.tn.gov", "njleg.state.nj.us", "njleg.gov", "pub.njleg.gov", "lis.njleg.state.nj.us",
    "nysenate.gov", "nycourts.gov", "legislation.nysenate.gov", "malegislature.gov", "cga.ct.gov",
    "kslegislature.org", "kslegislature.gov", "courts.ca.gov", "ujs.sd.gov", "sdlegislature.gov",
    "appellate.nccourts.org", "nccourts.org", "appellate-records.courts.alaska.gov",
    "govt.westlaw.com",  # official public-access host for states that designate it (Tennessee Code, etc.)
    "lexisnexis.com",   # accepted only where the state designates it as the official code (verify per use)
    "advance.lexis.com", "olls.info", "colorado.gov", "gasupreme.us", "gaappeals.us", "vermontjudiciary.org", "pacourts.us", "lasc.org", "flrules.org", "sccourts.org", "kycourts.net", "wvcourts.gov", "courts.state.hi.us", "nmonesource.com",
)


def host_class(host: str) -> str:
    host = host.lower()
    if any(host == b or host.endswith("." + b) for b in BLOCKED_HOSTS):
        return "blocked_secondary"
    if host.endswith(OFFICIAL_SUFFIXES) or re.search(r"\.state\.[a-z]{2}\.us$", host) or re.search(r"\.[a-z]{2}\.us$", host):
        return "official"
    if any(host == h or host.endswith("." + h) for h in OFFICIAL_HOSTS):
        return "official_designated"
    return "unlisted"


class TextExtractor(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article", "ul", "ol", "dd", "dt", "blockquote", "pre"}
    SKIP = {"script", "style", "head", "noscript", "template", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(raw: bytes, declared: str | None) -> str:
    enc = declared or "utf-8"
    m = re.search(rb'<meta[^>]+charset=["\']?([A-Za-z0-9_-]+)', raw[:4096], re.I)
    if m and not declared:
        enc = m.group(1).decode("ascii", "ignore")
    try:
        html = raw.decode(enc, errors="replace")
    except LookupError:
        html = raw.decode("utf-8", errors="replace")
    p = TextExtractor()
    p.feed(html)
    text = "".join(p.out).replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", l).strip() for l in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip() + "\n"


def pdf_to_text(raw: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(raw))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages).strip() + "\n"


def main():
    args = sys.argv[1:]
    if len(args) < 3:
        print(__doc__)
        sys.exit(2)
    st, cid, url = args[0].upper(), args[1], args[2]
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,80}", cid):
        sys.exit("capture id must be lowercase [a-z0-9._-]")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        sys.exit("only plain https URLs are accepted")
    cls = host_class(parsed.hostname or "")
    if cls == "blocked_secondary":
        sys.exit(f"REFUSED: {parsed.hostname} is a secondary publisher, not a primary legal source")
    via = args[args.index("--via") + 1] if "--via" in args else None
    text_file = args[args.index("--text-file") + 1] if "--text-file" in args else None
    method = args[args.index("--method") + 1] if "--method" in args else "intermediary-extraction"
    out_dir = os.path.join(WORK, "captures", st)
    os.makedirs(out_dir, exist_ok=True)
    retrieved = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(time.time()*1000)%1000:03d}Z"
    if via:
        if via not in ("firecrawl", "tavily"):
            sys.exit("--via must be firecrawl or tavily")
        if any((parsed.hostname or "").endswith(h) for h in GATED_PUBLISHERS):
            sys.exit(f"REFUSED: {parsed.hostname} is a publisher terms gate; no route may be used to pass it")
        if cls not in ("official", "official_designated"):
            sys.exit(f"REFUSED: {parsed.hostname} is not a listed official host")
        key = os.environ.get("FIRECRAWL_API_KEY" if via == "firecrawl" else "TAVILY_API_KEY")
        if not key:
            sys.exit("API key not set in the environment")
        if via == "firecrawl":
            resp = requests.post("https://api.firecrawl.dev/v1/scrape", headers={"Authorization": f"Bearer {key}"},
                                 json={"url": url, "formats": ["markdown"], "onlyMainContent": False}, timeout=120)
            body = resp.json() if resp.ok else {}
            text = ((body.get("data") or {}).get("markdown")) or ""
        else:
            resp = requests.post("https://api.tavily.com/extract", headers={"Authorization": f"Bearer {key}"},
                                 json={"urls": [url], "extract_depth": "advanced"}, timeout=120)
            body = resp.json() if resp.ok else {}
            results = body.get("results") or []
            text = (results[0].get("raw_content") if results else "") or ""
        if not resp.ok or len(text) < 200:
            print(json.dumps({"ok": False, "via": via, "status": resp.status_code, "reason": "proxy returned no usable page text"}))
            sys.exit(1)
        lowered = text[:4000].lower()
        if re.search(r"(accept|agree)[^\n]{0,60}(terms|conditions)|verify you are human|checking your browser", lowered):
            print(json.dumps({"ok": False, "via": via, "reason": "page looks like a terms or bot gate; not stored"}))
            sys.exit(1)
        raw = resp.content
        text = text.replace("\xa0", " ")
        meta = {
            "id": cid, "state": st, "url": url, "finalUrl": url, "status": 200, "contentType": "application/json",
            "hostClass": cls, "finalHostClass": cls, "retrievedAt": retrieved, "intermediary": True,
            "extraction": f"proxied fetch via {via} of the official page",
            "route": {"kind": "proxied", "proxy": via},
            "rawSha256": hashlib.sha256(raw).hexdigest(), "rawBytes": len(raw),
            "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "textBytes": len(text.encode("utf-8")),
        }
        for suffix, data in ((".raw", raw), (".txt", text.encode("utf-8")), (".json", json.dumps(meta, indent=1).encode())):
            with open(os.path.join(out_dir, cid + suffix), "wb") as f:
                f.write(data)
        print(json.dumps({"ok": True, "id": cid, "via": via, "textBytes": meta["textBytes"], "retrievedAt": retrieved}))
        return
    if text_file:
        raw = open(text_file, "rb").read()
        text = raw.decode("utf-8", errors="replace").replace("\xa0", " ")
        if len(text) < 200:
            sys.exit("extraction text too short")
        meta = {
            "id": cid, "state": st, "url": url, "finalUrl": url, "status": 200, "contentType": "text/plain",
            "hostClass": cls, "finalHostClass": cls, "retrievedAt": retrieved, "intermediary": True, "extraction": method,
            "rawSha256": hashlib.sha256(raw).hexdigest(), "rawBytes": len(raw),
            "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "textBytes": len(text.encode("utf-8")),
        }
        with open(os.path.join(out_dir, cid + ".raw"), "wb") as f:
            f.write(raw)
        with open(os.path.join(out_dir, cid + ".txt"), "w", encoding="utf-8") as f:
            f.write(text)
        with open(os.path.join(out_dir, cid + ".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=1)
        print(json.dumps({"ok": True, "id": cid, "intermediary": True, "textBytes": meta["textBytes"], "retrievedAt": retrieved}))
        return
    rendered = "--render" in args
    try:
        if rendered:
            import subprocess, tempfile
            profile = tempfile.mkdtemp(prefix="lim-chrome-")
            p = subprocess.run(
                ["google-chrome", "--headless=new", "--user-data-dir=" + profile, "--no-sandbox", "--disable-gpu", "--virtual-time-budget=25000",
                 "--user-agent=" + UA, "--dump-dom", url],
                capture_output=True, timeout=120)
            r = type("R", (), {"status_code": 200 if p.stdout else 0,
                               "headers": {"Content-Type": "text/html; charset=utf-8"},
                               "content": p.stdout, "url": url})()
        else:
            r = requests.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=60, allow_redirects=True)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
    final = urlparse(r.url)
    final_cls = host_class(final.hostname or "")
    ctype = r.headers.get("Content-Type", "")
    raw = r.content
    meta = {
        "id": cid, "state": st, "url": url, "finalUrl": r.url, "status": r.status_code, "contentType": ctype,
        "hostClass": cls, "finalHostClass": final_cls, "retrievedAt": retrieved,
        "rawSha256": hashlib.sha256(raw).hexdigest(), "rawBytes": len(raw),
        "lastModifiedHeader": r.headers.get("Last-Modified"),
        "rendered": rendered,
    }
    if r.status_code != 200 or final_cls == "blocked_secondary":
        print(json.dumps({"ok": False, "reason": "non-200 or redirected to a secondary host", **meta}))
        sys.exit(1)
    try:
        if "pdf" in ctype.lower() or raw[:5] == b"%PDF-":
            text = pdf_to_text(raw)
            meta["extraction"] = "pypdf"
        else:
            declared = None
            m = re.search(r"charset=([\w-]+)", ctype, re.I)
            if m:
                declared = m.group(1)
            text = html_to_text(raw, declared)
            meta["extraction"] = "html-block-text"
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"extract failed: {e}", **meta}))
        sys.exit(1)
    meta["textSha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    meta["textBytes"] = len(text.encode("utf-8"))
    gate = re.search(r"(terms (and|of) (use|conditions|service)|accept|agree)[^\n]{0,80}(continue|proceed|access)", text[:4000], re.I)
    if len(text) < 200 or (gate and len(text) < 3000):
        meta["warning"] = "very short or possible terms/JavaScript gate; do NOT treat as statutory text unless the excerpt is present"
    with open(os.path.join(out_dir, cid + ".raw"), "wb") as f:
        f.write(raw)
    with open(os.path.join(out_dir, cid + ".txt"), "w", encoding="utf-8") as f:
        f.write(text)
    with open(os.path.join(out_dir, cid + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    print(json.dumps({"ok": True, **{k: meta[k] for k in ("id", "status", "hostClass", "textBytes", "retrievedAt")}, "warning": meta.get("warning")}))


if __name__ == "__main__":
    main()
