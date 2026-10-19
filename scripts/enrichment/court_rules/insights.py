"""Extract practice insights from each rule document, keeping only values proven by a word-for-word quote.

  python3 -I -B scripts/enrichment/court_rules/insights.py [--workers 6] [doc_id ...]

For each retrieved document the sections most likely to state deadlines, length limits, formatting, filing, conferral,
pro hac vice and ADR requirements are chosen by keyword (deterministic), and a language model is asked to list such
requirements, each with the exact quote it rests on. A proposal is kept only when:
  1. its quote occurs in the cited section's stored text (exactly, or after collapsing line breaks and spaces),
  2. its value occurs inside its quote (case- and spacing-insensitive),
  3. its number, when given, is written in its value (as digits or as a number word),
  4. its category is one of CATEGORIES and its section id is one that was shown,
  5. its quote does not run across a running page header or footer (a line printed at the top or bottom of many pages).
Everything else is dropped and counted by reason. Raw model responses are cached per document under
private/build/court_rules/work/insights_cache/ so a rebuild is reproducible without new calls.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fetchlib  # noqa: E402
import textlib  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(ROOT, "private", "build", "court_rules", "work")
CACHE = os.path.join(WORK, "insights_cache")
MODEL = "claude-sonnet-5-5"
PROMPT_VERSION = "2026-10-19.2"
BUDGET_CHARS = 70_000

CATEGORIES = {
    "response_deadline": "Time to file a response or opposition to a motion (or other paper), as a period such as days after filing or service",
    "reply_deadline": "Time to file a reply in support of a motion",
    "other_deadline": "Any other stated filing deadline (e.g. time to answer, notice of appeal, objections, motions for reconsideration)",
    "page_limit": "Maximum length of a brief, memorandum, motion or other paper in pages",
    "word_limit": "Maximum length in words or lines",
    "formatting": "Typeface, font size, line spacing, margins, paper size or similar form requirements",
    "filing": "How papers must be filed or served: electronic filing, courtesy copies, proposed orders, sealed filings",
    "meet_and_confer": "A duty to confer with opposing counsel before filing (e.g. discovery motions) and what must be certified",
    "pro_hac_vice": "Admission of attorneys not admitted in the court: pro hac vice applications, local counsel, fees stated in the rule",
    "adr": "Alternative dispute resolution, mediation, settlement conference or arbitration requirements",
    "judge_practice": "References to individual judges' own practices, standing orders or chambers procedures",
}
KEYWORDS = re.compile(
    r"\b(motions?|brief|memorand\w*|opposition|respon\w+|repl(y|ies)|pages?|words?|font|typeface|point|double[- ]spaced|margins?|"
    r"electronic\w*|ECF|CM/ECF|courtesy cop\w+|proposed orders?|confer\w*|meet and confer|pro hac vice|admission|admitted|"
    r"local counsel|mediat\w+|ADR|alternative dispute|settlement conference|arbitrat\w+|individual practices|standing orders?|"
    r"chambers|within \d+ days|\d+ days)\b", re.I)
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
                "eighteen": 18, "nineteen": 19, "twenty": 20, "twenty-one": 21, "twenty one": 21, "twenty-eight": 28, "thirty": 30,
                "forty": 40, "forty-five": 45, "fifty": 50, "sixty": 60, "ninety": 90}

SYSTEM = (
    "You read court rules and list concrete practice requirements a litigator must follow. You never infer, summarise across "
    "sections or use outside knowledge: every item must rest on one contiguous passage copied character for character from "
    "the section text you are given. If a requirement is not stated in the text, leave it out."
)


def build_prompt(doc: dict, secs: list[dict]) -> str:
    cats = "\n".join(f"- {k}: {v}" for k, v in CATEGORIES.items())
    blocks = "\n\n".join(f"<section id=\"{s['id']}\" label=\"{s['label']}\" title=\"{s['title'][:120]}\">\n{s['text']}\n</section>" for s in secs)
    return (
        f"Document: {doc['title']}.\n\nCategories:\n{cats}\n\n"
        "Return only a JSON object {\"insights\": [...]} where each item is:\n"
        "{\"category\": one of the category keys, \"applies_to\": a short phrase naming what the requirement governs "
        "(e.g. \"Opposition to a motion\", \"Opening brief\"), \"value\": the requirement's key words copied exactly from the quote "
        "(e.g. \"14 days\", \"25 pages\", \"12-point\", \"must be filed electronically\"), \"number\": the number in the value as an "
        "integer or null, \"unit\": \"days\"|\"pages\"|\"words\"|\"points\"|\"lines\"|\"inches\"|\"dollars\"|null, \"quote\": one "
        "contiguous passage of at most 400 characters copied exactly from the section text (same spelling, punctuation, line "
        "breaks and hyphenation) that states the requirement and contains the value; start it at the beginning of a sentence, "
        "clause or numbered item, never in the middle of a word, \"section_id\": the id of the section the quote is from}.\n"
        "List each distinct requirement once; at most 40 items; prefer the most practically important. Do not quote headings or "
        "tables of contents. If nothing qualifies return {\"insights\": []}.\n\n" + blocks
    )


def choose_sections(doc_id: str, secs: list[dict]) -> list[dict]:
    scored = []
    for s in secs:
        if s["label"].startswith("Front matter") or len(s["text"]) < 60:
            continue
        hits = len(KEYWORDS.findall(s["text"][:20000])) + 3 * len(KEYWORDS.findall(s["title"]))
        if hits:
            scored.append((hits / (1 + len(s["text"]) / 4000), s))
    scored.sort(key=lambda t: -t[0])
    chosen, used = [], 0
    for _score, s in scored:
        text = s["text"][:12000]
        if used + len(text) > BUDGET_CHARS:
            continue
        chosen.append({**s, "text": text})
        used += len(text)
    chosen.sort(key=lambda s: s["ordinal"])
    return chosen


_api_lock = threading.Semaphore(6)
LAST_META: dict[int, dict] = {}


def call_model(prompt: str) -> str:
    import secrets_env

    key = secrets_env.load("ANTHROPIC_API_KEY")
    body = json.dumps({"model": MODEL, "max_tokens": 16000, "system": SYSTEM,
                       "messages": [{"role": "user", "content": prompt}]}).encode()
    for attempt in range(6):
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, method="POST",
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            with _api_lock:
                with urllib.request.urlopen(req, timeout=600) as resp:
                    data = json.loads(resp.read())
            LAST_META[threading.get_ident()] = {"stop_reason": data.get("stop_reason"), "usage": data.get("usage")}
            return "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 529) and attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"model call failed: HTTP {error.code} {error.read()[:200]!r}") from None
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise RuntimeError(f"model call failed: {error}") from None
    raise RuntimeError("model call failed")


def parse_json(text: str) -> list[dict]:
    """The response's insight objects; a response cut off mid-way still yields every complete object before the cut."""
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            items = data.get("insights") if isinstance(data, dict) else None
            if isinstance(items, list):
                return [i for i in items if isinstance(i, dict)]
        except json.JSONDecodeError:
            pass
    out, decoder = [], json.JSONDecoder()
    for start in [mm.start() for mm in re.finditer(r'\{\s*"category"', text)]:
        try:
            obj, _end = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            out.append(obj)
    return out


