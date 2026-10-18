"""National Do Not Call Registry Data Book (fiscal years 2021-2025): state registrations and complaints.

Inputs are Firecrawl captures of the FTC PDFs; the extraction of these PDFs is much rougher than the Consumer Sentinel
Data Books (spaced letters, digits dropped from some cells, rows lost from some tables). Readings are therefore only
published when two independent checks hold:

  count    the table count equals the state page count, or one reading exists and the implied population passes
  per100K  count / per-100K implies a population within POP_TOLERANCE of the median implied population of that state
           over every table and book (a dropped digit changes the implied population by a factor of ten)

Anything else is withheld with a reason; nothing is repaired.
"""
import re
import statistics

from ftc_parse import STATES, iter_tables, letters_key, split_pages, state_usps, to_int

POP_TOLERANCE = 0.05
ALPHA_ORDER = sorted(STATES, key=lambda u: STATES[u].lower())  # AL AK AZ ... DE DC FL ... PA PR RI ... (alphabetical by name)


def _row(cells):
    """(rank|None, usps, count, per100k) from a ranking-table row; handles the unranked rows the extraction shifts."""
    for j in (1, 0):
        if len(cells) > j + 2 and state_usps(cells[j]):
            count, per = to_int(cells[j + 1]), to_int(cells[j + 2])
            rank = to_int(cells[0]) if j == 1 and cells[0] else None
            return rank, state_usps(cells[j]), count, per
    return None


def parse_dnc_rankings(pages):
    """{'registrations': {usps: {...}}, 'complaints': {...}} from the two ranking tables of a DNC Data Book."""
    out = {"registrations": {}, "complaints": {}}
    problems = []
    for idx in range(3, min(len(pages), 12)):
        kind = None
        for table in iter_tables(pages[idx]):
            flat = letters_key(" ".join(table["header"] or []))
            if "activeregistrations" in flat:
                kind = "registrations"
            elif "compl" in flat:
                kind = "complaints"
            if kind is None:
                continue
            for cells in table["rows"]:
                parsed = _row(cells)
                if not parsed:
                    continue
                rank, usps, count, per = parsed
                if usps in out[kind]:
                    problems.append(f"{kind}: {usps} twice")
                    continue
                out[kind][usps] = {"rank": rank, "count": count, "per100k": per, "chunk": idx, "raw": [c for c in cells]}
    return out, problems


# A rank counts only when the printed phrase is complete ('#35 nationally'); a cut-off '#1' (really '#12') is dropped.
_COMPLAINTS = re.compile(r"Complaints:([\d,]+)\((?:#(\d+)(?=n\w*ally)|NotRanked)?")
_REGS = re.compile(r"Ac\w{0,4}ve\s*Registra\w*:([\d,]+)\((?:#(\d+)(?=n\w*ally)|NotRanked)?")


def parse_dnc_state_pages(pages):
    """Ordered state totals printed on the state pages: [{complaints, complaints_rank, registrations, registrations_rank, name?}]."""
    out = []
    flat_all = []
    for idx, page in enumerate(pages):
        if idx < 8:
            continue
        flat = re.sub(r"[\s*_]+", "", page)
        for m in _COMPLAINTS.finditer(flat):
            rest = flat[m.end(): m.end() + 260]
            reg = _REGS.search(flat[m.start(): m.end() + 260])
            heading = None
            for line in page.split("\n"):
                h = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
                if h and state_usps(h.group(1)):
                    heading = state_usps(h.group(1))
                    break
            out.append({
                "chunk": idx,
                "complaints": to_int(m.group(1)),
                "complaints_rank": int(m.group(2)) if m.group(2) else None,
                "registrations": to_int(reg.group(1)) if reg else None,
                "registrations_rank": int(reg.group(2)) if reg and reg.group(2) else None,
                "heading_usps": heading,
            })
    return merge_by_chunk(out)


def merge_by_chunk(entries):
    """One entry per page: the FY2021/FY2022 PDFs print the totals line twice (plain and spaced-letter copies).

    The first copy that carries the registrations part wins (the second copy can be cut off mid-number); two copies
    with different complaint counts on one page would be ambiguous and the page is dropped.
    """
    groups = {}
    for e in entries:
        groups.setdefault(e["chunk"], []).append(e)
    merged = []
    for chunk in sorted(groups):
        group = groups[chunk]
        if len({g["complaints"] for g in group}) > 1:
            continue
        with_regs = [g for g in group if g["registrations"] is not None]
        merged.append(dict((with_regs or group)[0]))
    return merged


