"""Probe every jurisdiction's official code and register addresses: robots verdict, HTTP status, page title, currency
statement as printed, terms link. Output: private/build/w1025_regs/probe.json (one entry per state) + raw pages.

  python3 -I -B scripts/state_regs/probe.py [ST ...]

Two to four requests per state (robots.txt, code page, register page), one thread per state, per-host pacing.
"""
from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from sources import SOURCES  # noqa: E402

OUT = os.path.join(lib.BUILD, "probe.json")
CURRENCY = re.compile(
    r"((?:current|updated|effective|amended|reflects|includes|compiled)[^.<>\n]{0,40}?(?:through|as of|thru|to)\s+[^.<>\n]{3,80})",
    re.I)
TERMS = re.compile(r'href="([^"]+)"[^>]*>\s*(?:[^<]{0,20})?(?:Terms of Use|Terms|Disclaimer|Privacy and Disclaimer|Legal Notice|Copyright)\b', re.I)


def look(st: str, kind: str, url: str | None) -> dict | None:
    if not url:
        return None
    out: dict = {"url": url}
    out["robots"] = lib.robots_verdict(url)
    if not out["robots"]["allowed"]:
        out["result"] = "robots_disallowed"
        return out
    try:
        r = lib.fetch(url, retries=1, timeout=60)
    except lib.Blocked as err:
        out.update(result="blocked", error=str(err))
        return out
    except Exception as err:
        out.update(result="error", error=str(err)[:300])
        return out
    entry = lib.store(f"probe/{st}/{kind}", r)
    text = r.text() if "pdf" not in r.content_type.lower() else ""
    title = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
    plain = lib.html_text(text) if text else ""
    cur = []
    for m in CURRENCY.finditer(plain):
        s = lib.norm_ws(m.group(1))
        if s not in cur and re.search(r"\d{4}|\d{1,2}/\d{1,2}", s):
            cur.append(s)
    terms = [t for t in dict.fromkeys(TERMS.findall(text))][:3]
    out.update(result="ok" if r.status == 200 else f"http_{r.status}", status=r.status, final_url=r.final_url,
               content_type=r.content_type, bytes=entry["bytes"], sha256=entry["sha256"], retrieved_at=entry["retrieved_at"],
               title=lib.norm_ws(title.group(1))[:200] if title else None, currency_statements=cur[:4], terms_links=terms,
               browser_check=bool(re.search(r"cf-chl|g-recaptcha|hcaptcha\.com|Just a moment|challenge-platform|Access Denied|Request Rejected|_Incapsula_Resource|Attention Required", text[:5000], re.I)))
    return out


def probe(src: dict) -> dict:
    st = src["state"]
    res = {"state": st, "code": look(st, "code", src["code_url"]), "register": look(st, "register", src.get("register_url"))}
    print(json.dumps({"state": st, "code": (res["code"] or {}).get("result"), "register": (res["register"] or {}).get("result")}), flush=True)
    return res


def main(argv):
    want = {a.upper() for a in argv}
    srcs = [s for s in SOURCES if not want or s["state"] in want]
    prior = {}
    if os.path.exists(OUT):
        prior = {p["state"]: p for p in json.load(open(OUT))["states"]}
    with ThreadPoolExecutor(12) as pool:
        for r in pool.map(probe, srcs):
            prior[r["state"]] = r
    os.makedirs(lib.BUILD, exist_ok=True)
    with open(OUT, "w") as handle:
        json.dump({"generated_at": lib.utc_now(), "states": [prior[k] for k in sorted(prior)]}, handle, indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
