"""Offline unit tests for the members and committees stream (synthetic fixtures only; no network, no private files).

  cd scripts/enrichment/congress && python3 -B -X utf8 -m unittest -v test_congress
"""
from __future__ import annotations

import gzip
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import committees_common as cc  # noqa: E402
import members_common as mc  # noqa: E402

DETAIL = {
    "bioguideId": "A000055", "birthYear": "1965", "currentMember": True, "directOrderName": "Robert B. Aderholt",
    "invertedOrderName": "Aderholt, Robert B.", "firstName": "Robert", "lastName": "Aderholt", "middleName": "B.",
    "honorificName": "Mr.", "officialWebsiteUrl": "https://aderholt.house.gov/", "state": "Alabama", "district": 4,
    "depiction": {"attribution": "Image courtesy of the Member", "imageUrl": "https://www.congress.gov/img/member/a000055_200.jpg"},
    "sponsoredLegislation": {"count": 104, "url": "https://api.congress.gov/v3/member/A000055/sponsored-legislation"},
    "cosponsoredLegislation": {"count": 2311, "url": "https://api.congress.gov/v3/member/A000055/cosponsored-legislation"},
    "partyHistory": [{"partyAbbreviation": "R", "partyName": "Republican", "startYear": 1997}],
    "addressInformation": {"officeAddress": "272 Cannon House Office Building", "phoneNumber": "(202) 225-4876"},
    "previousNames": [{"directOrderName": "Robert B. Aderholt", "invertedOrderName": "Aderholt, Robert B.",
                       "startDate": "1997-01-03T05:00:00Z", "endDate": "2024-02-27T13:20:46Z"}],
    "terms": [
        {"chamber": "House of Representatives", "congress": 119, "district": 4, "memberType": "Representative",
         "startYear": 2025, "stateCode": "AL", "stateName": "Alabama"},
        {"chamber": "House of Representatives", "congress": 118, "district": 4, "endYear": 2025, "memberType": "Representative",
         "startYear": 2023, "stateCode": "AL", "stateName": "Alabama"},
    ],
}
LISTED = {"bioguideId": "A000055", "name": "Aderholt, Robert B.", "partyName": "Republican", "state": "Alabama", "district": 4,
          "terms": {"item": [{"chamber": "House of Representatives", "startYear": 1997}]}}


