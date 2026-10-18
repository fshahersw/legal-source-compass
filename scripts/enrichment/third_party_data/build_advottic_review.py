"""PRIVATE review note: Advottic templates.json and tools pages (describe, licence, usefulness; default exclude with reason).

Not a dataset and not for publication. Writes private/build/third_party_data/advottic_templates_tools_review.json.
The Advottic statute-of-limitations table is handled only by build_sol_discrepancies.py (private discrepancy report).

Usage: python3 -I -B build_advottic_review.py
"""
import hashlib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "third_party_data", "advottic")
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def main():
    path = os.path.join(ACQ, "templates.json")
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    templates = []
    for t in data["templates"]:
        tokens = sorted(set(re.findall(r"\{\{(\w+)\}\}", t["body"])))
        templates.append({"slug": t["slug"], "title": t["title"], "category": t["category"], "last_reviewed": t["lastReviewed"], "source_url": t["sourceUrl"],
                          "body_chars": len(t["body"]), "placeholders": tokens, "warnings": len(t["warnings"]), "one_line": t["oneLine"]})
    shared_licence = {
        "dataset_licence": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) per the JSON-LD 'license' field and https://advottic.com/open-data (attribution required)",
        "terms_of_use": "https://advottic.com/terms (last updated 2026-04-25): Acceptable use forbids to 'scrape [the service], or use it to train another AI system'; Advottic keeps all rights to its software, brand and prompt design; it is 'not a law firm' and gives no legal advice",
        "conflict": "The open-data page invites reuse and AI training under CC BY 4.0 while the Terms of Use forbid scraping and AI training of the service. The dataset-specific grant is the narrower, later-listed licence for these files, but the conflict is unresolved, so nothing is published without an owner decision.",
    }
    report = {
        "title": "Advottic templates.json and tools: review (private; default exclude)",
        "hold": "PRIVATE. Not a dataset; nothing here is published. Time Limits data is never created or edited from Advottic content.",
        "templates_json": {
            "url": "https://advottic.com/open-data/templates.json", "path": os.path.relpath(path, ROOT), "sha256": sha(path),
            "name": data["name"], "version": data["version"], "date_published": data["datePublished"], "publisher": data["publisher"]["name"],
            "count": len(templates), "templates": templates, **shared_licence,
            "description": "Five generic consumer form letters / agreements (demand letter, mutual NDA, cease and desist, lease termination notice, security deposit demand) with context, four warnings each, a body with {{token}} placeholders, and keywords. All five carry lastReviewed 2026-06-08 and cite only their own advottic.com/templates page; no reviewer is named.",
            "usefulness": "Low for this atlas. The atlas publishes sourced law, court records and agency data; it does not draft or distribute form documents. The templates are not litigation-, MDL- or mass-tort-specific, are not official court forms, and have no primary-source citation behind the 'lawyer-reviewed' claim.",
            "decision": "exclude",
            "reasons": ["generic consumer templates unrelated to litigation research; the corpus already carries official court forms from courts",
                        "no primary source or named reviewer behind the 'lawyer-reviewed' claim (AGENTS.md: no unsourced data)",
                        "publishing usable form text invites reliance; the publisher itself disclaims legal advice",
                        "licence conflict between the open-data grant (CC BY 4.0) and the Terms of Use (no scraping / no AI training)"],
        },
        "tools": [
            {"name": "Statute of limitations checker", "url": "https://advottic.com/tools/statute-of-limitations", "what": "Lookup front end over the same 51 x 9 table as statute-of-limitations.json, returning the period plus one caveat.",
             "licence": "Same as statute-of-limitations.json (CC BY 4.0 on the data; interactive tool itself under the Terms of Use)", "usefulness": "None beyond the data file: it only displays the table, which has no per-entry statutory citations.",
             "decision": "exclude", "reason": "Time Limits owner hold; the table feeds only the private discrepancy report (sol_discrepancies.md/.json)."},
            {"name": "Court deadline calculator", "url": "https://advottic.com/tools/court-deadline-calculator", "what": "Date arithmetic from an event date using FRCP windows and 'typical 30 days' state windows, with optional weekend roll.",
             "licence": "Terms of Use; no data licence stated", "usefulness": "Low and risky: generic windows ('typical'), the page itself says 'Confirm your state code'; the corpus rule is that only a verified rule moves a date.",
             "decision": "exclude", "reason": "unsourced rule-of-thumb deadlines would conflict with the Time Limits engine (verified rules only); calculators are not data."},
            {"name": "Security deposit deduction checker", "url": "https://advottic.com/tools/security-deposit-deduction-checker", "what": "State tenant-deposit math: cap, return deadline, itemisation, interest and penalty per state.",
             "licence": "Terms of Use; no data licence stated", "usefulness": "None for litigation research; landlord-tenant consumer help with unsourced statutory summaries.",
             "decision": "exclude", "reason": "out of scope and unsourced."},
        ],
        "other_advottic_files": {"small_claims_json": "https://advottic.com/open-data/small-claims.json is listed on the open-data page (monetary limits, fees, appeal windows for small claims courts). It was not requested and is not part of this assignment; it would raise the same Time Limits / provenance issues."},
    }
    with open(os.path.join(BUILD, "advottic_templates_tools_review.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
    print(json.dumps({"templates": len(templates), "decision": report["templates_json"]["decision"]}))


if __name__ == "__main__":
    main()
