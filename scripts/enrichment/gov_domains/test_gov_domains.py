"""Offline tests for the gov_domains builder (synthetic fixtures shaped like the published files; no network, no private/ reads).

  cd scripts/enrichment/gov_domains && python3 -B -X utf8 -m unittest test_gov_domains
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gov_domains_lib as lib  # noqa: E402
import gov_domains_rows as rows  # noqa: E402
import court_domains_lib as courts  # noqa: E402

CISA_HEADER = "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email\n"
GSA_FULL_HEADER = "Domain name,Agency,Maintaining office,Use case,Type of government,Federal branch,State,Comments,Link,Date Added\n"
GSA_VIEW_HEADER = "Domain,Federal Agency,Level of Government,Location,Status,Note,Link,Date Added\n"
NOT_USED_HEADER = "Domain,Federal Agency,Level of Government,Location,Status,Note,Link,Date Added,,\n"

META = {
    "cisa": {"commit": "000237f4777395ae1282f596dd96b9815749f52f", "retrieved_at": "2026-10-23T06:56:28Z", "commit_date": "2026-10-22", "zone_export": "2026-10-22 12:54:30"},
    "gsa": {"commit": "f843a6b7cdfad0c3a53f7d32fd2e458f67383d64", "retrieved_at": "2026-10-23T06:56:22Z", "commit_date": "2025-11-14"},
    "summary_source_url": rows.CISA_VIEWER,
}


def csv_bytes(text, bom=False):
    return (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")


def cisa_rows(body):
    return lib.read_csv(csv_bytes(CISA_HEADER + body))


class ParsingTests(unittest.TestCase):
    def test_bom_and_extra_columns(self):
        out = lib.read_csv(csv_bytes(NOT_USED_HEADER + "old.com,,Local Government,Ohio,Deprecated,gone,,1/1/14 1:00,,\n", bom=True))
        self.assertEqual(out[0]["Domain"], "old.com")
        self.assertEqual(out[0]["Status"], "Deprecated")

    def test_entry_normalisation(self):
        e = lib.normalize_entry("  BrightonWI.com ")
        self.assertEqual((e["id"], e["host"], e["path"]), ("brightonwi.com", "brightonwi.com", None))
        self.assertEqual(e["published_as"], "BrightonWI.com")
        p = lib.normalize_entry("360eldorado.com/Government")
        self.assertEqual((p["id"], p["host"], p["path"]), ("360eldorado.com/government", "360eldorado.com", "Government"))
        self.assertEqual(p["published_as"], "360eldorado.com/Government")  # path case is kept for display
        ip = lib.normalize_entry("174.132.145.94/~hope")
        self.assertEqual((ip["host_kind"], ip["path"]), ("ip", "~hope"))
        slash = lib.normalize_entry("cityofalpine.com/")
        self.assertEqual((slash["id"], slash["path"]), ("cityofalpine.com", None))
        self.assertEqual(slash["published_as"], "cityofalpine.com/")
        self.assertEqual(lib.normalize_entry("xn--80ak6aa92e.gov")["id"], "xn--80ak6aa92e.gov")  # punycode kept as published
        self.assertIsNone(lib.normalize_entry("   "))
        self.assertIsNone(lib.normalize_entry(None))

    def test_state_codes_are_exact(self):
        self.assertEqual(lib.state_codes("Pennsylvania"), (["PA"], None))
        self.assertEqual(lib.state_codes("district of columbia"), (["DC"], None))
        self.assertEqual(lib.state_codes("GA"), (["GA"], None))
        self.assertEqual(lib.state_codes("Ohio, Pennsylvania, West Virginia"), (["OH", "PA", "WV"], None))
        self.assertEqual(lib.state_codes("Virgin Islands"), (["VI"], None))
        # a country, a partial list, a lower-case code and a name inside prose are never guessed
        self.assertEqual(lib.state_codes("Palau"), ([], "Palau"))
        self.assertEqual(lib.state_codes("Ohio, Narnia"), ([], "Ohio, Narnia"))
        self.assertEqual(lib.state_codes("ga"), ([], "ga"))
        self.assertEqual(lib.state_codes("City of Austin, Texas"), ([], "City of Austin, Texas"))
        self.assertEqual(lib.state_codes(""), ([], None))
        self.assertEqual(lib.state_codes(None), ([], None))

    def test_dates_notes_links(self):
        self.assertEqual(lib.iso_date("6/6/13 19:11"), "2013-06-06")
        self.assertEqual(lib.iso_date("12/18/20"), "2020-12-18")
        self.assertEqual(lib.iso_date("2/9/2022"), "2022-02-09")
        self.assertIsNone(lib.iso_date("1/7/14 - updated 02/03/2020"))
        self.assertIsNone(lib.iso_date("13/40/14"))
        self.assertIsNone(lib.iso_date(""))
        self.assertEqual(lib.split_note("City of Aberdeen, WA -- Note added 9/12/14 5:24"), ("City of Aberdeen, WA", "9/12/14 5:24"))
        self.assertEqual(lib.split_note("City of Crestwood, KY"), ("City of Crestwood, KY", None))
        self.assertEqual(lib.split_note(""), (None, None))
        self.assertEqual(lib.http_link("http://www.aacounty.org/"), ("http://www.aacounty.org/", None))
        self.assertEqual(lib.http_link("#N/A"), (None, None))
        self.assertIsNone(lib.clean("#N/A"))
        self.assertEqual(lib.clean(" NA "), "NA")  # only the spreadsheet error is dropped; a published "NA" stays
        self.assertEqual(lib.http_link("hohttp://www.townofholliston.us/"), (None, "hohttp://www.townofholliston.us/"))

    def test_zone_names(self):
        zone = (
            ";; Exported:   2026-10-22 12:54:30\n"
            "gov.\t3600\tIN\tSOA\ta.ns.gov. x 1 2 3 4 5\n"
            "a1.domainops.gov.\t3600\tIN\tA\t1.2.3.4\n"
            "ca.gov.\t3600\tIN\tNS\tns1.example.net.\n"
            "www.ca.gov.\t3600\tIN\tNS\tns9.example.net.\n"
            "AZ.gov.\t3600\tIN\tNS\tns1.example.net.\n"
        )
        self.assertEqual(lib.cisa_zone_domains(zone), {"ca.gov", "az.gov"})
        self.assertEqual(lib.zone_export_stamp(zone), "2026-10-22 12:54:30")

    def test_cisa_rows(self):
        text = (
            "aberdeenwa.gov,City,City of Aberdeen,,Aberdeen,WA,rlampky@example.gov\n"
            "bunkerhilltx.gov,City,City of Bunker Hill Village,,Houston,TX,(blank)\n"
            "jamestwpmi.gov,City,James Township,,,,(blank)\n"
        )
        out = lib.parse_cisa(cisa_rows(text), {"aberdeenwa.gov"})
        a = out["aberdeenwa.gov"]
        self.assertEqual((a["type"], a["group"], a["state"], a["security_contact"], a["in_zone"]), ("City", "city", "WA", "published", True))
        self.assertEqual(out["bunkerhilltx.gov"]["security_contact"], "not_published")
        self.assertFalse(out["bunkerhilltx.gov"]["in_zone"])
        j = out["jamestwpmi.gov"]
        self.assertEqual((j["state"], j["city"]), (None, None))  # blank stays Not recorded
        self.assertNotIn("rlampky", json.dumps(out))  # the address itself is never kept
        with self.assertRaises(ValueError):
            lib.parse_cisa(cisa_rows(text + "aberdeenwa.gov,City,Again,,X,WA,(blank)\n"), None)

    def test_gsa_duplicates_and_views(self):
        full = lib.read_csv(csv_bytes(
            GSA_FULL_HEADER
            + "ajb.org,Employment and Training Administration,,,Federal,,,,http://ajb.org/,6/6/13 18:08\n"
            + "ajb.org,Department of Labor,,,Federal,,,,#N/A,\n"
            + "usajobs.com,Office of Personnel Management,,,Federal,,GA,,,\n"
        ))
        parsed = lib.parse_gsa_full(full)
        self.assertEqual(len(parsed["ajb.org"]), 2)  # both published rows are kept side by side
        self.assertEqual(parsed["ajb.org"][0]["link"], "http://ajb.org/")
        self.assertIsNone(parsed["ajb.org"][1]["link"])
        self.assertEqual(parsed["usajobs.com"][0]["states"], ["GA"])
        view = lib.parse_gsa_view(lib.read_csv(csv_bytes(
            GSA_VIEW_HEADER + "metroplan.org,,Regional,Arkansas,candidate term,\"Metroplan -- Note added 7/17/13 18:52\",#N/A,6/6/13 18:08\n"
        )))
        r = view["metroplan.org"][0]
        self.assertEqual((r["group"], r["states"], r["status"], r["link"]), ("regional", ["AR"], "candidate term", None))


def build_fixture():
    cisa = {
        "cisa_current_full": lib.parse_cisa(cisa_rows(
            "aberdeenwa.gov,City,City of Aberdeen,,Aberdeen,WA,\n"
            "ca.gov,State or territory,State of California,,Sacramento,CA,security@ca.gov\n"
            "conflict.gov,County,Example County,,Somewhere,OR,(blank)\n"
            "nostate.gov,City,City of Nowhere,,,,(blank)\n"
            "psup.gov,Federal - Executive,.gov Administration,,Arlington,VA,(blank)\n"
        ), {"ca.gov", "aberdeenwa.gov", "conflict.gov", "psup.gov"}),
        "cisa_current_federal": lib.parse_cisa(cisa_rows("psup.gov,Federal - Executive,.gov Administration,,Arlington,VA,(blank)\n"), None),
    }
    gsa_full = lib.parse_gsa_full(lib.read_csv(csv_bytes(
        GSA_FULL_HEADER
        + "aberdeenwa.gov,,,,Local,,Washington,City of Aberdeen WA -- Note added 9/12/14 5:24,http://aberdeenwa.gov/,6/6/13 18:08\n"
        + "conflict.gov,,,,County,,Washington,Example County,,6/6/13 18:08\n"
        + "360eldorado.com/Government,,,,Local,,Kansas,\"City of El Dorado, KS\",http://www.360eldorado.com/Government/CityofElDorado.html,11/19/13 12:54\n"
        + "uspreventiveservicestaskforce.org,Department of Health and Human Services,,,Quasigovernmental,,,,,\n"
        + "uspreventiveservicestaskforce.org,Department of Health and Human Services,,,Federal,,,,,\n"
        + "critfc.org,,,,Native Sovereign Nation / Tribal,,,,,\n"
        + "ohioriver.org,,,,Regional,,\"Ohio, Pennsylvania, West Virginia\",,,\n"
        + "old.com,,,,Local,,Ohio,,,\n"
    )))
    gsa_views = {
        "gsa_regional": lib.parse_gsa_view(lib.read_csv(csv_bytes(GSA_VIEW_HEADER + "critfc.org,,Regional,Oregon,accepted term,,,6/6/13 18:08\n"))),
        "gsa_federal": lib.parse_gsa_view(lib.read_csv(csv_bytes(GSA_VIEW_HEADER + "viewonly.org,Some Agency,Federal Government,Texas,accepted term,,,6/6/13 18:08\n"))),
        "gsa_local": lib.parse_gsa_view(lib.read_csv(csv_bytes(GSA_VIEW_HEADER + "360eldorado.com/Government,,Local Government,Kansas,accepted term,,,\n"))),
    }
    not_used = lib.parse_gsa_not_used(lib.read_csv(csv_bytes(
        NOT_USED_HEADER
        + "old.com,,Local Government,Ohio,Deprecated,gone,,1/1/14 1:00,,\n"
        + "onlyunused.com,,,,Redirected,moved,,1/1/14 1:00,,\n"
    )))
    return lib.assemble(cisa, gsa_full, gsa_views, not_used)


class AssembleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recs = build_fixture()

    def test_not_used_alone_creates_no_record(self):
        self.assertNotIn("onlyunused.com", self.recs)
        self.assertEqual(self.recs["old.com"]["not_used"]["status"], "Deprecated")

    def test_both_registries_agree_without_conflict(self):
        r = self.recs["aberdeenwa.gov"]
        self.assertEqual(r["registries"], ["cisa", "gsa"])
        self.assertEqual(r["lists"], ["cisa_current_full", "gsa_full"])
        self.assertEqual((r["group"], r["state"], r["conflicts"]), ("city", "WA", []))
        self.assertEqual(r["cisa"]["type"], "City")
        self.assertEqual(r["gsa"]["rows"][0]["type"], "Local")  # each registry keeps its own wording
        self.assertEqual(r["organization"], "City of Aberdeen")

    def test_state_conflict_is_kept_side_by_side(self):
        r = self.recs["conflict.gov"]
        self.assertEqual(r["conflicts"], [{"field": "state", "cisa": "OR", "gsa": ["WA"]}])
        self.assertEqual(r["state"], "OR")  # the registrar's value leads, the other stays on the record
        self.assertEqual(r["gsa"]["rows"][0]["states"], ["WA"])

    def test_blank_cisa_state_does_not_hide_a_gsa_state(self):
        self.assertEqual(self.recs["nostate.gov"]["states"], [])  # nobody gives one: Not recorded, not guessed

    def test_federal_list_membership(self):
        self.assertEqual(self.recs["psup.gov"]["lists"], ["cisa_current_full", "cisa_current_federal"])
        self.assertEqual(self.recs["psup.gov"]["group"], "federal")

    def test_path_entry_is_scoped(self):
        r = self.recs["360eldorado.com/government"]
        self.assertEqual(r["entry"]["host"], "360eldorado.com")
        self.assertEqual(r["entry"]["path"], "Government")
        self.assertEqual(r["state"], "KS")
        self.assertEqual(r["lists"], ["gsa_full", "gsa_local"])

    def test_disagreeing_gsa_rows_leave_the_group_open(self):
        r = self.recs["uspreventiveservicestaskforce.org"]
        self.assertIsNone(r["group"])
        self.assertEqual(r["conflicts"], [{"field": "group", "gsa": ["quasi", "federal"]}])
        self.assertEqual(len(r["gsa"]["rows"]), 2)

    def test_multi_state_and_view_only(self):
        m = self.recs["ohioriver.org"]
        self.assertEqual((m["states"], m["state"]), (["OH", "PA", "WV"], None))
        v = self.recs["viewonly.org"]
        self.assertEqual((v["registries"], v["group"], v["states"], v["gsa"]["rows"]), (["gsa"], "federal", ["TX"], []))

    def test_view_location_is_kept_with_the_full_row(self):
        r = self.recs["critfc.org"]
        self.assertEqual(r["gsa"]["rows"][0]["type"], "Native Sovereign Nation / Tribal")
        self.assertEqual(r["gsa"]["views"]["gsa_regional"][0]["states"], ["OR"])
        self.assertEqual(r["states"], [])  # the full list gives no state; the view's state is kept on the view only
        self.assertEqual(r["group"], "tribal")

    def test_summary_counts(self):
        s = lib.summarize(self.recs)
        self.assertEqual(s["records"], len(self.recs))
        self.assertEqual(s["registries"]["both"], 2)  # aberdeenwa.gov and conflict.gov
        self.assertEqual(s["registries"]["cisa"], 5)
        self.assertEqual(s["path_entries"], 1)
        self.assertEqual(s["conflicts"], 2)
        self.assertEqual(s["states"]["WA"]["total"], 1)
        self.assertEqual(s["states"]["OH"]["total"], 2)  # old.com and the multi-state entry
        self.assertEqual(s["with_state"] + s["without_state"], s["records"])
        self.assertEqual(sum(s["groups"].values()), s["records"])


class RowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recs = build_fixture()
        cls.row = rows.gov_row(cls.recs["aberdeenwa.gov"], META)

    def test_row_shape(self):
        r = self.row
        self.assertEqual((r["dataset"], r["category"], r["id"], r["title"], r["state"]), ("gov_domains", "gov_domains", "aberdeenwa.gov", "aberdeenwa.gov", "WA"))
        self.assertEqual(r["source_url"], "https://data.get.gov/?file=current-full.csv")
        self.assertEqual(r["item"]["cells"]["registry"], "CISA, GSA")
        self.assertEqual(r["item"]["row"]["types"], [["cisa", "City"], ["gsa", "Local"]])
        self.assertEqual(r["item"]["gov"]["schema"], "gov_domain.v1")
        self.assertEqual(r["filters"]["registry"], ["cisa", "gsa"])
        self.assertEqual(r["filters"]["state"], ["WA"])
        self.assertIn({"label": "Washington page", "url": "/places/WA"}, r["item"]["links"])
        self.assertEqual(json.loads(json.dumps(r)), r)

    def test_gsa_only_source_is_the_pinned_file(self):
        r = rows.gov_row(self.recs["360eldorado.com/government"], META)
        self.assertEqual(r["source_url"], "https://github.com/GSA/govt-urls/blob/" + META["gsa"]["commit"] + "/1_govt_urls_full.csv")
        self.assertEqual(r["item"]["row"]["link"], "http://www.360eldorado.com/Government/CityofElDorado.html")
        self.assertEqual(r["item"]["row"]["note"], "City of El Dorado, KS")
        self.assertEqual(r["filters"]["entry_kind"], ["path"])

    def test_view_only_source_names_the_view_file(self):
        r = rows.gov_row(self.recs["viewonly.org"], META)
        self.assertTrue(r["source_url"].endswith("/2_govt_urls_federal_only.csv"))

    def test_unknown_values_are_not_recorded_not_guessed(self):
        r = rows.gov_row(self.recs["nostate.gov"], META)
        self.assertEqual(r["state"], "")
        self.assertEqual(r["item"]["cells"]["state"], "Not recorded")
        self.assertEqual(r["filters"]["state"], [])
        self.assertEqual(r["item"]["links"][0]["label"], "Domain website")  # no state page link without a state
        self.assertEqual(r["item"]["row"]["states"], [])

    def test_territory_without_a_page_gets_no_state_link(self):
        rec = dict(self.recs["aberdeenwa.gov"], states=["GU"], state="GU")
        r = rows.gov_row(rec, META)
        self.assertFalse([l for l in r["item"]["links"] if l["url"].startswith("/places/")])

    def test_conflicts_are_visible_in_facts_and_badges(self):
        r = rows.gov_row(self.recs["conflict.gov"], META)
        labels = [f[0] for f in r["detail"]["facts"]]
        self.assertIn("Registries disagree: state", labels)
        self.assertIn("Registries disagree", r["item"]["badges"])
        self.assertTrue(r["item"]["row"]["conflict"])

    def test_not_used_flag(self):
        r = rows.gov_row(self.recs["old.com"], META)
        self.assertTrue(r["item"]["row"]["notUsed"])
        self.assertIn("Also named in GSA's list of domains out of use", [f[0] for f in r["detail"]["facts"]])

    def test_security_contact_is_presence_only(self):
        r = rows.gov_row(self.recs["ca.gov"], META)
        self.assertEqual(r["item"]["row"]["securityContact"], "published")
        self.assertNotIn("security@ca.gov", json.dumps(r))

    def test_rows_are_deterministic(self):
        again = [rows.gov_row(rec, META) for _, rec in sorted(build_fixture().items())]
        first = [rows.gov_row(rec, META) for _, rec in sorted(self.recs.items())]
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(again, sort_keys=True))
        self.assertEqual(len({r["id"] for r in first}), len(first))

    def test_summary_rows(self):
        out = rows.summary_rows(self.recs, META)
        ids = [r["id"] for r in out]
        self.assertEqual(ids[0], "all")
        self.assertIn("state-WA", ids)
        wa = next(r for r in out if r["id"] == "state-WA")
        self.assertEqual(wa["state"], "WA")
        self.assertEqual(wa["item"]["summary"]["total"], 1)
        self.assertEqual(out[0]["item"]["summary"]["snapshot"]["cisa"]["zoneExport"], "2026-10-22 12:54:30")
        self.assertEqual(len(ids), len(set(ids)))

    def test_listing_filters(self):
        block = rows.listing_block(["WA", "CA"])
        names = [f["name"] for f in block["filters"]]
        self.assertEqual(names, ["q", "registry", "group", "state"])
        state_filter = next(f for f in block["filters"] if f["name"] == "state")
        self.assertEqual([o["value"] for o in state_filter["options"]], ["CA", "WA"])  # by state name


SPINE = [
    {"id": "ariz", "title": "Arizona Supreme Court", "state": "AZ", "short_name": "Arizona Supreme Court"},
    {"id": "scotus", "title": "Supreme Court of the United States", "state": "", "short_name": "Supreme Court"},
    {"id": "ohprobctmontgom", "title": "Montgomery County Probate Court", "state": "OH", "short_name": None},
    {"id": "txmunic1", "title": "Municipal Court", "state": "TX", "short_name": None},
    {"id": "txmunic2", "title": "Municipal Court", "state": "TX", "short_name": None},
    {"id": "ohmunictlakewoo", "title": "Lakewood Municipal Court", "state": "OH", "short_name": "Lakewood Court"},
]


def gov_of(host, org=None, states=(), gsa_rows=None):
    return {
        "host": host,
        "states": list(states),
        "cisa": {"organization": org, "suborganization": None} if org else None,
        "gsa": {"rows": gsa_rows or [], "views": {}} if gsa_rows is not None else None,
    }


class CourtDomainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.titles, cls.shorts = courts.directory_index(SPINE)

    def match(self, gov):
        return courts.match_court(gov, self.titles, self.shorts)

    def test_candidates_need_a_court_word_in_a_publisher_name_or_the_domain(self):
        self.assertTrue(courts.is_candidate(gov_of("azcourts.gov", "Arizona Supreme Court"))[0])
        self.assertTrue(courts.is_candidate(gov_of("x.gov", "Kansas Judicial Branch"))[0])
        rows = [{"agency": None, "maintaining_office": None, "note": "Sherman County Circuit Court"}]
        self.assertTrue(courts.is_candidate(gov_of("x.gov", None, gsa_rows=rows))[0])
        # Courthouse and Courtland are other words; the domain text alone still makes a candidate, flagged as such
        self.assertFalse(courts.is_candidate(gov_of("beckhamcountyok.gov", "Beckham County Courthouse"))[0])
        ok, why = courts.is_candidate(gov_of("courtlandtwpmi.gov", "Courtland Township"))
        self.assertTrue(ok)
        self.assertIn("only the domain text", why)
        self.assertEqual(courts.classify_name(gov_of("courtlandtwpmi.gov", "Courtland Township")), "domain text only")
        self.assertEqual(courts.classify_name(gov_of("a.gov", "Broward County Clerk of Courts")), "office or body around a court")
        self.assertEqual(courts.classify_name(gov_of("a.gov", "Euclid Municipal Court")), "names a court")

    def test_exact_title_match_is_case_and_spacing_only(self):
        m = self.match(gov_of("azcourts.gov", "  arizona   SUPREME court ", ["AZ"]))
        self.assertEqual((m["status"], m["court"]["id"]), ("matched", "ariz"))
        # the directory entry gives no state, so nothing contradicts the publisher's
        self.assertEqual(self.match(gov_of("x.gov", "Supreme Court of the United States", ["DC"]))["court"]["id"], "scotus")
        # a similar name, a part of a name and the directory's short name are not matches
        for org in ("Arizona Supreme Court Administrative Office", "Supreme Court of Arizona", "Arizona Court"):
            self.assertEqual(self.match(gov_of("x.gov", org, ["AZ"]))["status"], "unmatched", org)
        self.assertEqual(self.match(gov_of("x.gov", "Lakewood Court", ["OH"]))["status"], "short_name_only")

    def test_same_name_in_another_state_is_never_matched(self):
        m = self.match(gov_of("montgomeryprobatecourtal.gov", "Montgomery County Probate Court", ["AL"]))
        self.assertEqual(m["status"], "state_differs")
        self.assertIn("ohprobctmontgom", m["detail"])
        # without a publisher state nothing contradicts the directory, so the unique exact title matches
        self.assertEqual(self.match(gov_of("x.gov", "Montgomery County Probate Court", []))["status"], "matched")

    def test_shared_titles_are_ambiguous_not_guessed(self):
        m = self.match(gov_of("x.gov", "Municipal Court", ["TX"]))
        self.assertEqual(m["status"], "ambiguous")
        self.assertNotIn("court", m)

    def test_gsa_names_are_tried_too(self):
        rows = [{"agency": "Arizona Supreme Court", "maintaining_office": None, "note": None}]
        gov = gov_of("y.gov", None, ["AZ"], gsa_rows=rows)
        self.assertEqual(self.match(gov)["court"]["id"], "ariz")
        self.assertEqual(self.match(gov)["field"], "GSA agency")


if __name__ == "__main__":
    unittest.main()