class Members(unittest.TestCase):
    def test_terms_sorted_and_typed(self):
        ts = mc.terms(DETAIL, LISTED)
        self.assertEqual([t["congress"] for t in ts], [118, 119])
        self.assertEqual(ts[0]["endYear"], 2025)
        self.assertNotIn("endYear", ts[1])  # a current term has no end year: nothing is made up
        self.assertEqual(ts[1]["stateCode"], "AL")

    def test_terms_without_detail_fall_back_to_the_list(self):
        ts = mc.terms(None, LISTED)
        self.assertEqual(ts, [{"chamber": "House of Representatives", "startYear": 1997}])

    def test_party_history_is_as_published(self):
        ph = mc.party_history(DETAIL, LISTED)
        self.assertEqual(ph, [{"party": "Republican", "abbreviation": "R", "startYear": 1997}])
        two = {**DETAIL, "partyHistory": [{"partyName": "Republican", "startYear": 2001}, {"partyName": "Democratic", "partyAbbreviation": "D", "startYear": 1990}]}
        self.assertEqual([p["party"] for p in mc.party_history(two, None)], ["Democratic", "Republican"])
        self.assertNotIn("endYear", mc.party_history(two, None)[0])  # the end of a party is never inferred from the next start
        self.assertEqual(mc.party_history(None, LISTED), [{"party": "Republican", "listOnly": True}])
        self.assertEqual(mc.party_history(None, {"bioguideId": "X"}), [])

    def test_years_label(self):
        ts = mc.terms(DETAIL, LISTED)
        self.assertEqual(mc.years_label(ts, True), "2023–present")
        self.assertEqual(mc.years_label(ts, None), "2023–")  # no end year and no current flag: left open, not "present"
        self.assertEqual(mc.years_label([{"startYear": 1975, "endYear": 2023, "congress": 94}], False), "1975–2023")
        self.assertEqual(mc.years_label([{"startYear": 1999, "endYear": 1999}], False), "1999")
        self.assertIsNone(mc.years_label([], True))

    def test_names_and_previous_names(self):
        n = mc.names(DETAIL, LISTED)
        self.assertEqual((n["inverted"], n["direct"], n["last"]), ("Aderholt, Robert B.", "Robert B. Aderholt", "Aderholt"))
        self.assertEqual(n["previous"][0]["from"], "1997-01-03")
        self.assertEqual(mc.names(None, LISTED)["inverted"], "Aderholt, Robert B.")
        self.assertIsNone(mc.names(None, LISTED)["direct"])

    def test_counts_and_urls(self):
        self.assertEqual(mc.count_of(DETAIL["sponsoredLegislation"]), 104)
        self.assertEqual(mc.count_of({"count": 0}), 0)
        self.assertIsNone(mc.count_of({"count": "12"}))
        self.assertIsNone(mc.count_of({"count": True}))
        self.assertIsNone(mc.count_of(None))
        self.assertEqual(mc.https_url("https://aderholt.house.gov/"), "https://aderholt.house.gov/")
        self.assertIsNone(mc.https_url("javascript:alert(1)"))
        self.assertIsNone(mc.https_url("ftp://x.gov/a"))
        self.assertIsNone(mc.https_url("https://evil.example/x", ("www.congress.gov",)))
        self.assertEqual(mc.year("1965"), 1965)
        self.assertIsNone(mc.year("196"))
        self.assertIsNone(mc.year(True))

    def test_depiction_and_attribution_never_carry_markup(self):
        d = mc.depiction(DETAIL["depiction"])
        self.assertEqual(d["imageUrl"], "https://www.congress.gov/img/member/a000055_200.jpg")
        self.assertEqual(d["attribution"]["text"], "Image courtesy of the Member")
        self.assertIsNone(d["attribution"]["url"])
        a = mc.attribution('<a href="http://www.senate.gov/artandhistory/history/common/generic/Photo_Collection.htm">Courtesy U.S. Senate Historical Office</a>')
        self.assertEqual(a["text"], "Courtesy U.S. Senate Historical Office")
        self.assertTrue(a["url"].startswith("http://www.senate.gov/"))
        self.assertIn("<a href", a["raw"])
        self.assertIsNone(mc.attribution('<a href="javascript:x">Bad</a>')["url"])
        self.assertIsNone(mc.depiction({"imageUrl": "https://elsewhere.example/p.jpg"}))  # only the Congress.gov image host
        self.assertIsNone(mc.depiction(None))
        self.assertIsNone(mc.attribution(""))

    def test_bio_urls_and_ids(self):
        self.assertTrue(mc.BIOGUIDE.match("A000055"))
        self.assertFalse(mc.BIOGUIDE.match("a000055"))
        self.assertFalse(mc.BIOGUIDE.match("A00005"))
        self.assertEqual(mc.bio_url("A000055"), "https://bioguide.congress.gov/search/bio/A000055")

    def test_norm_is_exact_not_fuzzy(self):
        self.assertEqual(mc.norm("  Smith,   Adam "), mc.norm("smith, adam"))
        self.assertNotEqual(mc.norm("Smith, Adam"), mc.norm("Smith, Adrian"))
        self.assertNotEqual(mc.norm("Smith, A."), mc.norm("Smith, Adam"))


