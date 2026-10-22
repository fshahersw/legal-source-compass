"""Confirm settlement facts against the text of an official settlement page. Pure functions, no network.

A lead (from SettleSignal) proposes a name, a claim deadline and a payout description. A fact is published only when
the official page's own text confirms it:
  name      exact phrase on the page, or every distinctive word of the name on the page (whole words)
  deadline  the same calendar date written on the page in a common US/ISO form
  amount    a dollar figure from the lead's payout text that appears on the page with the same value
  court     a court name stated on the page (federal district courts get a court id only on an exact map)
  case no.  a docket/case number stated on the page
Statuses: confirmed (verbatim or same value), stated_on_page (court/case number found on the page itself),
not_found, contradicted (the page states a different date in a deadline sentence) and not_in_lead.
"""
import re
from datetime import date

import extract as ex

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
GENERIC = {
    "settlement", "settlements", "class", "action", "lawsuit", "litigation", "the", "a", "an", "of", "and", "in", "re",
    "v", "vs", "inc", "llc", "corp", "co", "company", "data", "breach", "incident", "security", "privacy", "case",
    "fund", "funds", "program", "refund", "refunds", "claims", "claim", "payment", "payments", "consumer", "consumers",
    "for", "to", "on", "at", "by", "with", "from", "website", "pixel", "tracking", "fees", "fee", "distribution",
    "fair", "investors", "investor", "securities", "notice", "proposed", "final", "agreement", "matter", "et", "al",
}
# Topic descriptors SettleSignal adds to titles ("Washington Job Posting", "Wage and Hour", "TCPA Text Message"): they
# describe the claim type, not the parties, so the identity check rests on the remaining (party) words.
TOPIC_WORDS = {
    "wage", "wages", "hour", "hours", "wage-and-hour", "job", "jobs", "posting", "postings", "pay", "transparency",
    "tcpa", "fcra", "fdcpa", "bipa", "text", "texts", "message", "messages", "unwanted", "call", "calls", "robocall",
    "robocalls", "fax", "junk", "tuition", "covid", "covid-19", "product", "products", "marketing", "labeling",
    "mislabeling", "advertising", "unpaid", "overtime", "pto", "biometric", "biometrics", "video", "interview",
    "website", "subscription", "subscriptions", "renewal", "renewals", "auto", "redress", "billing", "medical",
    "credit", "report", "reporting", "debt", "collection", "phone", "over", "about", "antitrust", "end-payer",
    "overdraft", "nsf", "insurance", "employment", "employee", "employees", "worker", "workers", "california",
    "washington", "illinois", "new", "york", "texas", "florida", "nationwide", "state", "states", "us", "u.s", "usa",
    "fire", "apartment", "apartments", "casino", "social", "games", "game", "dashcam", "camera", "cameras",
    "release-card", "prepaid", "mortgage-servicing", "lease", "disclosure", "tech-support", "fraud", "non-toxic",
    "all", "natural", "supercharger", "idle", "fee", "discounts", "discount", "hotel", "hotels", "trucking",
    "cannabis", "probiotic", "cookware", "pools", "above-ground", "compression", "straps", "mychart",
}
_MONEY_TOKEN = re.compile(r"^\$?\d[\d,.]*(?:k|m|b|mm|million|billion)?$|^(?:million|billion|thousand)$")


def norm(text):
    t = (text or "").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = t.replace("–", "-").replace("—", "-").replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip().casefold()


def words(text):
    return re.findall(r"[a-z0-9][a-z0-9'&.-]*[a-z0-9]|[a-z0-9]", norm(text))


def confirm_name(name, page_text):
    """('exact phrase' | 'all distinctive words' | None, detail)."""
    n, p = norm(name), norm(page_text)
    if not n or not p:
        return None, "empty"
    if n in p:
        return "exact phrase", name
    main = re.sub(r"\([^)]*\)", " ", name)  # parenthetical notes ("(California)", "(FCRA)") are not the name
    distinctive = [w for w in words(main) if w not in GENERIC and w not in TOPIC_WORDS and not _MONEY_TOKEN.match(w) and len(w) > 1]
    if not distinctive:
        return None, "no distinctive words in the name"
    page_words = set(words(page_text))
    missing = [w for w in distinctive if w not in page_words]
    if missing:
        return None, "missing: " + ", ".join(missing[:6])
    return "all party words", " ".join(distinctive)


def date_variants(iso):
    """Text forms of a date: 'December 1, 2026', 'Dec. 1, 2026', 'Dec 1, 2026', '12/01/2026', '12/1/2026',
    '2026-12-01', '1 December 2026', 'December 01, 2026'."""
    try:
        d = date.fromisoformat(iso)
    except (TypeError, ValueError):
        return []
    m, ma = MONTHS[d.month - 1], MONTH_ABBR[d.month - 1]
    return [
        f"{m} {d.day}, {d.year}", f"{m} {d.day:02d}, {d.year}", f"{m} {d.day} {d.year}", f"{ma}. {d.day}, {d.year}",
        f"{ma} {d.day}, {d.year}", f"{d.month}/{d.day}/{d.year}", f"{d.month:02d}/{d.day:02d}/{d.year}",
        f"{d.month}/{d.day:02d}/{d.year}", f"{d.month:02d}/{d.day}/{d.year}", d.isoformat(), f"{d.day} {m} {d.year}",
        f"{m} {d.day}th, {d.year}", f"{m} {d.day}st, {d.year}", f"{m} {d.day}nd, {d.year}", f"{m} {d.day}rd, {d.year}",
        f"{d.month}-{d.day}-{d.year}", f"{d.month:02d}-{d.day:02d}-{d.year}",
    ]