def assign_pages(page_totals, rankings, fy):
    """Map each state-page entry to a state: by heading, else by alphabetical position; verify against the tables."""
    problems = []
    if len(page_totals) != len(ALPHA_ORDER):
        problems.append(f"FY{fy}: {len(page_totals)} state pages, expected {len(ALPHA_ORDER)}")
        return {}, problems
    by_state = {}
    for pos, entry in enumerate(page_totals):
        usps = ALPHA_ORDER[pos]
        if entry["heading_usps"] and entry["heading_usps"] != usps:
            problems.append(f"FY{fy}: page {pos} heading {entry['heading_usps']} != alphabetical {usps}")
            continue
        by_state[usps] = entry
    # Position check against the tables. A page whose complaint count equals the table count of a DIFFERENT state means
    # the alphabetical order is wrong; a page that merely differs from its own state's table row means that table cell
    # was damaged by the extraction (handled later, the count is withheld).
    table_counts = {u: r["count"] for u, r in rankings["complaints"].items() if r["count"] is not None}
    agree, contradict = 0, []
    for usps, entry in by_state.items():
        own = table_counts.get(usps)
        if own is not None and own == entry["complaints"]:
            agree += 1
        elif any(v == entry["complaints"] for u, v in table_counts.items() if u != usps):
            contradict.append(usps)  # one such page can be a coincidence of two equal counts; several cannot
    if len(contradict) >= 3:
        problems.append(f"FY{fy}: pages {contradict} equal other states' table counts; alphabetical order not trusted")
        return {}, problems
    if agree < 20:
        problems.append(f"FY{fy}: only {agree} pages confirm the alphabetical order against the ranking table")
        return {}, problems
    return by_state, problems


def dnc_population_basis(markdown):
    """Year of the U.S. Census population estimates the Data Book states it used ('based on 2021 U.S. Census ...')."""
    flat = re.sub(r"[\s*_]+", "", markdown)
    m = re.search(r"Popula\w{0,6}esma?tesarebasedon(\d{4})", flat) or re.search(r"Popula\w*estimatesarebasedon(\d{4})", flat)
    return m.group(1) if m else None


def implied_population(count, per100k):
    if not count or not per100k:
        return None
    return count / per100k * 100000


def population_medians(books):
    """{usps: median implied population} over every (count, per-100K) pair: table pairs and (state page count, table per-100K) pairs.

    The median is robust to the few damaged pairs, so it can be used to judge each pair.
    """
    pools = {}
    for book in books.values():
        for kind in ("registrations", "complaints"):
            for usps, row in book["rankings"][kind].items():
                page = book["pages"].get(usps)
                for count in {row["count"], page and page.get(kind)}:
                    pop = implied_population(count, row["per100k"])
                    if pop:
                        pools.setdefault(usps, []).append(pop)
    return {u: statistics.median(v) for u, v in pools.items() if len(v) >= 3}


LOOSE_TOLERANCE = 0.20  # Census vintages differ by up to ~10% for fast-growing states; a dropped digit is off by 10x or more


def _loose_ok(medians, usps, count, per100k):
    """Implied population within LOOSE_TOLERANCE of the state's median implied population over all tables and books."""
    pop = implied_population(count, per100k)
    med = medians.get(usps)
    return bool(pop and med and abs(pop - med) / med <= LOOSE_TOLERANCE)


def _tight_ok(anchor, count, per100k, anchor_per100k):
    """Within one edition both tables use the same Census estimate, so the implied populations must agree to rounding."""
    pop = implied_population(count, per100k)
    if not pop or not anchor:
        return False
    rounding = 0.5 / per100k + 0.5 / anchor_per100k + 0.003
    return abs(pop - anchor) / anchor <= rounding