class Bills(unittest.TestCase):
    def index(self):
        idx = mc.BillIndex()
        idx.add(118, "hr", "3935", [{"bioguideId": "G000546"}], [
            {"bioguideId": "L000560", "sponsorshipDate": "2023-06-09"},
            {"bioguideId": "Z000001", "sponsorshipWithdrawnDate": "2023-07-01"}])
        idx.add(118, "hr", "10", [{"bioguideId": "G000546"}], [{"bioguideId": "L000560"}])
        idx.add(118, "s", "7", [{"bioguideId": "L000560"}], [{"bioguideId": "G000546"}, {"bioguideId": "G000546"}])
        idx.add(119, "hres", "5", [], [])
        idx.add(119, "hr", "1", [{"bioguideId": "G000546"}, {"bioguideId": "L000560"}], [])
        idx.add(119, "hr", "2", [{"fullName": "no id"}], [{"fullName": "no id either"}])
        return idx

    def test_sponsored_counts_first_listed_sponsor_only(self):
        m = self.index().member("G000546")
        self.assertEqual(m["sponsoredByCongress"], {118: 2, 119: 1})
        self.assertEqual(m["sponsoredTotal"], 3)
        self.assertEqual(self.index().member("L000560")["sponsoredTotal"], 1)  # second-listed sponsor of 119 hr 1 is not counted

    def test_cosponsored_excludes_withdrawn_and_counts_a_duplicate_once(self):
        idx = self.index()
        self.assertEqual(idx.member("L000560")["cosponsored"], {118: {"hr": [10, 3935]}})
        self.assertEqual(idx.member("Z000001")["cosponsoredTotal"], 0)
        self.assertEqual(idx.member("Z000001")["cosponsorshipsWithdrawn"], 1)
        self.assertEqual(idx.member("G000546")["cosponsored"], {118: {"s": [7]}})

    def test_gaps_are_counted_not_hidden(self):
        idx = self.index()
        self.assertEqual((idx.bills, idx.no_sponsor, idx.multi_sponsor, idx.sponsor_without_id, idx.cosponsor_without_id), (6, 1, 1, 1, 1))

    def test_unknown_member_has_empty_counts_not_a_guess(self):
        m = self.index().member("Q999999")
        self.assertEqual((m["sponsoredTotal"], m["cosponsoredTotal"], m["cosponsored"]), (0, 0, {}))

    def test_coverage_of_terms(self):
        self.assertTrue(mc.fully_covered([{"congress": 108}, {"congress": 119}]))
        self.assertFalse(mc.fully_covered([{"congress": 107}, {"congress": 108}]))
        self.assertFalse(mc.fully_covered([{"startYear": 1990}]))
        self.assertFalse(mc.fully_covered([]))
        self.assertEqual(mc.covered_congresses([{"congress": 105}, {"congress": 108}, {"congress": 119}]), [108, 119])


COMMITTEE_LIST = [
    {"chamber": "House", "committeeTypeCode": "Standing", "name": "Transportation and Infrastructure Committee", "systemCode": "hspw00",
     "updateDate": "2026-01-01T00:00:00Z", "url": "https://api.congress.gov/v3/committee/house/hspw00?format=json"},
    {"chamber": "House", "committeeTypeCode": "Subcommittee", "name": "Aviation Subcommittee", "systemCode": "hspw05",
     "url": "https://api.congress.gov/v3/committee/house/hspw05?format=json"},
]
COMMITTEE_DETAIL = {
    "systemCode": "hspw00", "type": "Standing", "isCurrent": True, "committeeWebsiteUrl": "https://transportation.house.gov/",
    "updateDate": "2026-01-01T00:00:00Z",
    "subcommittees": [{"systemCode": "hspw05", "name": "Aviation Subcommittee", "url": "https://api.congress.gov/v3/committee/house/hspw05"}],
    "history": [{"officialName": "Committee on Transportation and Infrastructure", "libraryOfCongressName": "Transportation and Infrastructure",
                 "startDate": "1995-01-04T05:00:00Z", "committeeTypeCode": "Standing", "establishingAuthority": "104 H.Res. 6"}],
    "reports": {"count": 1373, "url": "https://api.congress.gov/v3/committee/house/hspw00/reports"},
    "bills": {"count": 25313, "url": "https://api.congress.gov/v3/committee/house/hspw00/bills"},
    "communications": {"count": 6796, "url": "x"},
}
SUB_DETAIL = {"systemCode": "hspw05", "type": "Subcommittee", "isCurrent": True,
              "parent": {"systemCode": "hspw00", "name": "Transportation and Infrastructure Committee", "url": "u"}, "history": []}


