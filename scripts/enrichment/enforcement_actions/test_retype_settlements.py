"""Offline tests for retype_settlements (rows shaped like the published `settlements` dataset). No network.

  cd scripts/enrichment/enforcement_actions && python3 -B -m unittest -v test_retype_settlements
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retype_settlements as rs  # noqa: E402

QUAL = "Discovery layer ... publisher's own assertions ..."


def aggregator_row(rid, title, slug, family, *, review_case=None, state="", payout=True):
    sections = [{"items": [], "heading": "Documents (0 saved)", "text": "No official page or document has been saved for this reference."}]
    if payout:
        sections.append({"text": "$15,000,000 Settlement Fund. Without Valid Proof of Purchase: a Cash Payment of Forty Dollars ($40.00).",
                         "heading": "Payout text (publisher, verbatim; never summed)"})
    if review_case:
        sections.append({"rows": [["Court", "United States District Court for the Eastern District of Pennsylvania"], ["Case number", review_case]],
                         "header": ["Field", "Value"], "heading": "Bounded manual review of selected fields (not a docket review)"})
    sections.append({"text": "Not a court record ... arithmetic on the publisher date against 2026-09-19 ...", "heading": "What this record is not"})
    links = [{"url": "https://www.example-settlement.com/", "label": "Official site"}]
    return {
        "id": rid, "category": "settlements", "state": state, "title": title, "source_url": "https://www.example-settlement.com/", "ordinal": 3,
        "item": {"id": rid, "title": title, "links": list(links), "badges": [family[1], "Publisher reference (unverified)", "Mass-tort keyword"],
                 "subtitle": "Open for claims - publisher-reported, publisher last checked 2026-07-17",
                 "cells": {"family": family[1], "deadline": "2026-11-09 (future as of 2026-09-19; publisher-reported)", "documents": "None saved", "settlement": title}},
        "detail": {"id": rid, "title": title, "subtitle": "Open for claims - publisher-reported", "qualification": QUAL, "sections": sections,
                   "links": links + [{"url": f"https://settlesignal.com/settlements/{slug}/", "label": "Publisher page (SettleSignal)"}],
                   "facts": [["Record layer", "Publisher reference (third-party aggregator)"],
                             ["Source", "Third-party consumer settlement aggregator (SettleSignal); not a court, agency or administrator"],
                             ["Publisher status (publisher-reported)", "Open for claims"],
                             ["Claim deadline (publisher-reported)", "2026-11-09 (future as of 2026-09-19; publisher-reported)"],
                             ["Amount as printed in title", "none printed in title"],
                             ["States (as published)", "CA"], ["Verification", "Publisher self-assertion; not independently verified"],
                             ["Publisher type / category", "class_action_settlement / Securities & Investors"],
                             ["Family", f"{family[1]} - explicit mass-tort keyword in title (keyword mention only)"],
                             ["Mass-tort keyword", "keyword mention: Drugs"]]},
        "text": f"{rid} {title} {QUAL}",
        "filters": {"date": "2026-11-09", "state": [state] if state else [], "family": [family[0]], "_listing": ["yes"], "doc_type": [],
                    "mass_tort": ["yes"], "has_documents": ["no"], "deadline_state": ["future"], "has_court_documents": ["no"]},
    }


GENERIC = aggregator_row("settlement-2e7d7fe813cc01dae14e", "Generic Drugs End-Payer Antitrust Settlement",
                         "generic-drugs-end-payer-antitrust-settlement", ("mdl_mass_tort", "MDL / mass tort (keyword)"),
                         review_case="2:16-md-02724-CMR / MDL 2724")
TOMS = aggregator_row("settlement-820a4ed96341eab377fd", "Colgate Tom's of Maine Contamination Settlement",
                      "colgate-toms-of-maine-contamination-settlement", ("mdl_mass_tort", "MDL / mass tort (keyword)"), state="CA")
ACU = aggregator_row("settlement-15b36c9f7a2fa82508b9", "Hyundai and Kia Airbag Control Unit Settlement",
                     "hyundai-and-kia-airbag-control-unit-settlement", ("mdl_mass_tort", "MDL / mass tort (keyword)"))
BREACH = aggregator_row("settlement-aaaa", "Example Health Data Breach Settlement", "example-health-data-breach-settlement",
                        ("data_breach", "Data breach"))
AFFF_PAGE = {
    "id": "settlement-page-7a29c3ef9974ef137551", "category": "settlements", "state": "", "ordinal": 9,
    "title": "Aqueous Film-Forming Foam (AFFF) Products Liability Litigation (MDL 2873) – District Court for the District of South Carolina, Master Docket No. 2:18-mn-2873-RMG",
    "source_url": "https://www.scd.uscourts.gov/mdl-2873/", "text": "x",
    "item": {"id": "settlement-page-7a29c3ef9974ef137551", "title": "AFFF", "subtitle": "Saved official page (saved 2026-09-19); no publisher record",
             "links": [{"url": "https://www.scd.uscourts.gov/mdl-2873/", "label": "Official site"}], "badges": ["MDL / mass tort (keyword)", "Saved document", "Mass-tort keyword"],
             "cells": {"family": "MDL / mass tort (keyword)", "deadline": "No deadline published", "documents": "1 saved official page/file", "settlement": "AFFF"}},
    "detail": {"id": "settlement-page-7a29c3ef9974ef137551", "title": "AFFF", "subtitle": "Saved official page", "qualification": QUAL, "links": [],
               "sections": [{"heading": "What this record is not", "text": "... publisher date ..."}],
               "facts": [["Record layer", "Saved official page (no catalog record)"], ["Source", "No publisher record: this row is a saved page"],
                         ["Family", "MDL / mass tort (keyword) - keyword mention only"], ["Mass-tort keyword", "keyword mention: AFFF"]]},
    "filters": {"date": "", "state": [], "family": ["mdl_mass_tort"], "_listing": ["yes"], "doc_type": ["settlement_website_home"],
                "mass_tort": ["yes"], "has_documents": ["yes"], "deadline_state": ["unknown"], "has_court_documents": ["no"]},
}
DOCKET = {
    "id": "mdl-docket-2846", "category": "settlements", "state": "", "ordinal": 1, "title": "Settlement-phrase docket search for MDL 2846",
    "source_url": "https://www.courtlistener.com/docket/7603829/", "text": "x",
    "item": {"id": "mdl-docket-2846", "title": "t", "subtitle": "s", "badges": ["MDL / mass tort (court docket evidence)", "Docket-entry evidence (not a settlement record or amount)"],
             "links": [{"url": "https://www.courtlistener.com/docket/7603829/", "label": "Master docket on CourtListener"}],
             "cells": {"family": "MDL / mass tort (court docket evidence)", "deadline": "No deadline published", "documents": "7 court docket entries", "settlement": "t"}},
    "detail": {"id": "mdl-docket-2846", "title": "t", "subtitle": "s", "qualification": QUAL, "links": [],
               "sections": [{"heading": "What this record is not", "text": "Not a settlement record, not an amount."}],
               "facts": [["Record layer", "Settlement-phrase docket search"], ["Master docket", "2:18-md-02846 (ohsd), CourtListener docket id 7603829"],
                         ["Family", "MDL / mass tort (court docket evidence) - ..."], ["Mass-tort keyword", "keyword mention in the JPML title: Hernia Mesh"]]},
    "filters": {"date": "", "state": [], "family": ["mdl_court_docket"], "_listing": ["yes"], "doc_type": [], "mass_tort": ["yes"],
                "has_documents": ["no"], "deadline_state": ["unknown"], "has_court_documents": ["yes"]},
}
CLAIMS = [{"id": "settle:hyundai-and-kia-airbag-control-unit-settlement",
           "item": {"settlement": {"case_numbers": [{"as_written": "2:19-ml-02905-JAK-JPR"}]}}},
          {"id": "settle:example-health-data-breach-settlement", "item": {"settlement": {"case_numbers": [{"as_written": "1:24-cv-00001"}]}}}]


class RetypeSettlementsTests(unittest.TestCase):
    def setUp(self):
        self.rows, self.report = rs.retype_all([GENERIC, TOMS, ACU, BREACH, AFFF_PAGE, DOCKET], CLAIMS)
        self.by_id = {r["id"]: r for r in self.rows}

    def test_no_keyword_mass_tort_family(self):
        fams = {r["id"]: r["filters"]["family"][0] for r in self.rows}
        self.assertNotIn("mdl_mass_tort", fams.values())
        self.assertEqual(fams[TOMS["id"]], "reference")
        self.assertEqual(fams[BREACH["id"]], "reference")
        for r in self.rows:
            self.assertNotIn("mass_tort", r["filters"])
            self.assertNotIn("Mass-tort keyword", r["item"]["badges"])
            self.assertNotIn("Mass-tort keyword", [k for k, _ in r["detail"]["facts"]])

    def test_mdl_only_from_docket_form_or_verified_master_docket(self):
        self.assertEqual(self.by_id[GENERIC["id"]]["filters"]["mdl"], ["2724"])
        self.assertEqual(self.by_id[ACU["id"]]["filters"]["mdl"], ["2905"])
        self.assertEqual(self.by_id[AFFF_PAGE["id"]]["filters"]["mdl"], ["2873"])
        self.assertEqual(self.by_id[DOCKET["id"]]["filters"]["family"], ["mdl_docket"])
        self.assertEqual(self.by_id[DOCKET["id"]]["filters"]["mdl"], ["2846"])
        self.assertEqual(self.by_id[TOMS["id"]]["filters"]["mdl"], [])
        self.assertEqual(self.by_id[BREACH["id"]]["filters"]["mdl"], [])  # a -cv- case number never names an MDL

    def test_aggregator_fields_are_removed(self):
        for r in self.rows:
            blob = json.dumps(r, ensure_ascii=False).lower()
            self.assertNotIn("settlesignal", blob)
            self.assertNotIn("publisher-reported", blob)
            self.assertNotIn("forty dollars", blob)
            self.assertFalse([s for s in r["detail"]["sections"] if s["heading"].lower().startswith("payout text")])
            self.assertNotIn("deadline", r["item"]["cells"])
            for k in ("deadline_state", "date", "state"):
                self.assertNotIn(k, r["filters"])
            self.assertEqual(r["state"], "")
            self.assertFalse([k for k, _ in r["detail"]["facts"] if "publisher" in k.lower()])
        toms = self.by_id[TOMS["id"]]
        self.assertEqual(toms["item"]["subtitle"], "Official site: www.example-settlement.com")
        self.assertEqual(toms["item"]["cells"]["official_site"], "www.example-settlement.com")

    def test_confirmed_record_linked_by_exact_slug(self):
        acu = self.by_id[ACU["id"]]
        self.assertEqual(acu["filters"]["has_confirmed_record"], ["yes"])
        self.assertIn("/records/settlement_claims_official/settle%3Ahyundai-and-kia-airbag-control-unit-settlement",
                      [l["url"] for l in acu["item"]["links"]])
        self.assertEqual(self.by_id[TOMS["id"]]["filters"]["has_confirmed_record"], ["no"])
        self.assertEqual(self.report["confirmed_records_linked"], 2)

    def test_review_and_docket_evidence_are_kept(self):
        generic = self.by_id[GENERIC["id"]]
        self.assertIn("Bounded manual review of selected fields (not a docket review)", [s["heading"] for s in generic["detail"]["sections"]])
        docket = self.by_id[DOCKET["id"]]
        self.assertEqual(docket["detail"]["sections"][0]["text"], "Not a settlement record, not an amount.")
        self.assertIn("Docket-entry evidence (not a settlement record or amount)", docket["item"]["badges"])

    def test_metadata_drops_deadline_and_keyword_filters(self):
        old = {"id": "settlements", "aliases": ["settlements"], "listing": {"filters": [{"name": "doc_type", "options": [{"value": "settlement_website_home", "label": "Settlement website home page"}]}]},
               "listing_modes": {"default": {}}, "summary": {"records": 869}}
        meta = rs.metadata_for(old, self.rows)
        names = [f["name"] for f in meta["listing"]["filters"]]
        for gone in ("deadline_state", "mass_tort", "state", "dfrom", "dto"):
            self.assertNotIn(gone, names)
        self.assertEqual(meta["aliases"], ["settlements"])
        self.assertEqual(meta["listing_modes"]["default"]["columns"], meta["listing"]["columns"])
        fam = next(f for f in meta["listing"]["filters"] if f["name"] == "family")
        self.assertEqual(sum(o["count"] for o in fam["options"]), len(self.rows))
        self.assertNotIn("settlesignal", json.dumps(meta).lower())


if __name__ == "__main__":
    unittest.main()
