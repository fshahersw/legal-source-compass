"""Unit tests for the SEC evidence rules. Run: python3 -m unittest scripts/enrichment/sec/test_evidence.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evidence as ev  # noqa: E402
import targets as tg  # noqa: E402

C = {"pl_terms": tg.PL_TERMS, "mdl_terms": tg.MDL_TERMS}


class NumberPattern(unittest.TestCase):
    def test_variants_match(self):
        for text in ["MDL No. 2924", "MDL 2924", "MDL-2924", "MDL Docket No. 2924", "mdl no 2924", "Case No. 9:20-md-02924", "20-md-2924"]:
            self.assertTrue(ev.number_pattern(2924).search(text), text)

    def test_no_prefix_or_suffix_collisions(self):
        for text in ["MDL No. 29245", "MDL No. 1292", "MDL No. 2724 and 2924 shares", "Interchange MDL 1720"]:
            self.assertIsNone(ev.number_pattern(2924).search(text), text)

    def test_needs_litigation_context(self):
        mining = "Peabody holds the southern area covering ML 6949 and MDL 3040 under an exploration program."
        self.assertIsNone(ev.verify(mining, tier="A", mdl=3040, caption=None, aliases=["Peabody"]))
        court = "Claims against Perrigo were transferred to the court in In re Zantac, MDL No. 2924."
        self.assertIsNotNone(ev.verify(court, tier="A", mdl=2924, caption=None, aliases=["Perrigo"]))

    def test_needs_reference_to_registrant(self):
        precedent = "See In re Takata Airbag Products Liability Litigation, MDL No. 2599 (S.D. Fla.), settlements with BMW and Mazda."
        self.assertIsNone(ev.verify(precedent, tier="A", mdl=2599, caption=None, aliases=["Visa"], main_document=False))
        # In the registrant's own report "we" refers to the registrant.
        own = "We are a defendant in the court proceedings, In re Takata Airbag Products Liability Litigation, MDL No. 2599."
        self.assertIsNotNone(ev.verify(own, tier="A", mdl=2599, caption=None, aliases=["Ford"], main_document=True))

    def test_exhibit_precedent_list_is_rejected(self):
        credentials = ("Visa retained the administrator, whose prior notice programs include In re Amino Acid Lysine Antitrust "
                       "Litigation, MDL No. 1083; In re Factor Concentrate Blood Prods. Litigation, MDL No. 986; In re Diet Drugs, "
                       "MDL No. 1203; and In re Vioxx Products Liability Litigation, MDL No. 1657.")
        self.assertIsNone(ev.verify(credentials, tier="A", mdl=986, caption=None, aliases=["Visa"], main_document=False))
        # The same list in the registrant's own report is a statement about the registrant's MDLs.
        own = ("The Company is a defendant in In re Pelvic Repair System Litigation, MDL No. 2325, and in MDL No. 2326, "
               "MDL No. 2327 and MDL No. 2387 before the court.")
        self.assertIsNotNone(ev.verify(own, tier="A", mdl=2325, caption=None, aliases=["Endo"], main_document=True))

    def test_exhibit_needs_registrant_name_nearby(self):
        far = "Visa. " + "x " * 300 + "BP's settlement of claims in the Deepwater Horizon litigation, MDL No. 2179, used notice programs."
        self.assertIsNone(ev.verify(far, tier="A", mdl=2179, caption=None, aliases=["Visa"], main_document=False))
        near = "Visa announced that claims against Visa in MDL No. 2179 were dismissed by the court."
        self.assertIsNotNone(ev.verify(near, tier="A", mdl=2179, caption=None, aliases=["Visa"], main_document=False))


class Caption(unittest.TestCase):
    def test_symbols_and_punctuation_between_words(self):
        text = "the Company is named in a Multi-District Litigation (In re Zantac®/Ranitidine Products Liability Litigation, MDL No. 2924)"
        self.assertIsNotNone(ev.verify(text, tier="B", mdl=2924, caption="Zantac (Ranitidine) Products Liability Litigation"))

    def test_requires_every_word_in_order(self):
        text = "the Company: In re Zantac Products Liability Litigation"
        self.assertIsNone(ev.verify(text, tier="B", mdl=2924, caption="Zantac (Ranitidine) Products Liability Litigation"))

    def test_caption_core(self):
        self.assertEqual(tg.caption_core("IN RE: Proton-Pump Inhibitor Products Liability Litigation (No. II)"), "Proton-Pump Inhibitor Products Liability Litigation")


class Subject(unittest.TestCase):
    def test_needs_mdl_and_injury_terms_nearby(self):
        text = "Plaintiffs in the MDL allege that talc caused ovarian cancer; claims against the Company continue."
        self.assertIsNotNone(ev.verify(text, tier="C", mdl=2738, caption=None, subjects=tg.SUBJECTS[2738], **C))

    def test_plural_mdls(self):
        text = "We have been named in lawsuits alleging injuries from incretin medicines, coordinated in two federal MDLs."
        self.assertIsNotNone(ev.verify(text, tier="C", mdl=3094, caption=None, subjects=tg.SUBJECTS[3094], **C))

    def test_product_name_alone_is_not_enough(self):
        text = "We sell talc-free powder. " + "x " * 1200 + "An unrelated MDL concerns pricing."
        self.assertIsNone(ev.verify(text, tier="C", mdl=2738, caption=None, subjects=tg.SUBJECTS[2738], **C))

    def test_required_manufacturer_in_same_window(self):
        text = "The MDL for hernia mesh product liability claims against Covidien, a subsidiary of the Company, continues."
        self.assertIsNone(ev.verify(text, tier="C", mdl=2846, caption=None, subjects=tg.SUBJECTS[2846], **C))
        self.assertIsNotNone(ev.verify(text, tier="C", mdl=3029, caption=None, subjects=tg.SUBJECTS[3029], **C))

    def test_word_boundaries(self):
        text = "The MDL product liability docket covers CASRA injuries at the Company."
        self.assertIsNone(ev.subject_match(text, ("ASR",), (), tg.PL_TERMS, tg.MDL_TERMS))
        self.assertIsNone(ev.subject_match("MDL injuries Pinnacle hip at Bardstown", ("Pinnacle",), ("Bard",), tg.PL_TERMS, tg.MDL_TERMS))


class Documents(unittest.TestCase):
    def test_exhibit_types(self):
        self.assertTrue(ev.document_counts("10-K", "10-K"))
        self.assertTrue(ev.document_counts("8-K", "EX-99.1"))
        self.assertTrue(ev.document_counts("20-F", "EX-13"))
        self.assertFalse(ev.document_counts("10-K", "EX-10.8"))
        self.assertFalse(ev.document_counts("20-F", "EX-4.2"))

    def test_aliases(self):
        self.assertEqual(ev.name_aliases("PFIZER INC  (PFE)  (CIK 0000078003)"), ["PFIZER"])
        self.assertEqual(ev.name_aliases("3M CO  (MMM)  (CIK 0000066740)"), ["3M"])
        self.assertEqual(ev.name_aliases("KONINKLIJKE PHILIPS NV  (PHG, RYLPF)"), ["KONINKLIJKE", "PHILIPS"])
        self.assertEqual(ev.name_aliases("REVLON INC /DE/  (CIK 0000887921)"), ["REVLON"])


class Role(unittest.TestCase):
    def test_hints(self):
        self.assertEqual(ev.role_hint("As of March 29, 2025, the Company has not been named as a defendant in any Complaints filed in the MDL."), "not_named")
        self.assertEqual(ev.role_hint("The Company and certain subsidiaries have been named as defendants in lawsuits alleging injury."), "defendant")
        self.assertEqual(ev.role_hint("claims for personal injury have been made against Ethicon, Inc. (Ethicon) and the Company"), "defendant")
        self.assertEqual(ev.role_hint("Middlesex filed a lawsuit against 3M in the AFFF MDL.", ["Middlesex"]), "plaintiff")
        self.assertEqual(ev.role_hint("The MDL court issued a scheduling order."), "unclear")

    def test_punctuation_heavy_text_is_fast(self):
        import time
        text = "the Company " + ". " * 400 + " Item 3 Legal Proceedings " + "- , " * 400
        started = time.monotonic()
        ev.role_hint(text, ["Pfizer"])
        self.assertLess(time.monotonic() - started, 1.0)

    def test_other_parties_named_as_defendants_is_not_the_registrant(self):
        text = "CAWC and the other plaintiffs agreed to settle the lawsuits with some of the named defendants, who represent refiners."
        self.assertNotEqual(ev.role_hint(text, ["American", "Water"]), "defendant")


class Text(unittest.TestCase):
    def test_filing_text(self):
        raw = b"<html><style>.a{}</style><p>In re&#58; Talc&nbsp;MDL</p><script>x</script></html>"
        self.assertEqual(ev.filing_text(raw), "In re: Talc MDL")

    def test_excerpt_trims_to_words(self):
        text = "alpha beta gamma delta epsilon zeta eta theta"
        out = ev.excerpt(text, 17, 22, width=8)
        self.assertTrue(out.startswith("… ") and out.endswith(" …"))
        self.assertIn("delta", out)


if __name__ == "__main__":
    unittest.main()


class Claimant(unittest.TestCase):
    def test_class_member_statement_is_a_claimant(self):
        text = ("The AFFF MDL is intended to resolve claims against multiple defendant manufacturers. "
                "The Company is in the class of plaintiffs in the AFFF MDL. Annual payments by Dupont and 3M are expected.")
        self.assertEqual(ev.role_hint(text, ["Global", "Water"]), "plaintiff")

    def test_not_named_still_wins(self):
        text = "The Company has not been named as a defendant; the Company is a settlement class member."
        self.assertEqual(ev.role_hint(text), "not_named")


class RoleWindows(unittest.TestCase):
    def test_far_not_named_statement_does_not_override(self):
        text = ("The Company has been named as a defendant in the MDL No. 2875 cases. " + "x " * 600 +
                "The Company is not a party to the unrelated antitrust matter.")
        start = text.index("MDL No. 2875")
        self.assertEqual(ev.role_at(text, start, start + 12, ["Mylan"]), "defendant")

    def test_class_membership_read_from_wide_window(self):
        text = "Claims are coordinated in MDL No. 2873. " + "y " * 500 + "The Company is in the class of plaintiffs."
        start = text.index("MDL No. 2873")
        self.assertEqual(ev.role_at(text, start, start + 12), "plaintiff")


class Review2(unittest.TestCase):
    """Cases from the independent verification of the first publication."""

    def test_mdl_sentence_about_another_target_is_not_evidence(self):
        text = ("The Superior Court of Quebec has stayed the proposed Zantac class proceedings until the result of the "
                "US Multi-District Litigation (MDL) appeal is announced.\nTalc Product Litigation in the US\n"
                "Sanofi affiliates have been named in product liability actions regarding asbestos in talc products.")
        self.assertIsNone(ev.verify(text, tier="C", mdl=2738, caption=None, subjects=tg.SUBJECTS[2738],
                                    aliases=["Sanofi"], others=tg.other_terms(2738), **C))
        same = ("Sanofi affiliates have been named in product liability actions alleging talc caused ovarian cancer, "
                "and the federal cases were coordinated in an MDL in New Jersey.")
        self.assertIsNotNone(ev.verify(same, tier="C", mdl=2738, caption=None, subjects=tg.SUBJECTS[2738],
                                       aliases=["Sanofi"], others=tg.other_terms(2738), **C))

    def test_other_subject_in_mdl_sentence(self):
        text = ("Personal injury cases against the Company alleging that acetaminophen use caused ADHD have been "
                "consolidated in multi-district court litigation in the Southern District of New York. Cases alleging "
                "that Zantac sold by the Company caused cancer were dismissed in state court.")
        self.assertIsNone(ev.verify(text, tier="C", mdl=2924, caption=None, subjects=tg.SUBJECTS[2924],
                                    aliases=["Dollar"], others=tg.other_terms(2924), **C))

    def test_shared_words_do_not_exclude(self):
        self.assertNotIn("hernia mesh", tg.other_terms(2846))
        self.assertNotIn("Taxotere", tg.other_terms(3023))
        self.assertIn("Zantac", tg.other_terms(2738))

    def test_insurer_defending_policyholders_is_not_a_party(self):
        text = ("Lawsuits were consolidated under the caption In re: Methyl Tertiary Butyl Ether (MTBE) Products Liability "
                "Litigation. The Company is defending these claims under commercial auto policies which afford coverage.")
        self.assertIsNone(ev.verify(text, tier="B", mdl=1358, caption="Methyl Tertiary Butyl Ether (MTBE) Products Liability Litigation",
                                    aliases=["EMC"]))

    def test_claimant_sentences(self):
        self.assertEqual(ev.role_hint("CAWC, NJAW and Long Island Water Corporation are each plaintiffs in lawsuits relating to MTBE; "
                                      "the subsidiaries seek to recover cleanup costs.", ["Water"]), "plaintiff")
        self.assertEqual(ev.role_hint("In addition, we joined the Multi-District Litigation (MDL) related to the oil spill. "
                                      "We asserted claims for physical damage to property.", ["Joe"]), "plaintiff")
        self.assertEqual(ev.role_hint("Plaintiffs who are plaintiffs in the MDL assert claims against the Company.", ["Acme"]), "defendant")

    def test_role_does_not_read_the_previous_paragraph(self):
        text = ("Regeneron filed a lawsuit against Sanofi under the Collaboration Agreement; the court denied the motion.\n"
                "Dupixent Product Liability Litigation\n"
                "Product liability lawsuits have been filed against the Company claiming that Dupixent caused lymphoma; "
                "the federal cases were transferred to an MDL.")
        start = text.index("Dupixent Product")
        self.assertEqual(ev.role_at(text, start, start + 8, ["REGENERON"]), "defendant")

    def test_dismissal(self):
        text = "The MDL court granted the motion to dismiss; all claims against the Company were dismissed with prejudice."
        start = text.index("MDL")
        self.assertTrue(ev.dismissed_at(text, start, start + 3))
        self.assertFalse(ev.dismissed_at("In the MDL, 40 plaintiffs' cases were dismissed with prejudice by the court.", 7, 10))
        self.assertFalse(ev.dismissed_at("The Company is a defendant in the MDL.", 30, 33))

    def test_paragraphs_from_html(self):
        raw = b"<html><body><p>Zantac MDL appeal.</p><div>Talc litigation</div>line<br>wrap<br><br>next</body></html>"
        self.assertEqual(ev.filing_text(raw), "Zantac MDL appeal.\nTalc litigation\nline wrap\nnext")


class SectionRoles(unittest.TestCase):
    def test_earlier_paragraph_of_same_section_counts(self):
        text = ("Docetaxel\n• Personal Injury Actions\nA number of lawsuits have been filed against Hospira and Pfizer "
                "alleging permanent hair loss.\nIn October 2016, the federal cases were transferred to MDL-2740 in Louisiana.")
        start = text.index("MDL-2740")
        self.assertEqual(ev.role_at(text, start, start + 8, ["PFIZER"]), "defendant")

    def test_previous_section_does_not_bleed(self):
        text = ("Regeneron filed a complaint against Sanofi; the court denied the motion to dismiss.\n"
                "k. Dupixent Product Liability Litigation\n"
                "Since 2025, product liability lawsuits have been filed in various U.S. district and state courts against the "
                "Company claiming that Dupixent caused lymphoma; the JPML transferred them for pretrial proceedings.")
        start = text.rindex("Dupixent")
        self.assertEqual(ev.role_at(text, start, start + 8, ["REGENERON"]), "defendant")
        self.assertFalse(ev.dismissed_at(text, start, start + 8))

    def test_defendants_including(self):
        self.assertEqual(ev.role_hint("Numerous defendants, including EID and Chemours, have been named in AFFF matters.", ["Chemours"]), "defendant")


class SectionContext(unittest.TestCase):
    def test_required_term_in_previous_section_does_not_count(self):
        text = ("Pelvic mesh: the Company is in litigation with Bard over Bard's obligation to indemnify it.\n"
                "Hernia Mesh Litigation\n"
                "Plaintiffs filed lawsuits against subsidiaries of the Company alleging personal injury from hernia mesh "
                "products; the JPML transferred the actions to a federal Multidistrict Litigation in Massachusetts.")
        self.assertIsNone(ev.verify(text, tier="C", mdl=2846, caption=None, subjects=tg.SUBJECTS[2846],
                                    aliases=["Medtronic"], others=tg.other_terms(2846), **C))

    def test_defending_claims_is_a_defendant(self):
        self.assertEqual(ev.role_hint("The Company was defending approximately 7,090 product liability claims involving "
                                      "its line of hernia repair devices.", ["Becton"]), "defendant")


class HeadingSubject(unittest.TestCase):
    def test_heading_names_the_section_subject(self):
        text = ("Chantix\nA number of lawsuits have been filed against Pfizer alleging economic loss and personal injury "
                "from nitrosamine in Chantix; the federal cases were transferred to an MDL in New York.\nZantac\n"
                "Other matters.")
        self.assertIsNotNone(ev.verify(text, tier="C", mdl=3050, caption=None, subjects=tg.SUBJECTS[3050],
                                       aliases=["PFIZER"], others=tg.other_terms(3050), **C))

    def test_heading_does_not_reach_the_next_section(self):
        text = ("Talc Product Litigation in the US\nSanofi affiliates have been named in product liability actions over "
                "asbestos in talc products.\nZantac\nThe Zantac cases were coordinated in an MDL in Florida.")
        self.assertIsNone(ev.verify(text, tier="C", mdl=2738, caption=None, subjects=tg.SUBJECTS[2738],
                                    aliases=["Sanofi"], others=tg.other_terms(2738), **C))