class Committees(unittest.TestCase):
    def test_system_code_shapes(self):
        for ok in ("hspw00", "ssas00", "jslc00", "hspw05", "slet00"):
            self.assertTrue(cc.SYSTEM_CODE.match(ok), ok)
        for bad in ("xspw00", "hspw0", "HSPW00", "hspw000", "hs"):
            self.assertFalse(cc.SYSTEM_CODE.match(bad), bad)

    def test_chamber_url_part(self):
        self.assertEqual(cc.chamber_path("House"), "house")
        self.assertEqual(cc.chamber_path("Joint"), "joint")
        self.assertIsNone(cc.chamber_path("Assembly"))

    def test_committee_ids_include_authority_style_ids(self):
        for ok in ("n79043123", "no94026591", "n2005025889", "hspw00"):
            self.assertTrue(cc.COMMITTEE_ID.match(ok), ok)
        for bad in ("n1234", "x79043123", "../hspw00", "hspw0", "n79043123x", "N79043123"):
            self.assertFalse(cc.COMMITTEE_ID.match(bad), bad)

    def test_is_subcommittee_from_parent_then_code_never_from_name(self):
        self.assertFalse(cc.is_subcommittee("hspw00"))
        self.assertTrue(cc.is_subcommittee("hspw05"))
        self.assertTrue(cc.is_subcommittee("n2005025889", {"systemCode": "hspw00"}))  # the API names a parent
        self.assertFalse(cc.is_subcommittee("n2005025889"))  # ends in 89, but it is not a system code: a committee
        self.assertFalse(cc.is_subcommittee("hspw00", None))
        self.assertEqual(cc.parent_code("hspw05"), "hspw00")
        self.assertIsNone(cc.parent_code("hspw00"))

    def test_history_as_published(self):
        h = cc.history(COMMITTEE_DETAIL)
        self.assertEqual(h[0]["officialName"], "Committee on Transportation and Infrastructure")
        self.assertEqual(h[0]["startDate"], "1995-01-04")
        self.assertNotIn("endDate", h[0])
        self.assertEqual(cc.history({}), [])

    def test_counts_blocks(self):
        c = cc.api_counts(COMMITTEE_DETAIL)
        self.assertEqual((c["reports"], c["bills"], c["communications"]), (1373, 25313, 6796))
        self.assertNotIn("nominations", c)  # a count the API does not give is absent, not zero

    def test_parent_is_the_api_parent_and_must_name_a_listed_code(self):
        self.assertEqual(cc.parent_of(SUB_DETAIL, {"hspw00", "hspw05"}),
                         {"systemCode": "hspw00", "name": "Transportation and Infrastructure Committee", "listed": True})
        self.assertFalse(cc.parent_of(SUB_DETAIL, {"hspw05"})["listed"])  # named by the API but not in the list: no link
        self.assertIsNone(cc.parent_of(COMMITTEE_DETAIL, {"hspw00"}))
        self.assertIsNone(cc.parent_of({"parent": {"systemCode": "../etc"}}, set()))

    def test_congress_coverage_is_the_lists_that_name_the_code(self):
        by_congress = {"117": ["hspw00", "hspw05"], "118": ["hspw00"], "119": ["hspw00", "hspw05"], "116": ["ssas00"]}
        self.assertEqual(cc.congresses_listed("hspw00", by_congress), [117, 118, 119])
        self.assertEqual(cc.congresses_listed("hspw05", by_congress), [117, 119])  # 118 is a gap, not filled in
        self.assertEqual(cc.congresses_listed("zzzz99", by_congress), [])
        self.assertEqual(cc.congress_ranges([117, 118, 119]), "117th–119th")
        self.assertEqual(cc.congress_ranges([117, 119]), "117th, 119th")
        self.assertEqual(cc.congress_ranges([]), None)

    def test_membership_is_not_published(self):
        self.assertFalse(cc.PUBLISHES_MEMBERSHIP)


