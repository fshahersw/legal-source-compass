"""Verification worksheet: a fixed-seed random sample of SettleSignal records checked against the primary source each cites.

For each sampled record the cited official page (official_settlement_url, else official_claim_url) is read from the
unchanged bytes saved by check_sources.py (or a capture listed in verification/captures.json) and three fields are
matched deterministically:
  date    - the record's claim_deadline appears on the page (any of several US date spellings)
  amount  - each dollar figure printed in estimated_payout appears on the page (normalised numbers)
  parties - the party named in the record title appears on the page (case-insensitive token phrase)
The worksheet (verification/worksheet.json) lists the evidence snippets; a person then confirms each verdict in
verification/verdicts.json, which the dataset builder reads.

Usage: python3 -I -B verify_sample.py [--n 36] [--seed 20261018]
"""
import datetime
import json
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from htmltext import to_text  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data")
VER = os.path.join(ACQ, "verification")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
MONEY = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(million|billion|M|B)\b)?", re.I)
STOP = {"settlement", "settlements", "data", "breach", "class", "action", "the", "of", "and", "inc", "inc.", "llc", "corp", "co",
        "privacy", "security", "incident", "lawsuit", "litigation", "fee", "fees", "refund", "refunds", "program", "v.", "v", "-", "&",
        "website", "pixel", "tcpa", "vppa", "biometric", "bipa", "total", "loss", "claims", "consumer", "product", "products", "a", "in",
        "for", "to", "on", "with", "at", "by", "from", "et", "al", "al.", "million", "$"}


def sample(records, n, seed):
    rng = random.Random(seed)
    return rng.sample(sorted(records, key=lambda r: r["url"]), n)


def date_variants(iso):
    """Spellings of an ISO date as US pages print them."""
    d = datetime.date.fromisoformat(iso)
    month = MONTHS[d.month - 1]
    return [f"{month} {d.day}, {d.year}", f"{month} {d.day} {d.year}", f"{month[:3]}. {d.day}, {d.year}", f"{month[:3]} {d.day}, {d.year}",
            f"{d.month}/{d.day}/{d.year}", f"{d.month:02d}/{d.day:02d}/{d.year}", f"{d.month}/{d.day}/{str(d.year)[2:]}", iso,
            f"{d.day} {month} {d.year}", f"{month} {d.day}{'st' if d.day in (1, 21, 31) else 'nd' if d.day in (2, 22) else 'rd' if d.day in (3, 23) else 'th'}, {d.year}"]


def money_values(text):
    """Normalised dollar amounts printed in text: '$6,100,000' -> 6100000.0, '$1.5 million' -> 1500000.0."""
    values = []
    for whole, cents, scale in MONEY.findall(text or ""):
        number = float(whole.replace(",", "") + ("." + cents if cents else ""))
        if scale:
            number *= 1e9 if scale.lower() in ("billion", "b") else 1e6
        values.append(round(number, 2))
    return values


TITLE_MONEY = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(million|billion|M|B|K)?\b", re.I)


def title_amounts(title):
    """Dollar figures printed in a title with their precision: '$5.68M' -> (5680000.0, 1e6, 2); '$318,825' -> (318825.0, 1, 0)."""
    out = []
    for whole, frac, scale in TITLE_MONEY.findall(title or ""):
        unit = {"million": 1e6, "m": 1e6, "billion": 1e9, "b": 1e9, "k": 1e3}.get((scale or "").lower(), 1.0)
        dec = len(frac) if frac else 0
        number = float(whole.replace(",", "") + ("." + frac if frac else ""))
        out.append((round(number * unit, 2), unit, dec if unit != 1.0 else 2))
    return out


def party_phrase(title):
    """Party named in the title: the defendant side of a 'X v. Y' caption, else the leading words before a generic term."""
    text = re.sub(r"\(.*?\)", " ", title)
    caption = re.search(r"\bv(?:s)?\.?\s+([^,;()\-–]+)", title)
    if caption:
        text = caption.group(1)
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    lead = []
    for word in words:
        if word.lower().strip(".,:;") in STOP or re.match(r"^\$|^\d", word):
            if lead:
                break
            continue
        lead.append(word.strip(".,:;'’\""))
        if len(lead) >= 3:
            break
    return " ".join(lead)


def find_snippet(haystack, needle, width=90):
    i = haystack.lower().find(needle.lower())
    if i < 0:
        return None
    return haystack[max(0, i - width):i + len(needle) + width].replace("\n", " ")


