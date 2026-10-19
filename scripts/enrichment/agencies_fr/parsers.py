"""Pure parsing, matching and aggregation helpers for the agencies_fr builder (no network, no file system).

Every function either returns a value the source states or None / "Not recorded"; nothing is imputed.
"""
import datetime as dt
import html
import re

NOT_RECORDED = "Not recorded"

# ---------------------------------------------------------------------------------------------------------------
# Organisation-name matching (Federal Register <-> eCFR, USAspending, Government Manual, Unified Agenda)
# ---------------------------------------------------------------------------------------------------------------
# The key is deterministic: lower case, "&" read as "and", "U.S." read as "United States", punctuation removed,
# connective words and "United States" dropped, remaining words sorted. It equates the Federal Register's inverted
# names ("Land Management Bureau", "Treasury Department") with the natural order other publishers use ("Bureau of
# Land Management", "Department of the Treasury"). A match is accepted only when the key is unique on both sides.
STOP = {"of", "the", "for", "and", "on", "in", "to", "a", "an", "united", "states", "us"}


def name_key(name):
    if not isinstance(name, str):
        return ""
    s = html.unescape(name).lower().replace("&", " and ").replace("’", "'")
    s = re.sub(r"'s\b", "", s)
    s = re.sub(r"\bu\.\s?s\.", " united states ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    words = [w for w in s.split() if w not in STOP]
    return " ".join(sorted(words))


def unique_index(items, key_fn):
    """key -> item for keys that occur exactly once; also returns the set of ambiguous keys."""
    seen, dupes = {}, set()
    for item in items:
        key = key_fn(item)
        if not key:
            continue
        if key in seen:
            dupes.add(key)
        else:
            seen[key] = item
    for key in dupes:
        seen.pop(key, None)
    return seen, dupes


def match_names(left, right, left_name, right_name):
    """Unique-on-both-sides exact match of normalized names.

    Returns (pairs, stats) where pairs is a list of (left_item, right_item) and stats counts matched,
    unmatched and ambiguous items on each side.
    """
    left_index, left_dupes = unique_index(left, lambda x: name_key(left_name(x)))
    right_index, right_dupes = unique_index(right, lambda x: name_key(right_name(x)))
    pairs = [(left_index[k], right_index[k]) for k in sorted(left_index) if k in right_index]
    stats = {
        "matched": len(pairs),
        "left_total": len(left),
        "right_total": len(right),
        "left_ambiguous_keys": len(left_dupes),
        "right_ambiguous_keys": len(right_dupes),
        "right_unmatched": sorted(right_name(r) for r in right if name_key(right_name(r)) not in left_index
                                  or name_key(right_name(r)) in right_dupes),
    }
    return pairs, stats


# ---------------------------------------------------------------------------------------------------------------
# Federal Register API
# ---------------------------------------------------------------------------------------------------------------
def facet_counts(body):
    """{key: count} from a facets response ({key: {count, name}}); malformed entries are dropped."""
    out = {}
    if isinstance(body, dict):
        for key, value in body.items():
            count = value.get("count") if isinstance(value, dict) else None
            if isinstance(count, int) and count >= 0:
                out[key] = count
    return out


def year_series(body):
    """Yearly facet ({'1994-01-01': {count}}) -> {'1994': n}."""
    return {k[:4]: v for k, v in facet_counts(body).items() if re.fullmatch(r"\d{4}-\d{2}-\d{2}", k)}


def month_series(body):
    return {k[:7]: v for k, v in facet_counts(body).items() if re.fullmatch(r"\d{4}-\d{2}-\d{2}", k)}


def doc_key(doc):
    """Identity of one Federal Register publication. A document number can be printed on two publication dates
    (each its own page), so the published URL, else the number and date, identifies a document."""
    return doc.get("html_url") or (doc.get("document_number"), doc.get("publication_date"))


def doc_agency_ids(doc):
    """Federal Register agency ids listed on a document (ints, de-duplicated, order kept)."""
    out = []
    for agency in doc.get("agencies") or []:
        if isinstance(agency, dict) and isinstance(agency.get("id"), int) and agency["id"] not in out:
            out.append(agency["id"])
    return out


def cfr_labels(doc, limit=8):
    out = []
    for ref in doc.get("cfr_references") or []:
        if isinstance(ref, dict) and ref.get("title") and ref.get("part"):
            label = f"{ref['title']} CFR {ref['part']}"
            if label not in out:
                out.append(label)
    return out[:limit]


def compact_doc(doc, abstract_chars=320):
    """The fields the profile shows for one Federal Register document."""
    url = doc.get("html_url") or ""
    if not re.match(r"^https://www\.federalregister\.gov/", url):
        return None
    abstract = re.sub(r"\s+", " ", doc.get("abstract") or "").strip()
    if len(abstract) > abstract_chars:
        abstract = abstract[: abstract_chars - 1].rsplit(" ", 1)[0] + "…"
    return {
        "title": re.sub(r"\s+", " ", doc.get("title") or "").strip() or NOT_RECORDED,
        "date": doc.get("publication_date"),
        "type": doc.get("type"),
        "citation": doc.get("citation"),
        "url": url,
        "documentNumber": doc.get("document_number"),
        "cfr": cfr_labels(doc),
        "rins": [r for r in (doc.get("regulation_id_numbers") or []) if isinstance(r, str)][:4],
        "effectiveOn": doc.get("effective_on"),
        "commentsCloseOn": doc.get("comments_close_on"),
        "dockets": [d for d in (doc.get("docket_ids") or []) if isinstance(d, str)][:3],
        "abstract": abstract or None,
    }


def window_days(start, end):
    return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1


def per_year(count, days):
    """Annualized rate (count per 365.25 days); None for an empty window."""
    if not isinstance(count, int) or not days or days <= 0:
        return None
    return round(count * 365.25 / days, 1)


def admin_for_date(date_str, windows):
    """Key of the administration window ({key, start, end}) containing an ISO date, else None."""
    if not isinstance(date_str, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
        return None
    for w in windows:
        if w["start"] <= date_str <= w["end"]:
            return w["key"]
    return None


# ---------------------------------------------------------------------------------------------------------------
# Unified Agenda (reginfo.gov XML)
# ---------------------------------------------------------------------------------------------------------------
def strip_html(text):
    if not isinstance(text, str):
        return ""
    text = html.unescape(text)
    text = re.sub(r"(?is)<!DOCTYPE[^>]*>|<head>.*?</head>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def ua_date(value):
    """'07/00/2026' -> ('2026-07', None); '11/20/2024' -> ('2024-11', '2024-11-20'); 'To Be Determined' -> (None, None)."""
    if not isinstance(value, str):
        return None, None
    m = re.fullmatch(r"\s*(\d{2})/(\d{2})/(\d{4})\s*", value)
    if not m:
        return None, None
    month, day, year = m.group(1), m.group(2), m.group(3)
    if not (1 <= int(month) <= 12):
        return None, None
    ym = f"{year}-{month}"
    if day == "00":
        return ym, None
    try:
        return ym, dt.date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return ym, None


FR_CITE = re.compile(r"^\s*(\d{1,3})\s+FR\s+(\d{1,6})\s*$")


def fr_citation_url(citation):
    """'89 FR 91529' -> the federalregister.gov citation URL; anything else -> None."""
    m = FR_CITE.match(citation or "")
    if not m:
        return None
    return f"https://www.federalregister.gov/citation/{m.group(1)}-FR-{m.group(2)}"


def text_of(el, path):
    found = el.find(path)
    if found is None or found.text is None:
        return ""
    return re.sub(r"\s+", " ", found.text).strip()


def next_scheduled(timetable, as_of_month):
    """The first projected timetable step: an action without a Federal Register citation whose date the agency gave
    by month only ("MM/00/YYYY") or as "To Be Determined". Steps with a full date are events that happened
    (effective dates, comment-period ends). `passed` marks a projected month before the as-of month."""
    for t in timetable:
        if t["frCitation"] or not t["action"]:
            continue
        raw = (t["date"] or "").strip()
        projected = (t["month"] and re.fullmatch(r"\d{2}/00/\d{4}", raw)) or raw.lower() == "to be determined"
        if projected:
            return {**t, "passed": bool(t["month"] and t["month"] < as_of_month)}
    return None


def parse_ua_rin(el, as_of_month):
    """One RIN_INFO element -> dict (see next_scheduled for the next-action rule)."""
    timetable = []
    for t in el.findall("TIMETABLE_LIST/TIMETABLE"):
        action = text_of(t, "TTBL_ACTION")
        raw_date = text_of(t, "TTBL_DATE")
        ym, day = ua_date(raw_date)
        cite = text_of(t, "FR_CITATION")
        timetable.append({"action": action, "date": raw_date or None, "month": ym, "day": day,
                          "frCitation": cite or None, "frUrl": fr_citation_url(cite)})
    next_action = next_scheduled(timetable, as_of_month)
    deadlines = []
    for d in el.findall("LEGAL_DLINE_LIST/LEGAL_DLINE_INFO"):
        deadlines.append({"type": text_of(d, "DLINE_TYPE"), "stage": text_of(d, "DLINE_ACTION_STAGE"),
                          "date": text_of(d, "DLINE_DATE"), "description": text_of(d, "DLINE_DESC")})
    related = [{"rin": text_of(r, "RIN"), "relation": text_of(r, "RIN_RELATION")}
               for r in el.findall("RELATED_RIN_LIST/RELATED_RIN")]
    abstract_el = el.find("ABSTRACT")
    abstract = strip_html(abstract_el.text if abstract_el is not None and abstract_el.text else "")
    return {
        "rin": text_of(el, "RIN"),
        "publicationId": text_of(el, "PUBLICATION/PUBLICATION_ID"),
        "agency": {"code": text_of(el, "AGENCY/CODE"), "name": text_of(el, "AGENCY/NAME"),
                   "acronym": text_of(el, "AGENCY/ACRONYM")},
        "parent": ({"code": text_of(el, "PARENT_AGENCY/CODE"), "name": text_of(el, "PARENT_AGENCY/NAME"),
                    "acronym": text_of(el, "PARENT_AGENCY/ACRONYM")} if el.find("PARENT_AGENCY") is not None else None),
        "title": text_of(el, "RULE_TITLE"),
        "abstract": abstract,
        "priority": text_of(el, "PRIORITY_CATEGORY") or NOT_RECORDED,
        "status": text_of(el, "RIN_STATUS") or NOT_RECORDED,
        "stage": text_of(el, "RULE_STAGE") or NOT_RECORDED,
        "major": text_of(el, "MAJOR") or NOT_RECORDED,
        "regulatoryPlan": text_of(el, "RPLAN_ENTRY") == "Yes",
        "eo13771": text_of(el, "EO_13771_DESIGNATION") or None,
        "cfr": [c.text.strip() for c in el.findall("CFR_LIST/CFR") if c.text and c.text.strip()],
        "legalAuthority": [c.text.strip() for c in el.findall("LEGAL_AUTHORITY_LIST/LEGAL_AUTHORITY") if c.text and c.text.strip()],
        "legalDeadlines": deadlines,
        "timetable": timetable,
        "nextAction": next_action,
        "smallEntities": [c.text.strip() for c in el.findall("SMALL_ENTITY_LIST/SMALL_ENTITY") if c.text and c.text.strip()],
        "govtLevels": [c.text.strip() for c in el.findall("GOVT_LEVEL_LIST/GOVT_LEVEL") if c.text and c.text.strip()],
        "federalism": text_of(el, "FEDERALISM") or None,
        "unfundedMandates": [c.text.strip() for c in el.findall("UNFUNDED_MANDATE_LIST/UNFUNDED_MANDATE") if c.text and c.text.strip()],
        "rfaRequired": text_of(el, "RFA_REQUIRED") or None,
        "relatedRins": related,
        "furtherInfoUrl": text_of(el, "FURTHER_INFO_URL") or None,
        "publicCommentUrl": text_of(el, "PUBLIC_COMMENT_URL") or None,
    }


STAGES = ["Prerule Stage", "Proposed Rule Stage", "Final Rule Stage", "Long-Term Actions", "Completed Actions"]
PRIORITIES = ["Economically Significant", "Other Significant", "Substantive, Nonsignificant",
              "Routine and Frequent", "Info./Admin./Other"]


def agenda_summary(entries):
    """Counts by stage, priority and flags for a list of parsed RINs (one agency or the whole agenda)."""
    by_stage = {s: 0 for s in STAGES}
    by_priority = {p: 0 for p in PRIORITIES}
    other_stage = other_priority = 0
    for e in entries:
        if e["stage"] in by_stage:
            by_stage[e["stage"]] += 1
        else:
            other_stage += 1
        if e["priority"] in by_priority:
            by_priority[e["priority"]] += 1
        else:
            other_priority += 1
    return {
        "total": len(entries),
        "byStage": by_stage,
        "otherStage": other_stage,
        "byPriority": by_priority,
        "otherPriority": other_priority,
        "major": sum(1 for e in entries if e["major"] == "Yes"),
        "regulatoryPlan": sum(1 for e in entries if e["regulatoryPlan"]),
        "withLegalDeadline": sum(1 for e in entries if e["legalDeadlines"]),
        "withNextAction": sum(1 for e in entries if e["nextAction"]),
    }


# ---------------------------------------------------------------------------------------------------------------
# U.S. Government Manual (GovInfo bulk XML)
# ---------------------------------------------------------------------------------------------------------------
ENTITY_TAGS = ("Entity", "SubEntityLevelOne", "SubEntityLevelTwo", "SubEntityLevelThree")


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def govman_leadership(entity, max_tables=8, max_rows=40):
    """Leadership tables as printed: [{header, url, rows: [{name, title} | {heading}]}]; separators dropped."""
    tables = []
    for table in entity.findall("LeaderShipTables/LeaderShipTable")[:max_tables]:
        rows = []
        for value in table.findall("LeaderShipTableValues/Values"):
            name = clean(value.findtext("NameColumnValue"))
            title = clean(value.findtext("TitleColumnValue"))
            if not title or re.fullmatch(r"-{3,}", title):
                continue
            rows.append({"name": name, "title": title} if name else {"heading": title})
            if len(rows) >= max_rows:
                break
        if not any("name" in r for r in rows):
            continue
        header = clean(table.findtext("Header"))
        url = clean(table.findtext("FooterDetails/WebAddress"))
        tables.append({"header": "" if header in ("*", "") else header,
                       "url": url if re.match(r"^https?://", url) else None, "rows": rows})
    return tables


def govman_paragraphs(entity, path, max_chars=900):
    texts = [clean(p.text) for p in entity.findall(path) if p is not None and clean(p.text)]
    text = " ".join(texts)
    if len(text) > max_chars:
        text = text[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    return text or None


def govman_entities(root):
    """Flatten the Government Manual tree: [{entityId, parentEntityId, name, category, level, element}]."""
    out = []

    def walk(el, parent_id, level):
        for child in el:
            if child.tag in ENTITY_TAGS:
                out.append({"entityId": child.get("EntityId"), "parentEntityId": parent_id,
                            "name": clean(child.findtext("AgencyName")), "category": clean(child.findtext("Category")),
                            "level": level, "element": child})
                kids = child.find("Childrens")
                if kids is not None:
                    walk(kids, child.get("EntityId"), level + 1)

    walk(root, None, 0)
    return out


def govman_record(entity, children_names):
    el = entity["element"]
    website = None
    for addr in el.findall("Addresses/Address"):
        url = clean(addr.findtext("FooterDetails/WebAddress"))
        if re.match(r"^https?://", url):
            website = url
            break
    return {
        "entityId": entity["entityId"],
        "name": entity["name"],
        "category": entity["category"],
        "mission": govman_paragraphs(el, "MissionStatement/Record/Paragraph"),
        "website": website,
        "leadership": govman_leadership(el),
        "components": children_names[:40],
        "legalAuthority": govman_paragraphs(el, "LegalAuthority/Record/Paragraph", 500),
    }


# ---------------------------------------------------------------------------------------------------------------
# Census population and state codes
# ---------------------------------------------------------------------------------------------------------------
STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
    "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
    "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR",
}


def census_population(rows, column="POPESTIMATE2025"):
    """USPS -> population from NST-EST2025-ALLDATA rows (state-level SUMLEV 040 only)."""
    out = {}
    for row in rows:
        if row.get("SUMLEV") != "040":
            continue
        usps = STATE_FIPS.get((row.get("STATE") or "").zfill(2))
        value = row.get(column)
        if usps and value and value.isdigit():
            out[usps] = int(value)
    return out


# ---------------------------------------------------------------------------------------------------------------
# Arithmetic helpers
# ---------------------------------------------------------------------------------------------------------------
def pct_change(after, before):
    if not isinstance(after, (int, float)) or not isinstance(before, (int, float)) or before == 0:
        return None
    return round(100.0 * (after - before) / abs(before), 1)


def share_pct(part, whole):
    if not isinstance(part, (int, float)) or not isinstance(whole, (int, float)) or whole <= 0:
        return None
    return round(100.0 * part / whole, 3)


def rank_desc(values):
    """{key: rank} by descending value (ties share the lower rank number), Nones excluded."""
    ordered = sorted(((v, k) for k, v in values.items() if isinstance(v, (int, float))), key=lambda x: -x[0])
    out, last, last_rank = {}, None, 0
    for i, (v, k) in enumerate(ordered, 1):
        if v != last:
            last_rank, last = i, v
        out[k] = last_rank
    return out


def median(values):
    vals = sorted(v for v in values if isinstance(v, (int, float)))
    if not vals:
        return None
    mid = len(vals) // 2
    return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