class MemberRows(unittest.TestCase):
    def build(self, listed, detail, entry=None):
        from collections import Counter

        import build_congress_members as bm

        idx = mc.BillIndex()
        idx.add(118, "hr", "10", [{"bioguideId": "A000055"}], [{"bioguideId": "B000001"}])
        idx.add(
            119, "hr", "11", [{"bioguideId": "B000001"}],
            [{"bioguideId": "A000055"}, {"bioguideId": "B000001", "sponsorshipWithdrawnDate": "2025-03-01"}],
        )
        bills = {"retrieved": "2026-10-23", "manifestSha256": "abc", "records": 3, "rowsSha256": "d", "builtAt": "x"}
        stats = Counter()
        entry = {"retrieved_at": "2026-10-23T07:40:00Z", "sha256": "h"} if entry is None else entry
        return bm.build_row(listed, detail, entry, idx, bills, stats), stats

    def test_current_member_row(self):
        row, stats = self.build(LISTED, DETAIL)
        self.assertEqual((row["id"], row["category"], row["dataset"]), ("A000055", "congress_members", "congress_members"))
        self.assertEqual(row["title"], "Robert B. Aderholt")
        self.assertEqual(row["source_url"], "https://api.congress.gov/v3/member/A000055")
        c = row["item"]["cells"]
        self.assertEqual(
            (c["name"], c["party"], c["state_code"], c["district"], c["chamber"], c["current"]),
            ("Aderholt, Robert B.", "Republican", "AL", "4", "House of Representatives", "yes"),
        )
        self.assertEqual((c["sponsored_reported"], c["cosponsored_reported"], c["retrieved"], c["years"]), (104, 2311, "2026-10-23", "2023–present"))
        f = row["filters"]
        self.assertEqual((f["represents"], f["state"], f["chamber"], f["party"], f["current"], f["congress"]),
                         (["AL"], ["AL"], ["house"], ["Republican"], ["yes"], ["118", "119"]))
        self.assertEqual(f["name"], ["aderholt, robert b.", "robert b. aderholt"])
        self.assertEqual(f["has_bills"], ["sponsored", "cosponsored"])
        m = row["detail"]["member"]
        self.assertEqual(m["bills"]["sponsoredByCongress"], {118: 1})
        self.assertEqual(m["bills"]["cosponsoredByCongress"], {119: 1})
        self.assertEqual(row["detail"]["cosponsored"]["byCongress"], {119: {"hr": [11]}})
        self.assertEqual(m["bills"]["congressesServedInCollection"], [118, 119])
        self.assertTrue(m["bills"]["servedOnlyInCollection"])
        self.assertEqual(stats["detail_fetched"], 1)

    def test_no_contact_fields_and_no_committee_membership_are_stored(self):
        row, _ = self.build(LISTED, DETAIL)
        blob = json.dumps(row)
        for banned in ("phoneNumber", "officeAddress", "225-4876", "Cannon House Office Building", "addressInformation"):
            self.assertNotIn(banned, blob)
        self.assertNotIn("committee", json.dumps(row["detail"]["member"]).lower())

    def test_member_with_a_party_change_keeps_every_published_party(self):
        d = {**DETAIL, "bioguideId": "B000001",
             "partyHistory": [{"partyName": "Republican", "partyAbbreviation": "R", "startYear": 2001},
                              {"partyName": "Independent", "partyAbbreviation": "I", "startYear": 2013}]}
        row, stats = self.build({**LISTED, "bioguideId": "B000001"}, d)
        self.assertEqual(row["item"]["cells"]["party"], "Independent")
        self.assertEqual(row["filters"]["party"], ["Independent", "Republican"])
        self.assertIn("Republican from 2001; Independent from 2013", dict(map(tuple, row["detail"]["facts"]))["Party history"])
        self.assertEqual(stats["multi_party"], 1)
        # B000001 cosponsored 118 hr 10 and withdrew from 119 hr 11: the withdrawn one is only counted
        self.assertEqual(row["detail"]["member"]["bills"]["cosponsorshipsWithdrawn"], 1)
        self.assertEqual(row["detail"]["member"]["bills"]["cosponsoredByCongress"], {118: 1})

    def test_list_only_member_is_flagged_and_gets_no_invented_values(self):
        row, stats = self.build(LISTED, None, entry={})
        m = row["detail"]["member"]
        self.assertFalse(m["source"]["detailFetched"])
        self.assertTrue(m["source"]["listPartyOnly"])
        self.assertIsNone(m["current"])
        self.assertIsNone(row["item"]["cells"]["current"])
        self.assertNotIn("current", row["filters"])
        self.assertNotIn("represents", row["filters"])  # "currently represents" needs the API's current flag
        self.assertIsNone(m["officialWebsite"])
        self.assertEqual((m["legislation"]["sponsored"], m["legislation"]["cosponsored"], m["legislation"]["retrieved"]), (None, None, None))
        self.assertEqual(stats["detail_missing"], 1)

    def test_senator_has_no_district_and_delegate_keeps_its_type(self):
        d = {**DETAIL, "bioguideId": "C000001",
             "terms": [{"chamber": "Senate", "congress": 119, "memberType": "Senator", "startYear": 2025, "stateCode": "VT", "stateName": "Vermont"}]}
        row, _ = self.build({**LISTED, "bioguideId": "C000001"}, d)
        self.assertIsNone(row["item"]["cells"]["district"])
        self.assertEqual(row["item"]["cells"]["member_type"], "Senator")
        d2 = {**DETAIL, "bioguideId": "D000001",
              "terms": [{"chamber": "House of Representatives", "congress": 119, "memberType": "Delegate", "district": 0,
                         "startYear": 2025, "stateCode": "DC", "stateName": "District of Columbia"}]}
        row2, _ = self.build({**LISTED, "bioguideId": "D000001"}, d2)
        self.assertEqual((row2["item"]["cells"]["district"], row2["item"]["cells"]["member_type"], row2["filters"]["represents"]),
                         ("At large", "Delegate", ["DC"]))


