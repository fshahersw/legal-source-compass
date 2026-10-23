"""Offline unit tests for the regulatory-finance builders (synthetic fixtures, no network).

Run:  cd scripts/enrichment/regfin && python3 -B -m unittest -v test_regfin
"""
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import bd_parse  # noqa: E402
import build_regfin as br  # noqa: E402
import frb_parse  # noqa: E402
import ia_parse  # noqa: E402
import names  # noqa: E402
import stats_parse  # noqa: E402

PROFILES = [
    ("0000000001", "Acme Bank Holding Co"),
    ("0000000002", "Twin Corp"),
    ("0000000003", "Twin Corporation"),
    ("0000000099", "Brokerage Partners, LLC"),
]


def companies():
    return names.Companies(PROFILES)


class TestNames(unittest.TestCase):
    def test_normalize_matches_documented_rules(self):
        self.assertEqual(names.normalize_company("The Wells Fargo & Company"), "wells fargo and")
        self.assertEqual(names.normalize_company("SEALED AIR CORP/DE"), "sealed air")
        self.assertEqual(names.normalize_company("SEACOR HOLDINGS INC /NEW/"), "seacor holdings")
        self.assertEqual(names.normalize_company("Merck & Co., Inc."), "merck and")  # "&" becomes "and"; "Co." and "Inc." are suffixes
        self.assertEqual(names.normalize_company(""), "")
        self.assertEqual(names.normalize_company(None), "")

    def test_parity_with_enforcement_actions_normalisation(self):
        path = HERE.parent / "enforcement_actions" / "extract.py"
        if not path.exists():
            self.skipTest("enforcement_actions/extract.py not present")
        spec = importlib.util.spec_from_file_location("ea_extract", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        samples = ["ABBOTT LABORATORIES", "Merck & Co., Inc.", "KB HOME", "SEALED AIR CORP/DE", "Energy Transfer, LP", "The J.M. Smucker Company",
                   "Wells Fargo & Company", "U.S. Bancorp", "Bank of America, National Association", "ST JOE Co", "AT&T Inc."]
        for sample in samples:
            self.assertEqual(names.normalize_company(sample), module.normalize_company(sample), sample)

    def test_pad_cik(self):
        self.assertEqual(names.pad_cik("782124"), "0000782124")
        self.assertEqual(names.pad_cik(" 0000782124 "), "0000782124")
        self.assertIsNone(names.pad_cik(""))
        self.assertIsNone(names.pad_cik("12;34"))
        self.assertIsNone(names.pad_cik("12345678901"))

    def test_companies_unique_ambiguous_none(self):
        c = companies()
        self.assertEqual(c.by_name("ACME BANK HOLDING COMPANY")[:2], ("matched", "0000000001"))
        state, ciks, key = c.by_name("Twin Corp.")
        self.assertEqual((state, key), ("ambiguous", "twin"))
        self.assertEqual(ciks, ["0000000002", "0000000003"])
        self.assertEqual(c.by_name("Acme Bank")[0], "none")  # prefix is not a match
        self.assertEqual(c.by_name("")[0], "none")
        self.assertEqual(c.by_cik("0000000099"), "0000000099")
        self.assertIsNone(c.by_cik("0000000098"))

    def test_location_split(self):
        cases = {
            "Wells Fargo & Company, San Francisco, California": ("Wells Fargo & Company", "San Francisco, California"),
            "Ontario Bancorporation, Inc., Ontario, Wisconsin": ("Ontario Bancorporation, Inc.", "Ontario, Wisconsin"),
            "Sandy Spring Bank, Olney, Maryland": ("Sandy Spring Bank", "Olney, Maryland"),
            "J.P. Morgan Chase & Co., New York, NY": ("J.P. Morgan Chase & Co.", "New York, NY"),
            "XYZ Bank, Washington, D.C.": ("XYZ Bank", "Washington, D.C."),
            "Community FSB Holding Company": ("Community FSB Holding Company", None),
            "Bank of America, National Association, Charlotte, North Carolina": ("Bank of America, National Association", "Charlotte, North Carolina"),
            "Mizuho Bank, Ltd., Tokyo, Japan": ("Mizuho Bank, Ltd., Tokyo, Japan", None),  # only U.S. states are treated as locations
            "Fifth Third Bank, Co.": ("Fifth Third Bank, Co.", None),  # 'Co.' is a name tail, not Colorado
        }
        for text, expected in cases.items():
            self.assertEqual(names.org_name_without_location(text), expected, text)

    def test_split_organizations(self):
        self.assertEqual(
            names.split_organizations("American Express Company, New York, New York; American Express Travel Related Services Company, Inc., New York, New York"),
            ["American Express Company, New York, New York", "American Express Travel Related Services Company, Inc., New York, New York"],
        )
        self.assertEqual(
            names.split_organizations("U & I Financial Corp., Lynnwood, Washington and UniBank, Lynnwood, Washington"),
            ["U & I Financial Corp., Lynnwood, Washington", "UniBank, Lynnwood, Washington"],
        )
        # 'and' inside a name is not a split point
        self.assertEqual(names.split_organizations("Smith and Jones Bank, Austin, Texas"), ["Smith and Jones Bank, Austin, Texas"])
        self.assertEqual(names.split_organizations(None), [])
        self.assertEqual(names.split_organizations(" ; "), [])


def utf16_file(lines):
    return b"\xff\xfe" + "\r\n".join([" "] + lines).encode("utf-16-le")


class TestBdParse(unittest.TestCase):
    def test_parse_utf16_with_quirky_first_line(self):
        raw = utf16_file([
            "0000001904\tABRAHAM SECURITIES CORPORATION\t00829452\t3724 47TH STREET CT\t\tGIG HARBOR\tWA\t98335\t",
            "0000002554\tAEI  SECURITIES, INC.\t00816750\t1300 WELLS FARGO PLACE\t30 SEVENTH STREET EAST\tST. PAUL\tMN\t55101-4901\t",
            "",
            "NOT A DATA LINE",
        ])
        rows, skipped = bd_parse.parse(raw)
        self.assertEqual([r["cik"] for r in rows], ["0000001904", "0000002554"])
        self.assertEqual(rows[1]["name"], "AEI SECURITIES, INC.")  # whitespace collapsed, nothing else changed
        self.assertEqual(rows[0]["address2"], "")
        self.assertEqual(rows[1]["zip"], "55101-4901")
        self.assertEqual(skipped, ["NOT A DATA LINE"])

    def test_utf8_accepted(self):
        rows, _ = bd_parse.parse("0000000005\tX CO\t00800001\ta\t\tb\tNY\t10001\t\n".encode("utf-8"))
        self.assertEqual(rows[0]["state"], "NY")

    def test_short_or_bad_cik_rows_are_skipped(self):
        rows, skipped = bd_parse.parse(utf16_file(["123\tSHORT CIK\t00800001\ta\t\tb\tNY\t10001\t", "0000000005\ttoo few\tcols"]))
        self.assertEqual(rows, [])
        self.assertEqual(len(skipped), 2)

    def test_month_label(self):
        self.assertEqual(bd_parse.month_from_label("October 2026"), "2026-10")
        self.assertEqual(bd_parse.month_from_label(" March 2007 "), "2007-03")
        self.assertIsNone(bd_parse.month_from_label("Oct 2026"))
        self.assertIsNone(bd_parse.month_from_label(""))


def bd_row(cik, name, file_number="00800001", city="NEW YORK", state="NY"):
    return {"cik": cik, "name": name, "file_number": file_number, "address1": "1 MAIN ST", "address2": "", "city": city, "state": state, "zip": "10001"}


class TestBdBuild(unittest.TestCase):
    def months(self):
        def month(label, rows):
            return {"file": f"{label}.txt", "url": f"https://example.test/{label}.txt", "label": label, "rows": rows}

        return {
            "2020-01": month("m1", [bd_row("0000000099", "BROKERAGE PARTNERS, LLC"), bd_row("0000000010", "OLD NAME BD")]),
            "2020-02": month("m2", [bd_row("0000000099", "BROKERAGE PARTNERS, LLC"), bd_row("0000000010", "NEW NAME BD")]),
            # 2020-03 has no published file
            "2020-04": month("m4", [bd_row("0000000099", "BROKERAGE PARTNERS, LLC"), bd_row("0000000020", "NEWCOMER BD", state="TX")]),
        }

    def test_aggregation_and_matching(self):
        rows, lst, summary, inputs, stats = br.build_bd(companies(), self.months())
        overview, records = rows[0], {r["id"]: r for r in rows[1:]}
        self.assertEqual(overview["id"], "summary:overview")
        self.assertEqual(overview["filters"]["_listing"], ["no"])
        ov = overview["item"]["overview"]
        self.assertEqual(ov["missing_months"], ["2020-03"])
        self.assertEqual([s["count"] for s in ov["series"]], [2, 2, 2])
        self.assertEqual(ov["latest_month"], "2020-04")
        self.assertEqual(set(records), {"bd:0000000099", "bd:0000000010", "bd:0000000020"})
        bp = records["bd:0000000099"]["item"]["broker_dealer"]
        self.assertEqual((bp["first_listed"], bp["last_listed"], bp["months_listed"], bp["in_latest_file"]), ("2020-01", "2020-04", 3, True))
        gone = records["bd:0000000010"]["item"]["broker_dealer"]
        self.assertFalse(gone["in_latest_file"])
        self.assertEqual(gone["name"], "NEW NAME BD")  # fields of the last file that lists it
        self.assertEqual([h["name"] for h in gone["name_history"]], ["OLD NAME BD", "NEW NAME BD"])
        self.assertEqual(records["bd:0000000010"]["source_url"], "https://example.test/m2.txt")
        # exact CIK match to a profile gives a /companies link; others do not
        self.assertTrue(any(l["url"] == "/companies/0000000099" for l in records["bd:0000000099"]["item"]["links"]))
        self.assertFalse(any(l["url"].startswith("/companies/") for l in records["bd:0000000010"]["item"]["links"]))
        self.assertEqual(stats["cik_in_company_sec_profiles"], 1)
        self.assertEqual(records["bd:0000000099"]["filters"]["company"], ["0000000099"])

    def test_duplicate_cik_in_a_month_is_an_error(self):
        months = self.months()
        months["2020-01"]["rows"].append(bd_row("0000000099", "DUP"))
        with self.assertRaises(SystemExit):
            br.build_bd(companies(), months)

    def test_all_months_between(self):
        self.assertEqual(br.all_months_between("2019-11", "2020-02"), ["2019-11", "2019-12", "2020-01", "2020-02"])


IA_HEADER = [
    "SEC Region", "Organization CRD#", "SEC#", "Firm Type", "CIK#", "Total number of CIK numbers", "Primary Business Name", "Legal Name",
    "Main Office Street Address 1", "Main Office Street Address 2", "Main Office City", "Main Office State", "Main Office Country",
    "Main Office Postal Code", "Main Office Telephone Number", "Main Office Private Residence Flag", "Mail Office Street Address 1",
    "Mail Office Private Residence Flag", "SEC Current Status", "SEC Status Effective Date", "Latest ADV Filing Date", "Form Version",
    "Website Address", "3A", "5F(2)(a)", "5F(2)(b)", "5F(2)(c)", "5F(2)(f)", "11", "11C(2)", "Count of 11C(2) disclosures", "11H(2)",
    "Count of 11H(2) disclosures",
]


def ia_row(**kw):
    base = dict.fromkeys(IA_HEADER, "")
    base.update({"SEC Region": "NYRO", "Firm Type": "Registered", "Main Office Private Residence Flag": "N", "Main Office Country": "United States",
                 "Mail Office Private Residence Flag": "N", "11": "N", "11C(2)": "N", "11H(2)": "N"})
    base.update(kw)
    return [base[h] for h in IA_HEADER]


class TestIaParse(unittest.TestCase):
    def test_dates_money_counts(self):
        self.assertEqual(ia_parse.iso_date("08/22/2000"), "2000-08-22")
        self.assertIsNone(ia_parse.iso_date("13/01/2000"))
        self.assertIsNone(ia_parse.iso_date("02/30/2000"))
        self.assertIsNone(ia_parse.iso_date(""))
        self.assertIsNone(ia_parse.iso_date("2000-08-22"))
        self.assertEqual(ia_parse.money("           150,000,000.00"), 150000000.0)
        self.assertEqual(ia_parse.money("                      .00"), 0.0)
        self.assertIsNone(ia_parse.money(""))
        self.assertIsNone(ia_parse.money("n/a"))
        self.assertEqual(ia_parse.count("                   12"), 12)
        self.assertIsNone(ia_parse.count(""))

    def test_record_from_row(self):
        row = ia_row(**{"Organization CRD#": "70", "SEC#": "801-56943", "CIK#": "9319", "Total number of CIK numbers": "1",
                        "Legal Name": "BCG  SECURITIES, INC.", "Primary Business Name": "BCG SECURITIES, INC.", "Main Office City": "CHERRY HILL",
                        "Main Office State": "NJ", "SEC Status Effective Date": "11/04/1999", "5F(2)(a)": "  100.00", "5F(2)(b)": "  50.00",
                        "5F(2)(c)": "  150.00", "5F(2)(f)": "  7", "11": "Y", "11C(2)": "Y", "Count of 11C(2) disclosures": "2"})
        rec = ia_parse.record_from_row(IA_HEADER, row)
        self.assertEqual(rec["legal_name"], "BCG SECURITIES, INC.")
        self.assertEqual(rec["status_effective_date"], "1999-11-04")
        self.assertEqual((rec["raum_total_usd"], rec["accounts_total"]), (150.0, 7))
        self.assertEqual(rec["disclosure_yes_items"], [{"item": "11C(2)", "count": 2}])
        self.assertEqual(rec["disclosure_any"], "Y")
        self.assertIsNone(rec["website"])  # blank -> Not recorded

    def test_private_residence_street_and_phone_are_withheld(self):
        row = ia_row(**{"Organization CRD#": "71", "Legal Name": "HOME ADVISER", "Main Office Street Address 1": "5 ELM ST",
                        "Main Office Telephone Number": "555-1212", "Main Office City": "AUSTIN", "Main Office State": "TX",
                        "Main Office Private Residence Flag": "Y"})
        rec = ia_parse.record_from_row(IA_HEADER, row)
        mo = rec["main_office"]
        self.assertIsNone(mo["street1"])
        self.assertIsNone(mo["phone"])
        self.assertTrue(mo["address_withheld"])
        self.assertEqual((mo["city"], mo["state"]), ("AUSTIN", "TX"))


class TestIaBuild(unittest.TestCase):
    def sources(self):
        reg = [
            ia_row(**{"Organization CRD#": "1", "SEC#": "801-1", "Legal Name": "ACME BANK HOLDING COMPANY", "CIK#": "", "Main Office State": "TX"}),
            ia_row(**{"Organization CRD#": "2", "SEC#": "801-2", "Legal Name": "SOME ADVISER LLC", "CIK#": "99", "Main Office State": "NY"}),
            ia_row(**{"Organization CRD#": "3", "SEC#": "801-3", "Legal Name": "TWIN CORP", "Main Office State": "CA"}),
            ia_row(**{"Organization CRD#": "4", "SEC#": "801-4", "Legal Name": "UNRELATED CAPITAL", "Primary Business Name": "ACME BANK HOLDING COMPANY",
                      "Main Office State": "CA", "11": "Y", "11H(2)": "Y", "Count of 11H(2) disclosures": "1"}),
        ]
        era = [ia_row(**{"Organization CRD#": "5", "SEC#": "802-5", "Firm Type": "ERA", "Legal Name": "FUND MANAGER LP", "Main Office State": "MA"})]
        return [("Registered", "reg.csv", IA_HEADER, reg, "https://example.test/ia.zip"), ("ERA", "era.csv", IA_HEADER, era, "https://example.test/era.zip")]

    def test_matching_rules(self):
        rows, lst, summary, inputs, stats = br.build_ia(companies(), self.sources())
        recs = {r["id"]: r for r in rows[1:]}
        self.assertEqual(set(recs), {"ia:1", "ia:2", "ia:3", "ia:4", "ia:5"})
        self.assertEqual(recs["ia:1"]["item"]["investment_adviser"]["profile_match"]["method"], "exact normalised legal name (unique)")
        self.assertEqual(recs["ia:1"]["filters"]["company"], ["0000000001"])
        # exact CIK key: CIK 99 -> profile 0000000099 even though the legal name differs
        self.assertEqual(recs["ia:2"]["item"]["investment_adviser"]["profile_match"]["method"], "exact CIK")
        self.assertEqual(recs["ia:2"]["filters"]["company"], ["0000000099"])
        # ambiguous key never links
        self.assertNotIn("profile_match", recs["ia:3"]["item"]["investment_adviser"])
        self.assertEqual(recs["ia:3"]["filters"]["company"], [])
        # Primary Business Name is never used for matching
        self.assertNotIn("profile_match", recs["ia:4"]["item"]["investment_adviser"])
        self.assertEqual((stats["matched_by_name"], stats["matched_by_cik"], stats["ambiguous_name"], stats["unmatched"]), (1, 1, 1, 2))
        self.assertEqual(recs["ia:4"]["item"]["investment_adviser"]["disclosure_yes_items"], [{"item": "11H(2)", "count": 1}])
        self.assertEqual(recs["ia:5"]["item"]["cells"]["raum"], "Not applicable (exempt reporting adviser)")
        self.assertEqual(rows[0]["item"]["overview"]["registered"], 4)

    def test_same_crd_in_both_files_is_an_error(self):
        src = self.sources()
        src[1][3].append(ia_row(**{"Organization CRD#": "1", "Legal Name": "DUP", "Firm Type": "ERA"}))
        with self.assertRaises(SystemExit):
            br.build_ia(companies(), src)


def item(**kw):
    base = {"id": "100", "edt": "2020-05-01", "tdt": "1950-01-01", "type": "Written Agreement", "bkorg": "", "url": "/newsevents/pressreleases/enforcement20200501a.htm", "urlname": "Press Release"}
    base.update(kw)
    return {k: v for k, v in base.items() if v is not None}


class TestFrbParse(unittest.TestCase):
    def test_action_fields(self):
        a = frb_parse.action_from_item(item(bkorg="Wells Fargo &amp; Company, San Francisco, California", tdt="2026-03-04", type="Cease and Desist Order"))
        self.assertEqual(a["banking_organization"], "Wells Fargo & Company, San Francisco, California")  # entity decoded
        self.assertEqual(a["termination_date"], "2026-03-04")
        self.assertEqual(a["url"], "https://www.federalreserve.gov/newsevents/pressreleases/enforcement20200501a.htm")
        self.assertEqual(a["year"], "2020")
        self.assertEqual(a["subject"], "organization")
        self.assertEqual(a["organizations"][0]["key"], "wells fargo and")

    def test_placeholder_termination_is_none_published(self):
        self.assertIsNone(frb_parse.action_from_item(item(bkorg="X Bank, Reno, Nevada"))["termination_date"])

    def test_individual_with_affiliation(self):
        a = frb_parse.action_from_item(item(person="Renee Nicole Brown", porg="Sandy Spring Bank, Olney, Maryland", type="Prohibition from Banking"))
        self.assertEqual(a["subject"], "individual")
        self.assertEqual(a["affiliations"][0]["name"], "Sandy Spring Bank")
        self.assertEqual(a["organizations"], [])

    def test_missing_url_stays_none(self):
        a = frb_parse.action_from_item(item(bkorg="X Bank, Reno, Nevada", url=None, urlname=None))
        self.assertIsNone(a["url"])
        self.assertIsNone(a["url_label"])

    def test_dne_placeholder_and_unresolvable_urls(self):
        dne = frb_parse.action_from_item(item(bkorg="X Bank, Reno, Nevada", url="DNE", urlname=None))
        self.assertIsNone(dne["url"])
        self.assertIsNone(dne["url_unresolved"])  # 'DNE' is the Board's "no document", not a value
        bare = frb_parse.action_from_item(item(bkorg="X Bank, Reno, Nevada", url="boarddocs/press/enforcement/2003/20030827/default.htm"))
        self.assertIsNone(bare["url"])  # not resolved against a guessed base
        self.assertEqual(bare["url_unresolved"], "boarddocs/press/enforcement/2003/20030827/default.htm")

    def test_note_with_link_is_plain_text_plus_link(self):
        a = frb_parse.action_from_item(item(bkorg="X Bank, Reno, Nevada", note="<a href='/newsevents/pressreleases/enforcement20200408a.htm'>Modification</a> issued on 4/08/2020"))
        self.assertEqual(a["note"], "Modification issued on 4/08/2020")
        self.assertEqual(a["note_links"], [{"label": "Modification", "url": "https://www.federalreserve.gov/newsevents/pressreleases/enforcement20200408a.htm"}])
        self.assertNotIn("<", a["note"])

    def test_unusable_items_raise(self):
        for bad in (item(id=""), item(edt="05/01/2020"), item(type="")):
            with self.assertRaises(ValueError):
                frb_parse.action_from_item(bad)

    def test_type_families(self):
        cases = {
            "Written Agreement": "Written agreements",
            "Amendment to 09/05/2000 Written Agreement": "Amendments and modifications",
            "Cease and Desist Order": "Cease-and-desist and consent orders",
            "Cease and Desist Order, Civil Money Penalty": "Cease-and-desist and consent orders",
            "Civil Money Penalty, $5,000 and Cease and Desist Order": "Civil money penalties",
            "Civil Money Penalty $50,000 (collectively with X)": "Civil money penalties",
            "Prohibition from Banking, Civil Money Penalty": "Prohibitions and suspensions",
            "Order of Prohibition and Order to Cease and Desist": "Prohibitions and suspensions",
            "Notice of Suspension and Prohibition": "Prohibitions and suspensions",
            "Section 19 Letters": "Section 19 letters",
            "Prompt Corrective Action": "Prompt corrective action",
            "Notice of Intent": "Notices of intent",
            "Consent Order": "Cease-and-desist and consent orders",
            "Modifications": "Amendments and modifications",
            "Order to Terminate Activities": "Other order types",
            "Orders on Interlocutory Review": "Other order types",
        }
        for text, family in cases.items():
            self.assertEqual(frb_parse.type_family(text), family, text)

    def test_csv_signature_matches_json_across_quote_style(self):
        a = frb_parse.action_from_item(item(person="Clark M. Clifford", porg='Credit and Commerce American Holdings ("BCCI")', type="Notice of Intent"))
        row = {"Effective Date": "2020-05-01", "Termination Date": "", "Individual": "Clark M. Clifford", "Individual Affiliation": "Credit and Commerce American Holdings ('BCCI')",
               "Banking Organization": "", "Action": "Notice of Intent", "URL": "/newsevents/pressreleases/enforcement20200501a.htm", "Name": "Press Release", "Note": ""}
        self.assertEqual(frb_parse.csv_signature(row), frb_parse.action_signature(a))
        row["Individual"] = "Someone Else"
        self.assertNotEqual(frb_parse.csv_signature(row), frb_parse.action_signature(a))


class TestFrbBuild(unittest.TestCase):
    def actions(self):
        items = [
            item(id="1", edt="2019-03-01", bkorg="Acme Bank Holding Company, Austin, Texas", type="Cease and Desist Order"),
            item(id="2", edt="2020-04-01", bkorg="Twin Corp., Dallas, Texas", type="Written Agreement"),
            item(id="3", edt="2020-05-01", bkorg="Other Bank, Reno, Nevada", type="Civil Money Penalty $5,000"),
            item(id="4", edt="2021-06-01", person="Pat Doe", porg="Acme Bank Holding Company, Austin, Texas", type="Prohibition from Banking"),
            item(id="5", edt="2021-07-01", bkorg="Acme Bank Holding Company, Austin, Texas; Other Bank, Reno, Nevada", type="Written Agreement", url=None, urlname=None),
        ]
        return [frb_parse.action_from_item(i) for i in items]

    def test_matching_counts_and_links(self):
        rows, lst, summary, inputs, stats = br.frb_build(self.actions(), companies())
        recs = {r["id"]: r for r in rows[1:]}
        self.assertEqual(rows[0]["id"], "summary:overview")
        self.assertEqual([r["id"] for r in rows[1:]], ["frb:5", "frb:4", "frb:3", "frb:2", "frb:1"])  # newest first
        self.assertEqual(recs["frb:1"]["filters"]["company"], ["0000000001"])
        self.assertTrue(any(l["url"] == "/companies/0000000001" for l in recs["frb:1"]["item"]["links"]))
        self.assertEqual(recs["frb:2"]["filters"]["company"], [])  # ambiguous 'twin'
        self.assertEqual(recs["frb:3"]["filters"]["company"], [])
        self.assertEqual(recs["frb:1"]["filters"]["name_key"], ["acme bank holding"])
        # an individual's affiliation is a different relation: the company filter holds it, the labelled link says so
        self.assertEqual(recs["frb:4"]["filters"]["affiliation_key"], ["acme bank holding"])
        self.assertEqual(recs["frb:4"]["filters"]["name_key"], [])
        self.assertIn("individual's affiliation", " ".join(l["label"] for l in recs["frb:4"]["item"]["links"]))
        self.assertEqual(recs["frb:5"]["source_url"], "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm")
        self.assertEqual((stats["matched_subject"], stats["matched_affiliation"], stats["ambiguous_subject"]), (2, 1, 1))
        self.assertEqual(stats["unmatched_subject"], 2)  # 'Other Bank' named in two actions
        years = rows[0]["item"]["overview"]["by_year_family"]
        self.assertEqual(years["2020"], {"Written agreements": 1, "Civil money penalties": 1})
        self.assertEqual(rows[0]["item"]["overview"]["latest_effective_date"], "2021-07-01")

    def test_duplicate_ids_are_an_error(self):
        acts = self.actions()
        acts.append(acts[0])
        with self.assertRaises(SystemExit):
            br.frb_build(acts, companies())


class TestStatsParse(unittest.TestCase):
    def test_table_parse(self):
        import openpyxl

        wb = openpyxl.Workbook()
        notes = wb.active
        notes.title = "Notes"
        notes.append(["General", "text"])
        notes.append(["Tab.1.1", "Number of Advisers\nThis table relies on Item 2A."])
        ws = wb.create_sheet("Tab.1.1")
        ws.append(["Type of Adviser", "Basis", "2000", "2001", "2002"])
        ws.append(["RIA", "Subtotal", 6551, None, 7736])
        ws.append(["Total", "Total", 6551, 7458, 7736])
        ws.append(["Return to Notes"])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.xlsx")
            wb.save(path)
            note_map, tables = stats_parse.read_workbook(path)
        self.assertEqual(list(tables), ["Tab.1.1"])
        t = stats_parse.parse_table("Tab.1.1", tables["Tab.1.1"], note_map["Tab.1.1"])
        self.assertEqual(t["title"], "Number of Advisers")
        self.assertEqual(t["method_note"], "This table relies on Item 2A.")
        self.assertEqual(t["years"], [2000, 2001, 2002])
        self.assertEqual(t["label_columns"], ["Type of Adviser", "Basis"])
        self.assertEqual(t["rows"][0], {"labels": ["RIA", "Subtotal"], "values": [6551, None, 7736]})  # blank stays None, never 0
        self.assertEqual(len(t["rows"]), 2)  # 'Return to Notes' dropped

    def test_no_year_columns_is_an_error(self):
        with self.assertRaises(ValueError):
            stats_parse.parse_table("Tab.x", [["a", "b"], [1, 2]], None)


class TestHelpers(unittest.TestCase):
    def test_prune_and_join(self):
        self.assertEqual(br.prune({"a": None, "b": {"c": None}, "d": [], "e": 0, "f": False, "g": [{"h": None, "i": 1}]}), {"e": 0, "f": False, "g": [{"i": 1}]})
        self.assertEqual(br.join_address("ONE KENDALL SQUARE, BUILDING 200,", "SUITE B2201", "", None), "ONE KENDALL SQUARE, BUILDING 200, SUITE B2201")
        self.assertEqual(br.money_label(40460934.0), "$40.46 million")
        self.assertEqual(br.money_label(None), "Not recorded")


if __name__ == "__main__":
    unittest.main()