_ANY_DATE = re.compile(
    r"\b(?:(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|"
    r"Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4}|\d{1,2}/\d{1,2}/\d{4})\b")
_DEADLINE_WORDS = re.compile(r"deadline|postmarked|submitted (?:online )?(?:no later than|by|on or before)|file (?:a claim|your claim)[^.]{0,60}(?:by|before)|claim form[^.]{0,80}(?:by|before)", re.I)


def confirm_deadline(iso, page_text):
    """{'status', 'as_written', 'sentence'} for a lead deadline."""
    if not iso:
        return {"status": "not_in_lead"}
    text = page_text or ""
    spans = ex.sentence_spans(text)
    for variant in date_variants(iso):
        for m in re.finditer(r"(?<![\w/])" + re.escape(variant) + r"(?![\w/])", text, re.I):
            return {"status": "confirmed", "as_written": text[m.start():m.end()], "offset": m.start(),
                    "sentence": ex.sentence_at(text, m.start(), spans, limit=300)}
    for a, b in spans:
        sentence = text[a:b]
        if _DEADLINE_WORDS.search(sentence):
            other = _ANY_DATE.search(sentence)
            if other:
                return {"status": "contradicted", "page_date_as_written": other.group(0), "sentence": sentence.strip()[:300]}
    return {"status": "not_found"}


def payout_figures(payout_text):
    return [a for a in ex.extract_amounts(payout_text or "") if a.get("value_usd") is not None]


def confirm_amounts(payout_text, page_text):
    """Dollar figures from the lead's payout text that the page states with the same value (page's own wording)."""
    if not payout_text:
        return [], "not_in_lead"
    lead = payout_figures(payout_text)
    if not lead:
        return [], "no dollar figure in lead"
    spans = ex.sentence_spans(page_text or "")
    page = ex.extract_amounts(page_text or "", spans)
    by_value = {}
    for a in page:
        if a.get("value_usd") is not None:
            by_value.setdefault(a["value_usd"], a)
    out, seen = [], set()
    for a in lead:
        hit = by_value.get(a["value_usd"])
        if hit and a["value_usd"] not in seen:
            seen.add(a["value_usd"])
            out.append({"lead_as_written": a["as_written"], "page_as_written": hit["as_written"], "value_usd": a["value_usd"],
                        "offset": hit["offset"], "sentence": ex.sentence_at(page_text, hit["offset"], spans, limit=300),
                        "status": "confirmed" if hit["as_written"] == a["as_written"] else "confirmed (same value)"})
    return out, ("confirmed" if out else "not_found")


_STATE_NAMES = "|".join(re.escape(x) for x in sorted((k for k in ex.STATES if not k.startswith("the ")), key=len, reverse=True))
_PLACE = r"[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2}"
_STATE_COURTS = [
    re.compile(r"\b(?:Superior|Circuit|District|Supreme|Chancery|Business) Court of (?:the )?(?:State of |Commonwealth of )?(?:" + _STATE_NAMES + r")"
               r"(?:,?\s(?:in and for\s)?(?:the\s)?(?:County|City and County|Parish) of " + _PLACE + r")?"),
    re.compile(r"\b(?:Circuit|District|Superior|Chancery) Court (?:of|for|in) " + _PLACE + r" County,? (?:" + _STATE_NAMES + r")\b"),
    re.compile(r"\bCourt of Common Pleas (?:of|for) " + _PLACE + r" County(?:,? (?:" + _STATE_NAMES + r"))?"),
]


def stated_courts(page_text, courts=None):
    """Federal court names (with id on exact map) and other court names as written on the page."""
    found = []
    seen = set()
    for c in ex.extract_courts(page_text or ""):
        cid = c.get("court_id")
        if cid and courts and not courts.valid(cid):
            cid = None
        if c["as_written"] not in seen:
            seen.add(c["as_written"])
            found.append({"as_written": c["as_written"], "court_id": cid, "offset": c["offset"]})
    for pattern in _STATE_COURTS:
        for m in pattern.finditer(page_text or ""):
            phrase = m.group(0).rstrip(" ,.")
            if phrase in seen or any(phrase in s or s in phrase for s in seen):
                continue
            seen.add(phrase)
            found.append({"as_written": phrase, "court_id": None, "offset": m.start()})
    return found[:4]


def stated_case_numbers(page_text):
    out = []
    for d in ex.extract_dockets(page_text or ""):
        if d["form"] == "MDL number":
            out.append(d)
        elif re.search(r"\d", d["as_written"]) and "-" in d["as_written"]:
            out.append(d)
    return out[:4]


def page_title(raw_html):
    m = re.search(r"<title[^>]*>(.*?)</title>", raw_html or "", re.S | re.I)
    t = ex.html_to_text(m.group(1)) if m else ""
    if t:
        return t[:200]
    m = re.search(r"<h1[^>]*>(.*?)</h1>", raw_html or "", re.S | re.I)
    return ex.html_to_text(m.group(1))[:200] if m else None


def page_links(raw_html):
    return set(re.findall(r'href=["\']([^"\']+)["\']', raw_html or "", re.I))