class CommitteeRows(unittest.TestCase):
    def build(self, item, detail, codes=None, by_congress=None, in_main=True):
        from collections import Counter

        import build_congress_committees as bc

        stats = Counter()
        entry = {"retrieved_at": "2026-10-23T08:00:00Z", "sha256": "h"} if detail else None
        row = bc.build_row(item, detail, entry, codes or {"hspw00", "hspw05"},
                           by_congress or {"117": ["hspw00", "hspw05"], "119": ["hspw00"]}, in_main, stats)
        return row, stats

    def test_committee_with_detail(self):
        row, _ = self.build(COMMITTEE_LIST[0], COMMITTEE_DETAIL)
        c = row["detail"]["committee"]
        self.assertEqual((row["id"], row["category"]), ("hspw00", "congress_committees"))
        self.assertEqual((c["level"], c["current"], c["type"], c["website"]), ("committee", True, "Standing", "https://transportation.house.gov/"))
        self.assertEqual(c["congresses"], [117, 119])
        self.assertEqual(row["item"]["cells"]["congresses"], "117th, 119th")  # 118th is a gap, never filled in
        self.assertEqual(c["subcommittees"], [{"systemCode": "hspw05", "name": "Aviation Subcommittee", "listed": True}])
        self.assertEqual(c["counts"], {"reports": 1373, "bills": 25313, "communications": 6796})
        self.assertEqual(row["filters"]["chamber"], ["house"])
        self.assertEqual(row["filters"]["level"], ["committee"])
        self.assertNotIn("parent", row["filters"])
        self.assertEqual(dict(map(tuple, row["detail"]["facts"]))["Committee membership"], "Not published by the Congress.gov API")

    def test_subcommittee_gets_its_parent_filter(self):
        row, _ = self.build(COMMITTEE_LIST[1], SUB_DETAIL)
        self.assertEqual(row["detail"]["committee"]["level"], "subcommittee")
        self.assertEqual(row["filters"]["parent"], ["hspw00"])
        self.assertEqual(row["item"]["cells"]["parent_name"], "Transportation and Infrastructure Committee")
        self.assertTrue(row["detail"]["committee"]["parent"]["listed"])

    def test_authority_style_id_is_a_committee_and_a_missing_detail_is_flagged(self):
        item = {"chamber": "Senate", "committeeTypeCode": "Standing", "name": "Mines and Mining", "systemCode": "n79043123",
                "updateDate": "2024-03-05T13:15:17Z"}
        row, stats = self.build(item, None, codes={"n79043123"}, by_congress={"27": ["n79043123"], "28": ["n79043123"]}, in_main=False)
        c = row["detail"]["committee"]
        self.assertEqual(c["level"], "committee")
        self.assertFalse(c["source"]["detailFetched"])
        self.assertIsNone(c["current"])
        self.assertFalse(c["listedInMainList"])
        self.assertEqual(row["item"]["cells"]["congresses"], "27th–28th")
        self.assertEqual(stats["detail_missing"], 1)
        self.assertEqual(stats["only_in_congress_lists"], 1)

    def test_no_membership_list_is_stored(self):
        row, _ = self.build(COMMITTEE_LIST[0], COMMITTEE_DETAIL)
        self.assertNotIn("members", json.dumps(row["detail"]["committee"]).lower())


class Client(unittest.TestCase):
    def test_stored_names_never_contain_a_key(self):
        import cg_api as api

        p = api.stored_name("/member", {"format": "json", "limit": "250", "api_key": "SECRET", "offset": "0"})
        self.assertNotIn("SECRET", str(p))
        self.assertTrue(str(p).endswith(".json.gz"))
        t = api.stored_name("/member", {"format": "json"}, "2026-11-01")
        self.assertIn("__at_2026-11-01", t.name)

    def test_cached_reads_a_stored_response_without_a_request(self):
        import cg_api as api

        with tempfile.TemporaryDirectory() as d:
            old = api.ACQ
            api.ACQ = Path(d)
            try:
                dest = api.stored_name("/member/Z000001", {"format": "json"})
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(gzip.compress(json.dumps({"member": {"bioguideId": "Z000001"}}).encode()))
                self.assertEqual(api.get("/member/Z000001")["member"]["bioguideId"], "Z000001")
                self.assertIs(api.cached("/member/NOPE"), False)
                dest.with_suffix(".missing").write_text("404")
                miss = api.stored_name("/member/M000001", {"format": "json"})
                miss.with_suffix(".missing").write_text("404")
                self.assertIsNone(api.get("/member/M000001"))
            finally:
                api.ACQ = old


if __name__ == "__main__":
    unittest.main()