def number_written(number, value: str) -> bool:
    if number is None:
        return True
    try:
        n = int(number)
    except (TypeError, ValueError):
        return False
    v = value.lower()
    if re.search(rf"(?<![\d,]){n:,}(?![\d])|(?<![\d,]){n}(?![\d])", v):
        return True
    return any(word in v and val == n for word, val in NUMBER_WORDS.items())


def _norm_line(line: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", line.strip().lower()))


def running_lines(text: str) -> set[str]:
    """Lines printed at the top or bottom of many pages of a document (running headers and footers such as "CR-12"),
    with digits generalised; a quote that contains one runs across a page break and is not rule text."""
    pages = [p for p in text.split("\f") if p.strip()]
    seen = Counter()
    for page in pages:
        lines = [ln for ln in page.split("\n") if ln.strip()]
        seen.update({_norm_line(ln) for ln in lines[:2] + lines[-2:] if len(ln.strip()) <= 80})
    floor = max(3, int(0.3 * len(pages)))
    return {ln for ln, n in seen.items() if n >= floor}


def crosses_running_line(quote: str, running: set[str]) -> bool:
    return any(_norm_line(ln) in running for ln in quote.split("\n") if ln.strip())


def validate(item: dict, sections: dict[str, dict], running: set[str] | None = None) -> tuple[dict | None, str]:
    cat = item.get("category")
    if cat not in CATEGORIES:
        return None, "unknown_category"
    sid = item.get("section_id")
    sec = sections.get(sid)
    if not sec:
        return None, "unknown_section"
    quote = str(item.get("quote") or "").strip()
    value = str(item.get("value") or "").strip()
    if not quote or not value:
        return None, "missing_quote_or_value"
    if len(quote) > 600:
        return None, "quote_too_long"
    match = textlib.find_quote(quote, sec["text"])
    if not match:
        return None, "quote_not_in_text"
    if not textlib.value_in_quote(value, quote):
        return None, "value_not_in_quote"
    if running and crosses_running_line(quote, running):
        return None, "quote_crosses_page_header_or_footer"
    if not number_written(item.get("number"), value):
        return None, "number_not_in_value"
    unit = item.get("unit") if item.get("unit") in ("days", "pages", "words", "points", "lines", "inches", "dollars") else None
    number = int(item["number"]) if isinstance(item.get("number"), (int, float)) and number_written(item.get("number"), value) else None
    return {
        "category": cat, "applies_to": str(item.get("applies_to") or "").strip()[:160] or None, "value": value[:200],
        "number": number, "unit": unit, "quote": quote, "quote_match": match, "section_id": sid,
        "section_label": sec["label"], "section_title": sec["title"], "page": sec.get("page"), "source_url": sec["source_url"],
    }, "kept"


def run_doc(doc: dict, secs: list[dict], refresh: bool = False) -> dict:
    chosen = choose_sections(doc["id"], secs)
    if not chosen:
        return {"doc": doc["id"], "chosen": 0, "proposed": 0, "kept": [], "dropped": {}}
    prompt = build_prompt(doc, chosen)
    digest = hashlib.sha256((MODEL + PROMPT_VERSION + prompt).encode()).hexdigest()
    os.makedirs(CACHE, exist_ok=True)
    cache_path = os.path.join(CACHE, f"{doc['id']}.json")
    cached = json.load(open(cache_path)) if os.path.exists(cache_path) else None
    if cached and cached.get("prompt_sha256") == digest and not refresh:
        response = cached["response"]
    else:
        response = call_model(prompt)
        with open(cache_path, "w", encoding="utf-8") as handle:
            json.dump({"doc": doc["id"], "model": MODEL, "prompt_version": PROMPT_VERSION, "prompt_sha256": digest,
                       "chosen_sections": [s["id"] for s in chosen], "response": response,
                       "meta": LAST_META.get(threading.get_ident()), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                      handle)
    proposals = parse_json(response)
    by_id = {s["id"]: s for s in secs if s["id"] in {c["id"] for c in chosen}}
    kept, dropped, seen = [], Counter(), set()
    running = running_lines(fetchlib.open_text(doc["text_path"]).read()) if doc.get("text_path") else set()
    for item in proposals:
        rec, reason = validate(item, by_id, running)
        if not rec:
            dropped[reason] += 1
            continue
        key = (rec["category"], textlib.squash(rec["quote"]).lower(), rec["value"].lower())
        if key in seen:
            dropped["duplicate"] += 1
            continue
        seen.add(key)
        kept.append(rec)
    return {"doc": doc["id"], "chosen": len(chosen), "proposed": len(proposals), "kept": kept, "dropped": dict(dropped),
            "model": MODEL, "prompt_version": PROMPT_VERSION, "prompt_sha256": digest}


def main(argv):
    workers = 6
    if "--workers" in argv:
        workers = int(argv[argv.index("--workers") + 1])
    refresh = "--refresh" in argv
    only = [a for a in argv if not a.startswith("--") and not a.isdigit()]
    docs = [d for d in fetchlib.load_json(os.path.join(WORK, "documents.json"))["documents"] if d.get("status") == "text"]
    if only:
        docs = [d for d in docs if d["id"] in only]
    secs_by_doc: dict[str, list[dict]] = {}
    for line in fetchlib.open_text(os.path.join(WORK, "sections.jsonl")):
        s = json.loads(line)
        secs_by_doc.setdefault(s["doc"], []).append(s)
    results = {}
    out_path = os.path.join(WORK, "insights.json")
    if (os.path.exists(out_path) or os.path.exists(out_path + ".gz")) and only:
        results = {r["doc"]: r for r in fetchlib.load_json(out_path)["documents"]}

    def job(doc):
        try:
            return run_doc(doc, secs_by_doc.get(doc["id"], []), refresh)
        except Exception as error:  # recorded per document; one failure does not stop the others
            return {"doc": doc["id"], "error": str(error)[:300], "kept": [], "dropped": {}, "proposed": 0, "chosen": 0}

    with ThreadPoolExecutor(workers) as pool:
        for res in pool.map(job, docs):
            results[res["doc"]] = res
            print(json.dumps({"doc": res["doc"], "chosen": res.get("chosen"), "proposed": res.get("proposed"),
                              "kept": len(res["kept"]), "dropped": res.get("dropped"), "error": res.get("error")}), flush=True)
    proposed = sum(r.get("proposed", 0) for r in results.values())
    kept = sum(len(r["kept"]) for r in results.values())
    dropped = Counter()
    for r in results.values():
        dropped.update(r.get("dropped", {}))
    summary = {"model": MODEL, "prompt_version": PROMPT_VERSION, "documents": len(results), "proposed": proposed, "kept": kept,
               "dropped": dict(dropped), "validation_rate": round(kept / proposed, 4) if proposed else None,
               "errors": [r["doc"] for r in results.values() if r.get("error")]}
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump({"summary": summary, "documents": [results[k] for k in sorted(results)]}, handle, indent=1)
    print(json.dumps(summary))


if __name__ == "__main__":
    main(sys.argv[1:])
