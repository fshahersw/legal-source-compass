"""State-level tables of a Consumer Sentinel Network Data Book: rankings, Appendix C losses, state pages."""
import re

from ftc_parse import (
    STATES,
    UNRANKED,
    find_chunks,
    identify_state_page,
    national_category_vocab,
    parse_appendix_c,
    parse_rank_rows,
    parse_state_page,
    population_basis,
    split_pages,
    validate_id_theft_types,
    validate_ranking,
    validate_top_categories,
)


def parse_states(markdown, year):
    """Parse the state-level content of one Data Book.

    Returns (states, book, problems):
      states   {usps: {...}} one entry per state/territory with every figure that passed validation
      book     facts about the book itself (chunks used, population basis year, sums)
      problems list of book-level validation failures (a state-level failure is kept in states[usps]['withheld'])
    """
    pages = split_pages(markdown)
    problems = []
    fo_idx = find_chunks(pages, r"StateRankings:FraudandOtherReports")[-1]
    it_idx = find_chunks(pages, r"StateRankings:IdentityTheftReports")[-1]
    ac_idx = find_chunks(pages, r"AppendixC:Fraud")[-1]

    fo, fo_p = parse_rank_rows(pages[fo_idx])
    it, it_p = parse_rank_rows(pages[it_idx])
    ac, ac_p = parse_appendix_c(pages[ac_idx])
    problems += fo_p + it_p + ac_p
    problems += validate_ranking(fo, f"{year} fraud and other reports ranking")
    problems += validate_ranking(it, f"{year} identity theft ranking")
    for usps in STATES:
        if usps not in ac:
            problems.append(f"{year}: {usps} missing from Appendix C")

    vocab = national_category_vocab(pages)
    page_of = {}
    for idx in range(it_idx + 1, len(pages)):
        usps, how = identify_state_page(pages[idx])
        if usps and "| Category | Share" in pages[idx]:
            if usps in page_of:
                problems.append(f"{year}: second page for {usps} at chunk {idx}")
            else:
                page_of[usps] = (idx, how)

    states = {}
    for usps in STATES:
        withheld = []
        row = {
            "usps": usps,
            "year": year,
            "fraud_other": fo.get(usps),
            "identity_theft": it.get(usps),
            "fraud": ac.get(usps),
            "top_categories": None,
            "id_theft_types": None,
            "page_chunk": None,
            "page_identified_by": None,
            "checks": {},
        }
        if usps in ac and usps in fo and ac[usps]["reports"] > fo[usps]["reports"]:
            withheld.append("fraud reports exceed fraud-and-other reports")
            row["fraud"] = None
        if usps in page_of:
            idx, how = page_of[usps]
            row["page_chunk"], row["page_identified_by"] = idx, how
            sp = parse_state_page(pages[idx], set(vocab))
            ints = set(sp["integers"])
            fo_ok = usps in fo and fo[usps]["reports"] in ints
            it_ok = usps in it and it[usps]["reports"] in ints
            row["checks"]["page_prints_fraud_other_total"] = fo_ok
            row["checks"]["page_prints_identity_theft_total"] = it_ok
            if usps not in UNRANKED:
                row["checks"]["page_prints_fraud_other_rank"] = bool(fo.get(usps) and fo[usps]["rank"] in sp["ordinals"])
            if not fo_ok:
                withheld.append("state page does not print the ranking-table report total; page content not used")
            else:
                cat_problems = list(sp["problems"]) + validate_top_categories(sp["top_categories"])
                if cat_problems:
                    withheld.append("top categories withheld: " + "; ".join(cat_problems))
                else:
                    row["top_categories"] = [{"category": n, "share_pct": s} for n, s in sp["top_categories"]]
                theft_problems = list(sp["problems"]) + validate_id_theft_types(sp["id_theft_types"])
                if theft_problems:
                    withheld.append("identity theft types withheld: " + "; ".join(theft_problems))
                else:
                    row["id_theft_types"] = [{"type": n, "share_pct": s} for n, s in sp["id_theft_types"]]
        else:
            withheld.append("no state page found")
        row["withheld"] = withheld
        states[usps] = row

    sums = {
        "fraud_reports": sum(r["fraud"]["reports"] for r in states.values() if r["fraud"]),
        "total_loss_usd": sum(r["fraud"]["total_loss_usd"] for r in states.values() if r["fraud"]),
        "fraud_other_reports": sum(r["fraud_other"]["reports"] for r in states.values() if r["fraud_other"]),
        "identity_theft_reports": sum(r["identity_theft"]["reports"] for r in states.values() if r["identity_theft"]),
    }
    book = {
        "year": year,
        "chunks": {"fraud_other_ranking": fo_idx, "identity_theft_ranking": it_idx, "appendix_c": ac_idx},
        "population_basis_year": population_basis(pages[fo_idx]),
        "population_basis_year_identity_theft": population_basis(pages[it_idx]),
        "state_sums": sums,
    }
    if book["population_basis_year"] != book["population_basis_year_identity_theft"]:
        problems.append(f"{year}: population basis differs between ranking tables")
    return states, book, problems
