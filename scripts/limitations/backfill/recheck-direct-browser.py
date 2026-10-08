#!/usr/bin/env python3
"""Direct re-read of official limitations sources with a browser engine (Chromium via Playwright).

Used only for sources that neither the plain direct fetch, the official code capture nor the proxy could
re-read. The route is still "direct": the same official URL, fetched from the review environment, with the
document bytes the browser received retained unchanged (content-addressed) and rendered to text with the
same `html_to_text` / `pdf_to_text` the original captures used.

What it never does:
  * It does not bypass an access-control block. A host that answers "you have been blocked" / "Access Denied"
    / an anti-scraping notice, or that refuses the connection, is recorded as not re-read.
  * It does not declare a passage lost. A fresh copy that does not reproduce a quoted passage is recorded as
    `browser_passage_missing_review` (the builder leaves the source "not re-read" and a human compares); only
    the classic direct pass may issue evidence_lost.
  * It does not follow a redirect to a non-official host.

A host that serves an automated-browser check (e.g. Cloudflare "Just a moment...") before the page is given
the time to complete it, exactly as a person's browser would; the note recorded on the source says so.

Composite sources (`--composite ID=comp1,comp2,...`): a builder-made verbatim concatenation of other sources'
official pages is not fetched; its quoted passages are matched against the retained text of each component
whose own direct re-read this release found text-identical, and the builder records that derivation.

Usage:
  python3 scripts/limitations/backfill/recheck-direct-browser.py \
      --bundle /tmp/lim/out-r5/limitations --ids ca-12a,bf-ca-time-ccp-12a \
      [--composite bf-ks-sol-combined=bf-ks-60-511,bf-ks-60-512] \
      --results /tmp/lim/recheck/results-browser.json \
      --captures /tmp/lim/recheck/captures-browser \
      --stage-captures /tmp/lim/out-r5/captures
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("lim_capture", HERE / "capture.py")
_cap = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(_cap)
html_to_text, pdf_to_text, host_class = _cap.html_to_text, _cap.pdf_to_text, _cap.host_class

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
CHALLENGE_TITLES = ("just a moment", "performing security verification", "checking your browser")
BLOCK_MARKERS = (
    "you have been blocked",
    "access denied",
    "the request could not be satisfied",
    "site data scraper",
    "attention required",
)
MAINTENANCE_MARKERS = ("undergoing maintenance", "maintenance | ")


# --- same matcher as src/lib/limitations/backfill/passageMatch.ts --------------------------------------
def normalize_text(value: str) -> str:
    v = unicodedata.normalize("NFKC", value)
    v = re.sub(r"[\u2018\u2019\u201B]", "'", v)
    v = re.sub(r"[\u201C\u201D]", '"', v)
    v = re.sub(r"[\u2010-\u2015\u2212]", "-", v)
    v = v.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", v).strip()


def spacing_normalized(value: str) -> str:
    v = normalize_text(value)
    v = re.sub(r"\s*-\s*", "-", v)
    v = re.sub(r"\s+([,.;:!?)\]])", r"\1", v)
    v = re.sub(r"([(\[])\s+", r"\1", v)
    return re.sub(r"(?<=[^\W\d_])-(?=[a-z\u00df-\u00ff])", "", v)


def match_passage(haystack: str, needle: str) -> str | None:
    n = normalize_text(needle)
    if len(n) >= 8 and n in normalize_text(haystack):
        return "literal"
    sn = spacing_normalized(needle)
    if len(sn) >= 8 and sn in spacing_normalized(haystack):
        return "spacing_normalized"
    return None


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def needles_for(rule: dict) -> list[tuple[str, str]]:
    p = rule.get("provenance")
    if not p:
        return []
    out = [("excerpt", p.get("excerpt", "")), ("period", p.get("periodEvidence", ""))]
    out += [("tolling", t.get("text", "")) for t in p.get("tolling", [])]
    return [(k, v) for k, v in out if v and v != "Not recorded"]


def classify_shell(status: int, ctype: str, body: bytes) -> str | None:
    """Return a non-usable status for block/challenge/maintenance shells, else None."""
    if "html" not in ctype.lower() and status == 200:
        return None
    head = body[:20000].decode("utf-8", "replace").lower()
    title = re.search(r"<title>(.*?)</title>", head, re.S)
    t = (title.group(1) if title else "").strip()
    if any(m in t for m in CHALLENGE_TITLES) or "performing security verification" in head:
        return "challenge_pending"
    if any(m in head for m in BLOCK_MARKERS) and status in (401, 403, 429):
        return "access_blocked"
    if any(m in head or m in t for m in MAINTENANCE_MARKERS) or status == 503:
        return "host_maintenance"
    if status != 200:
        return f"http_{status}"
    if len(body) < 400:
        return "js_shell_or_empty"
    if "html" in ctype.lower() and "<script" in head and len(html_to_text(body, None).strip()) < 200:
        return "js_shell_or_empty"  # script-only shell (anti-automation check that sets a cookie and reloads)
    return None


async def read_with_browser(ctx, url: str, timeout_s: int, challenge_s: int = 200) -> dict:
    """Load the URL in a page, let any automated-browser check complete, return the final document bytes."""
    page = await ctx.new_page()
    docs: list = []
    downloads: list = []

    def on_response(resp):
        try:
            if resp.request.resource_type == "document" and resp.frame == page.main_frame:
                docs.append(resp)
        except Exception:
            pass

    page.on("response", on_response)
    page.on("download", lambda d: downloads.append(d))
    out: dict = {"challenge": False}
    try:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_s * 1000)
        except Exception as e:  # a PDF navigation surfaces as a download in headless Chromium
            for _ in range(20):
                if downloads:
                    break
                await page.wait_for_timeout(500)
            if not downloads:
                raise
        # An automated-browser check (Cloudflare "Just a moment...", script-only shells that set a cookie and
        # reload) is given up to `challenge_s` to finish on its own, as it would in a person's browser.
        deadline = asyncio.get_running_loop().time() + challenge_s
        while asyncio.get_running_loop().time() < deadline:
            if downloads:
                break
            try:
                title = (await page.title()).lower()
                body_len = len((await page.inner_text("body")).strip()) if title else 0
            except Exception:
                title, body_len = "", 0
                await page.wait_for_timeout(1500)
                continue
            shell_like = any(m in title for m in CHALLENGE_TITLES) or (body_len < 200 and not any(r.status == 200 for r in docs))
            if shell_like:
                out["challenge"] = True
                await page.wait_for_timeout(2500)
                continue
            break
        if not downloads:
            # Settle: the check's final reload is itself a document response; give it a moment to arrive.
            for _ in range(6):
                if any(r.status == 200 for r in docs) or downloads:
                    break
                await page.wait_for_timeout(1000)
        if downloads:
            d = downloads[-1]
            path = await d.path()
            raw = Path(path).read_bytes()
            out.update(status=200, contentType="application/pdf" if raw[:5] == b"%PDF-" else "application/octet-stream", finalUrl=d.url, raw=raw)
            return out
        final = None
        for resp in reversed(docs):
            if resp.status == 200:
                final = resp
                break
        if final is None and docs:
            final = docs[-1]
        if final is None:
            out.update(status=0, contentType="", finalUrl=page.url, raw=b"")
            return out
        try:
            raw = await final.body()
        except Exception:
            raw = (await page.content()).encode("utf-8")
            out["bodyFrom"] = "serialized_dom"
        out.update(status=final.status, contentType=final.headers.get("content-type", ""), finalUrl=final.url, raw=raw)
        return out
    finally:
        await page.close()


async def fetch_source(ctx, url: str, timeout_s: int, plain_http: bool, challenge_s: int) -> dict:
    """Plain GET first (shares the context's cookie jar); browser page only when the host serves a check."""
    target = url
    if plain_http and target.startswith("https://"):
        target = "http://" + target[len("https://") :]
    try:
        r = await ctx.request.get(target, timeout=timeout_s * 1000, max_redirects=5, headers={"accept": "text/html,application/xhtml+xml,application/pdf,*/*"})
        body = await r.body()
        res = {"status": r.status, "contentType": r.headers.get("content-type", ""), "finalUrl": r.url, "raw": body, "challenge": False, "via": "http"}
        shell = classify_shell(r.status, res["contentType"], body)
        if shell is None:
            return res
        if shell != "challenge_pending" and shell != "js_shell_or_empty":
            res["shell"] = shell
            return res
    except Exception as e:
        res = {"status": 0, "error": f"{type(e).__name__}: {str(e)[:160]}", "raw": b"", "contentType": "", "finalUrl": target, "challenge": False, "via": "http"}
        if "ERR_CERT" in str(e) or "certificate" in str(e).lower():
            res["httpClientTls"] = str(e)[:120]  # the browser verifies the chain itself (fetching intermediates); try it
        if "Timeout" in type(e).__name__ or "timed out" in str(e).lower() or "ECONNRESET" in str(e) or "ENOTFOUND" in str(e):
            res["shell"] = "unreachable_from_workspace"
            return res
    try:
        b = await read_with_browser(ctx, target, timeout_s, challenge_s)
    except Exception as e:
        b = {"status": 0, "error": f"{type(e).__name__}: {str(e)[:160]}", "raw": b"", "contentType": "", "finalUrl": target, "challenge": False}
        if "ERR_CERT" in str(e):
            b["shell"] = "tls_unverifiable"
        elif "Timeout" in type(e).__name__ or "ERR_CONNECTION" in str(e) or "ERR_NAME" in str(e):
            b["shell"] = "unreachable_from_workspace"
        else:
            b["shell"] = "fetch_error"
        b["via"] = "browser"
        return b
    b["via"] = "browser"
    shell = classify_shell(b["status"], b["contentType"], b["raw"])
    if shell:
        b["shell"] = shell
    return b


def render_text(raw: bytes, ctype: str) -> tuple[str, str]:
    if "pdf" in ctype.lower() or raw[:5] == b"%PDF-":
        return pdf_to_text(raw), "pypdf"
    m = re.search(r"charset=([A-Za-z0-9_-]+)", ctype or "")
    return html_to_text(raw, m.group(1) if m else None), "html-block-text"


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--ids", default="")
    ap.add_argument("--composite", action="append", default=[])
    ap.add_argument("--plain-http", default="", help="comma-separated source ids read over http:// (host TLS unverifiable); disclosed in the note")
    ap.add_argument("--results", required=True)
    ap.add_argument("--captures", required=True, help="flat dir: <id>.txt / <id>.raw for the builder")
    ap.add_argument("--stage-captures", required=True, help="state tree for stage-limitations-release.mjs")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--challenge-wait", type=int, default=200, help="seconds an automated-browser check may take to finish")
    args = ap.parse_args()

    bundle = Path(args.bundle)
    sources = {s["id"]: s for s in json.loads((bundle / "sources.json").read_text())["sources"]}
    rules = json.loads((bundle / "rules.json").read_text())["rules"]
    by_source: dict[str, list[dict]] = {}
    for r in rules:
        for sid in r["sourceIds"]:
            by_source.setdefault(sid, []).append(r)

    def retained_text(sid: str) -> str:
        return (bundle / "text" / f"{sid}.txt").read_text(encoding="utf-8", errors="replace")

    def evidence_for(sid: str, fresh: str, retained: str) -> list[dict]:
        out = []
        for r in by_source.get(sid, []):
            for kind, needle in needles_for(r):
                if match_passage(retained, needle) is None:
                    continue  # this source never carried that passage; another cited source does
                mode = match_passage(fresh, needle)
                out.append({"sourceId": sid, "ruleId": r["id"], "kind": kind, "found": mode is not None, **({"matchMode": mode} if mode else {})})
        return out

    flat = Path(args.captures)
    flat.mkdir(parents=True, exist_ok=True)
    tree = Path(args.stage_captures)
    results: list[dict] = []
    plain_http = {x for x in args.plain_http.split(",") if x}

    # Composites: derivation from component sources, no fetch.
    for spec in args.composite:
        cid, comps = spec.split("=", 1)
        comps, _, comp_note = comps.partition("|")
        comp_ids = [c for c in comps.split(",") if c]
        src = sources[cid]
        checked = now_iso()
        missing_comp = [c for c in comp_ids if c not in sources]
        if missing_comp:
            results.append({"url": src["url"], "sourceIds": [cid], "checkedAt": checked, "status": "composite_component_unknown", "components": comp_ids, "error": ",".join(missing_comp)})
            continue
        not_identical = [c for c in comp_ids if (sources[c].get("currency") or {}).get("status") != "confirmed_unchanged"]
        comp_text = "\n\n".join(retained_text(c) for c in comp_ids)
        ev = evidence_for(cid, comp_text, retained_text(cid))
        status = "composite_components_confirmed" if not not_identical and all(e["found"] for e in ev) else "composite_not_rechecked"
        results.append({
            "url": src["url"], "sourceIds": [cid], "checkedAt": checked, "status": status, "components": comp_ids,
            "componentsNotIdentical": not_identical, "evidence": ev,
            "componentCheckedAt": sorted({(sources[c].get("currency") or {}).get("checkedAt", "") for c in comp_ids}),
            **({"componentsNote": comp_note.strip()} if comp_note.strip() else {}),
        })
        print(json.dumps({"id": cid, "status": status, "passages": len(ev), "found": sum(e["found"] for e in ev), "componentsNotIdentical": not_identical}))

    ids = [x for x in args.ids.split(",") if x]
    if ids:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            ctx = await browser.new_context(user_agent=UA, accept_downloads=True, viewport={"width": 1280, "height": 1800}, ignore_https_errors=False)
            for sid in ids:
                src = sources[sid]
                url = src["url"]
                host = urlsplit(url).hostname or ""
                hc = host_class(host)
                checked = now_iso()
                rec: dict = {"url": url, "sourceIds": [sid], "checkedAt": checked}
                if hc not in ("official", "official_designated"):
                    rec["status"] = "non_official_host_not_attempted"
                    results.append(rec)
                    print(json.dumps({"id": sid, "status": rec["status"]}))
                    continue
                try:
                    f = await fetch_source(ctx, url, args.timeout, sid in plain_http, args.challenge_wait)
                except Exception as e:
                    f = {"status": 0, "error": f"{type(e).__name__}: {str(e)[:160]}", "raw": b"", "contentType": "", "finalUrl": url, "challenge": False, "via": "browser"}
                final_host = urlsplit(f.get("finalUrl") or url).hostname or ""
                fhc = host_class(final_host)
                rec.update(http=f.get("status"), via=f.get("via"), finalUrl=f.get("finalUrl"), challengeCompleted=bool(f.get("challenge")))
                if f.get("error"):
                    rec["error"] = f["error"]
                if fhc not in ("official", "official_designated"):
                    rec["status"] = "redirected_to_secondary"
                elif f.get("shell"):
                    sh = f["shell"]
                    rec["status"] = {
                        "access_blocked": "access_blocked_cloudflare" if "cloudflare" in f["raw"][:20000].decode("utf-8", "replace").lower() else "http_403",
                        "unreachable_from_workspace": "unreachable_from_workspace",
                        "tls_unverifiable": "fetch_error",
                        "challenge_pending": "js_shell_or_empty",
                        "host_maintenance": "http_503",
                        "js_shell_or_empty": "js_shell_or_empty",
                    }.get(sh, sh)
                    if sh == "host_maintenance":
                        rec["probe"] = "host maintenance page"
                    if sh == "unreachable_from_workspace":
                        rec["probe"] = "connection blocked"
                    if rec["status"] == "http_403" and f.get("status"):
                        rec["status"] = f"http_{f['status']}"
                elif f.get("status") != 200 or not f.get("raw"):
                    rec["status"] = f"http_{f.get('status')}" if f.get("status") else "fetch_error"
                else:
                    raw = f["raw"]
                    text, extraction = render_text(raw, f.get("contentType", ""))
                    tb = text.encode("utf-8")
                    retained = retained_text(sid)
                    ev = evidence_for(sid, text, retained)
                    same_raw = sha256(raw) == (src.get("rawCapture") or {}).get("sha256")
                    same_text = sha256(tb) == src.get("sha256")
                    # Same words in the same order with only whitespace differing (a PDF text extractor's line
                    # breaks and page-number lines) is still an identical text; it is disclosed as such.
                    same_normalized = not same_text and normalize_text(text) == normalize_text(retained)
                    if same_raw or same_text or same_normalized:
                        status = "unchanged"
                    elif any(not e["found"] for e in ev):
                        status = "browser_passage_missing_review"
                    elif ev:
                        status = "changed_evidence_intact"
                    else:
                        status = "changed_no_evidence_tracked"
                    note_bits = []
                    if f.get("challenge"):
                        note_bits.append("read with a browser engine from the review environment after the host's automated browser check completed; the document bytes the browser received are retained")
                    elif f.get("via") == "browser":
                        note_bits.append("read with a browser engine from the review environment; the document bytes the browser received are retained")
                    if sid in plain_http:
                        note_bits.append("the host's TLS certificate cannot be verified here (issued by the publisher's own private authority), so the same path was read over plain HTTP as the original capture was; transport was not authenticated and the comparison rests on the retained bytes")
                    if same_normalized:
                        note_bits.append("the fresh text is identical to the retained capture once whitespace is collapsed (the extractor's line breaks and page-number lines differ); bytes differ")
                    if f.get("bodyFrom") == "serialized_dom":
                        note_bits.append("the raw document body was not retrievable from the browser, so the serialized document is retained instead")
                    rec.update(status=status, rawSha256=sha256(raw), textSha256=sha256(tb), textBytes=len(tb), rawBytes=len(raw), sameRaw=same_raw, sameText=same_text or same_normalized, sameNormalizedTextOnly=same_normalized, evidence=ev, extraction=extraction)
                    if note_bits:
                        joined = "; ".join(note_bits)
                        rec["note"] = joined[0].upper() + joined[1:] + "."
                    (flat / f"{sid}.txt").write_bytes(tb)
                    (flat / f"{sid}.raw").write_bytes(raw)
                    sdir = tree / src["state"]
                    sdir.mkdir(parents=True, exist_ok=True)
                    cap_id = f"rc2-{sid}"
                    (sdir / f"{cap_id}.raw").write_bytes(raw)
                    (sdir / f"{cap_id}.txt").write_bytes(tb)
                    (sdir / f"{cap_id}.json").write_text(json.dumps({
                        "id": cap_id, "state": src["state"], "url": url, "finalUrl": f.get("finalUrl"), "status": f.get("status"),
                        "contentType": f.get("contentType"), "hostClass": hc, "finalHostClass": fhc, "retrievedAt": checked,
                        "intermediary": False, "route": {"kind": "direct"},
                        "extraction": f"Direct GET of the official page from the review environment ({'browser engine' if f.get('via') == 'browser' else 'HTTP client'}{', automated browser check completed' if f.get('challenge') else ''}{', plain HTTP: host TLS unverifiable' if sid in plain_http else ''}); {extraction}; no OCR",
                        "rawSha256": sha256(raw), "rawBytes": len(raw), "textSha256": sha256(tb), "textBytes": len(tb),
                    }, indent=1) + "\n")
                results.append(rec)
                print(json.dumps({k: v for k, v in rec.items() if k != "evidence"} | {"passages": len(rec.get("evidence", [])), "found": sum(e["found"] for e in rec.get("evidence", []))}))
                sys.stdout.flush()
            await browser.close()

    Path(args.results).parent.mkdir(parents=True, exist_ok=True)
    Path(args.results).write_text(json.dumps(results, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