def check_record(record, text):
    out = {"fields": {}}
    if record["claim_deadline"]:
        hits = [(v, find_snippet(text, v)) for v in date_variants(record["claim_deadline"])]
        hit = next(((v, s) for v, s in hits if s), None)
        out["fields"]["date"] = {"record": record["claim_deadline"], "match": bool(hit), "evidence": hit[1] if hit else None}
    else:
        out["fields"]["date"] = {"record": None, "match": None, "evidence": None}
    page_amounts = set(money_values(text))
    exact = sorted(set(money_values(record["estimated_payout"])))
    rounded = title_amounts(record["title"])
    amounts = [("payout", a, None) for a in exact] + [("title", value, (scale, dec)) for value, scale, dec in rounded]
    if amounts:
        matched, missing = [], []
        for where, value, prec in amounts:
            ok = value in page_amounts if prec is None else any(round(p / prec[0], prec[1]) == value / prec[0] for p in page_amounts)
            (matched if ok else missing).append(f"{where} ${value:,.2f}" + (" (rounded in title)" if prec else ""))
        out["fields"]["amount"] = {"record": [f"{w} ${v:,.2f}" for w, v, _ in amounts], "matched": matched, "missing": missing,
                                   "match": not missing}
    else:
        out["fields"]["amount"] = {"record": [], "match": None}
    phrases = [p for p in (party_phrase(part) for part in re.split(r"\s*[/;]\s*|\s+-\s+", record["title"])) if p]
    hits = [(p, find_snippet(text, p)) for p in phrases]
    hit = next(((p, s) for p, s in hits if s), None)
    out["fields"]["parties"] = {"record": " | ".join(phrases) or None, "match": bool(hit) if phrases else None,
                                "matched_phrase": hit[0] if hit else None, "evidence": hit[1] if hit else None}
    return out


def page_text(check_line, captures):
    key = check_line.get("settlesignal_url")
    if key in captures:
        cap = captures[key]
        raw = open(os.path.join(ROOT, cap["path"]), encoding="utf-8", errors="replace").read()
        return (to_text(raw)[0] if cap.get("format") == "html" else raw), cap
    if not check_line.get("path") or not (check_line.get("status") and 200 <= check_line["status"] < 300):
        return None, None
    raw = open(os.path.join(ROOT, check_line["path"]), "rb").read().decode("utf-8", "replace")
    return to_text(raw)[0], {"path": check_line["path"], "method": "direct", "url": check_line.get("final_url") or check_line["url"]}


def main():
    n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 36
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 20261018
    data = json.load(open(os.path.join(ACQ, "settlesignal", "settlements.json"), encoding="utf-8"))
    checks = {}
    for raw in open(os.path.join(ACQ, "official_pages", "_checks.jsonl")):
        line = json.loads(raw)
        checks[line["settlesignal_url"]] = line
    cap_path = os.path.join(VER, "captures.json")
    captures = json.load(open(cap_path)) if os.path.exists(cap_path) else {}
    rows = []
    for record in sample(data["settlements"], n, seed):
        line = checks.get(record["url"], {})
        text, source = page_text(line, captures)
        row = {"settlesignal_url": record["url"], "title": record["title"], "official_url": record["official_settlement_url"] or record["official_claim_url"],
               "check": {k: line.get(k) for k in ("status", "outcome", "error", "final_url")}, "source": source,
               "record": {k: record[k] for k in ("claim_deadline", "estimated_payout", "status", "verification_status", "accepted_official_evidence")}}
        if text is None:
            row["result"] = "source_not_read"
        else:
            row.update(check_record(record, text))
            row["text_chars"] = len(text)
        rows.append(row)
    os.makedirs(VER, exist_ok=True)
    with open(os.path.join(VER, "worksheet.json"), "w", encoding="utf-8") as handle:
        json.dump({"seed": seed, "n": n, "population": len(data["settlements"]), "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "rows": rows}, handle, indent=1, ensure_ascii=False)
    for i, row in enumerate(rows, 1):
        f = row.get("fields", {})
        print(i, row["title"][:70], "|", row["check"].get("status") or row["check"].get("outcome"), "|",
              "date", (f.get("date") or {}).get("match"), "amount", (f.get("amount") or {}).get("match"), "party", (f.get("parties") or {}).get("match"),
              (f.get("parties") or {}).get("record"), "| chars", row.get("text_chars"), row.get("result", ""))


if __name__ == "__main__":
    main()