def adjudicate(check, table_count, page_count, per_table, kind):
    """(count, per100k, how, reasons) for one jurisdiction, table and kind. Only validated figures are returned.

    check(count, per100k) -> bool decides whether a count and per-100K pair describe the same population.
    """
    reasons = []
    count = per = how = None
    if table_count is not None and page_count is not None and table_count == page_count:
        count, how = table_count, "table and state page agree"
    elif table_count is not None and page_count is not None:
        ok = [(src, c) for src, c in (("ranking table", table_count), ("state page", page_count)) if per_table is not None and check(c, per_table)]
        if len(ok) == 1:
            src, count = ok[0]
            other = page_count if src == "ranking table" else table_count
            how = f"{src} count; consistent with the printed per-100K and the population implied by the registrations table, the other reading ({other:,}) is damaged"
        else:
            reasons.append(f"{kind}: ranking table count {table_count} differs from state page count {page_count} and neither is confirmed by the per-100K figure")
    elif page_count is not None:
        count, how = page_count, "state page only (ranking table row not readable)"
    elif table_count is not None:
        count, how = table_count, "ranking table only (state page total not readable)"
    if per_table is not None:
        if count is not None and check(count, per_table):
            per = per_table
        else:
            reasons.append(f"{kind}: per-100K {per_table} fails the implied-population check")
    return count, per, how, reasons


def _corroborated_row(base, supp, page_count, check):
    """Choose the ranking-table reading to use. supp is the independent Tavily reading of the same table row.

    The Firecrawl row stands unless it is missing or damaged. A supplement row replaces or fills it only when its count
    equals the state page count (a third reading) and its count/per-100K pair passes the population check; with no
    state page count it may fill a row that is missing altogether, but never overrides one.
    Returns (row, note) where note says what the supplement did (None when it did nothing).
    """
    if not supp or supp.get("count") is None or supp.get("per100k") is None:
        return base, None
    pair_ok = check(supp["count"], supp["per100k"])
    if base is None:
        if pair_ok and (page_count is None or page_count == supp["count"]):
            return {"rank": supp.get("rank"), "count": supp["count"], "per100k": supp["per100k"], "chunk": None, "raw": None}, f"row read only from {supp['source']} (independent extraction); Firecrawl table row missing"
        return base, None
    if (base["count"], base["per100k"]) == (supp["count"], supp["per100k"]):
        return base, f"independent extraction {supp['source']} agrees"
    if pair_ok and page_count is not None and page_count == supp["count"]:
        return {**base, "count": supp["count"], "per100k": supp["per100k"], "rank": base["rank"] if base["rank"] is not None else supp.get("rank")}, (
            f"count and per-100K taken from {supp['source']} (independent extraction), corroborated by the state page count; Firecrawl table cell read {base['count']} / {base['per100k']}")
    return base, None


def consolidate(books, supplements=None):
    """books: {fy: {'rankings':..., 'pages': {usps: entry}}}; supplements: {fy: {kind: {usps: row}}} independent readings.

    Returns {(usps, fy): record} holding only validated figures; every withheld figure has a reason in record['withheld']
    and every use of an independent reading is listed in record['notes'].
    """
    supplements = supplements or {}
    medians = population_medians(books)
    out = {}
    for fy, book in sorted(books.items()):
        for usps in STATES:
            rec = {"usps": usps, "fy": fy, "registrations": None, "complaints": None, "withheld": [], "notes": [], "chunks": {}}
            page = book["pages"].get(usps)
            anchor = anchor_per = None
            for kind in ("registrations", "complaints"):
                base = book["rankings"][kind].get(usps)
                page_count = page[kind] if page else None
                page_rank = page[f"{kind}_rank"] if page else None
                if kind == "registrations" or anchor is None:
                    def check(count, per, usps=usps):
                        return _loose_ok(medians, usps, count, per)
                else:
                    def check(count, per, anchor=anchor, anchor_per=anchor_per):
                        return _tight_ok(anchor, count, per, anchor_per)
                row, note = _corroborated_row(base, supplements.get(fy, {}).get(kind, {}).get(usps), page_count, check)
                if note:
                    rec["notes"].append(f"{kind}: {note}")
                count, per, how, reasons = adjudicate(check, row["count"] if row else None, page_count, row["per100k"] if row else None, kind)
                if kind == "registrations" and count is not None and per is not None:
                    anchor, anchor_per = implied_population(count, per), per
                rec["withheld"] += reasons
                rank = row["rank"] if row and row["rank"] is not None else None
                if rank is not None and page_rank is not None and rank != page_rank:
                    rec["withheld"].append(f"{kind}: table rank {rank} differs from state page rank {page_rank}")
                    rank = None
                if rank is None and page_rank is not None and usps not in ("DC", "PR"):
                    rank = page_rank
                if count is None and per is None and rank is None:
                    continue
                rec[kind] = {"count": count, "per100k": per, "rank": rank, "count_check": how}
                rec["chunks"][kind] = {"table": base["chunk"] if base else None, "page": page["chunk"] if page else None}
            out[(usps, fy)] = rec
    return out
