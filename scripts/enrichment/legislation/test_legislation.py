"""Offline unit tests for the legislation stream (synthetic fixtures only; no network, no private files).

  cd scripts/enrichment/legislation && python3 -B -m unittest -v test_legislation
"""
from __future__ import annotations

import gzip
import json
import os
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bills_common as bc  # noqa: E402
import openstates_common as oc  # noqa: E402
import pgdump_reader as pr  # noqa: E402
from billstatus_parse import latest_summary, parse_bill, plain_words, summary_blocks  # noqa: E402

V3 = b"""<?xml version="1.0" encoding="UTF-8"?>
<billStatus>
  <version>3.0.0</version>
  <bill>
    <number>3935</number>
    <updateDate>2025-12-06T12:08:26Z</updateDate>
    <originChamber>House</originChamber>
    <type>HR</type>
    <introducedDate>2023-06-09</introducedDate>
    <congress>118</congress>
    <legislationUrl>https://www.congress.gov/bill/118th-congress/house-bill/3935</legislationUrl>
    <committees>
      <item><systemCode>hspw00</systemCode><name>Transportation and Infrastructure Committee</name><chamber>House</chamber>
        <type>Standing</type>
        <subcommittees><item><systemCode>hspw05</systemCode><name>Aviation Subcommittee</name>
          <activities><item><name>Referred to</name><date>2023-06-12T13:13:00Z</date></item></activities></item></subcommittees>
        <activities><item><name>Reported By</name><date>2023-07-11T18:46:31Z</date></item></activities></item>
    </committees>
    <committeeReports><committeeReport><citation>H. Rept. 118-138</citation></committeeReport></committeeReports>
    <relatedBills><item><title>Companion</title><congress>118</congress><number>1939</number><type>S</type>
      <latestAction><actionDate>2023-06-12</actionDate><text>Read twice.</text></latestAction>
      <relationshipDetails><item><type>Related bill</type><identifiedBy>CRS</identifiedBy></item></relationshipDetails></item></relatedBills>
    <actions>
      <item><actionDate>2024-05-16</actionDate><text>Became Public Law No: 118-63.</text><type>BecameLaw</type><actionCode>36000</actionCode>
        <sourceSystem><code>9</code><name>Library of Congress</name></sourceSystem></item>
      <item><actionDate>2023-07-20</actionDate><text>On passage Passed by recorded vote: 383 - 43 (Roll no. 363).</text><type>Floor</type>
        <actionCode>H37100</actionCode><sourceSystem><code>2</code><name>House floor actions</name></sourceSystem>
        <recordedVotes><recordedVote><rollNumber>363</rollNumber><url>https://clerk.house.gov/evs/2023/roll363.xml</url>
          <chamber>House</chamber><congress>118</congress><date>2023-07-20T14:00:00Z</date><sessionNumber>1</sessionNumber></recordedVote></recordedVotes></item>
      <item><actionDate>2023-07-20</actionDate><text>Passed/agreed to in House: On passage Passed by recorded vote.</text><type>Floor</type>
        <actionCode>8000</actionCode><sourceSystem><code>9</code><name>Library of Congress</name></sourceSystem></item>
      <item><actionDate>2023-07-20</actionDate><text>Passed/agreed to in House: On passage Passed by recorded vote.</text><type>Floor</type>
        <actionCode>8000</actionCode><sourceSystem><code>9</code><name>Library of Congress</name></sourceSystem></item>
      <item><actionDate>2023-06-09</actionDate><text>Introduced in House</text><type>IntroReferral</type><actionCode>1000</actionCode>
        <sourceSystem><code>9</code><name>Library of Congress</name></sourceSystem></item>
    </actions>
    <amendments><amendment><number>1</number><sponsors><item><bioguideId>X000001</bioguideId><fullName>Rep. Amend [R-XX-1]</fullName></item></sponsors>
      <actions><actions><item><actionDate>2023-07-19</actionDate><text>Amendment action</text></item></actions></actions></amendment></amendments>
    <sponsors><item><bioguideId>G000546</bioguideId><fullName>Rep. Graves, Sam [R-MO-6]</fullName><firstName>SAM</firstName>
      <lastName>GRAVES</lastName><party>R</party><state>MO</state><district>6</district><isByRequest>N</isByRequest></item></sponsors>
    <cosponsors>
      <item><bioguideId>L000560</bioguideId><fullName>Rep. Larsen, Rick [D-WA-2]</fullName><party>D</party><state>WA</state>
        <sponsorshipDate>2023-06-09</sponsorshipDate><isOriginalCosponsor>True</isOriginalCosponsor></item>
      <item><bioguideId>Z000001</bioguideId><fullName>Rep. Zed, Ann [D-CA-1]</fullName><party>D</party><state>CA</state>
        <sponsorshipDate>2023-06-20</sponsorshipDate><isOriginalCosponsor>False</isOriginalCosponsor>
        <sponsorshipWithdrawnDate>2023-07-01</sponsorshipWithdrawnDate></item>
    </cosponsors>
    <cboCostEstimates>
      <item><pubDate>2023-07-17T15:38:00Z</pubDate><title>Estimate</title><url>https://www.cbo.gov/publication/59372</url></item>
      <item><pubDate>2023-07-17T15:38:00Z</pubDate><title>Estimate</title><url>https://www.cbo.gov/publication/59372</url></item>
    </cboCostEstimates>
    <laws><item><type>Public Law</type><number>118-63</number></item></laws>
    <policyArea><name>Transportation and Public Works</name></policyArea>
    <subjects><legislativeSubjects><item><name>Aviation and airports</name></item></legislativeSubjects>
      <policyArea><name>Transportation and Public Works</name></policyArea></subjects>
    <summaries>
      <summary><versionCode>00</versionCode><actionDate>2023-06-09</actionDate><actionDesc>Introduced in House</actionDesc>
        <updateDate>2023-07-06T18:05:33Z</updateDate><text>&lt;p&gt;Old text&lt;/p&gt;</text></summary>
      <summary><versionCode>49</versionCode><actionDate>2024-05-16</actionDate><actionDesc>Public Law</actionDesc>
        <updateDate>2024-06-01T00:00:00Z</updateDate>
        <text>&lt;p&gt;&lt;b&gt;FAA Act&lt;/b&gt;&lt;/p&gt; &lt;p&gt;This law &amp;amp; more&lt;/p&gt;&lt;ul&gt;&lt;li&gt;item one;&lt;/li&gt;&lt;/ul&gt; tail words</text></summary>
    </summaries>
    <title>FAA Reauthorization Act of 2024</title>
    <titles>
      <item><titleType>Display Title</titleType><titleTypeCode>45</titleTypeCode><title>FAA Reauthorization Act of 2024</title></item>
      <item><titleType>Official Title as Introduced</titleType><titleTypeCode>6</titleTypeCode><title>To amend title 49.</title></item>
      <item><titleType>Official Title as Introduced</titleType><titleTypeCode>6</titleTypeCode><title>To amend title 49.</title></item>
    </titles>
    <textVersions><item><type>Introduced in House</type><date>2023-06-09T04:00:00Z</date>
      <formats><item><url>https://www.govinfo.gov/content/pkg/BILLS-118hr3935ih/xml/BILLS-118hr3935ih.xml</url></item></formats></item></textVersions>
  </bill>
  <dublinCore xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:rights>Public domain.</dc:rights></dublinCore>
</billStatus>"""

OLD = b"""<?xml version="1.0"?>
<billStatus><bill>
  <billNumber>9</billNumber><originChamber>House</originChamber><billType>HR</billType>
  <introducedDate>2021-01-03</introducedDate><congress>117</congress>
  <committees><billCommittees><item><name>Rules Committee</name><chamber>House</chamber></item></billCommittees></committees>
  <recordedVotes><recordedVote><rollNumber>528</rollNumber><url>http://clerk.house.gov/evs/2017/roll528.xml</url>
    <fullActionName>Passage of a Measure</fullActionName><chamber>House</chamber></recordedVote></recordedVotes>
  <subjects><billSubjects><legislativeSubjects><item><name>Taxation</name></item></legislativeSubjects>
    <policyArea><name>Taxation</name></policyArea></billSubjects></subjects>
  <summaries><billSummaries><item><versionCode>00</versionCode><actionDate>2021-01-03</actionDate><actionDesc>Introduced in House</actionDesc>
    <updateDate>2021-02-01T00:00:00Z</updateDate><text>Plain summary text.</text></item></billSummaries></summaries>
  <relatedBills><item><latestTitle>Older title</latestTitle><congress>117</congress><number>5</number><type>HR</type></item></relatedBills>
  <sponsors><item><fullName>Rep. Doe, Jo [D-NY-1]</fullName><byRequestType>By Request</byRequestType></item></sponsors>
  <title>Reserved for the Speaker.</title>
</bill></billStatus>"""


class BillStatusParse(unittest.TestCase):
    def test_v3(self):
        r = parse_bill(V3)
        self.assertEqual((r["congress"], r["type"], r["number"]), (118, "hr", "3935"))
        self.assertEqual(r["schema"], "3.0.0")
        self.assertEqual(r["sponsors"][0]["fullName"], "Rep. Graves, Sam [R-MO-6]")
        self.assertEqual(len(r["sponsors"]), 1, "amendment sponsors must not leak into the bill")
        self.assertEqual(r["cosponsors"][1]["sponsorshipWithdrawnDate"], "2023-07-01")
        self.assertEqual(len(r["actions"]), 5)
        self.assertEqual(r["actions"][1]["votes"][0]["rollNumber"], "363")
        self.assertEqual(r["laws"], [{"type": "Public Law", "number": "118-63"}])
        self.assertEqual(len(r["cboCostEstimates"]), 1, "identical CBO entries are listed once")
        self.assertEqual(len(r["titles"]), 2, "duplicate (type, title) pairs are listed once")
        self.assertEqual(r["committees"][0]["subcommittees"][0]["name"], "Aviation Subcommittee")
        self.assertEqual(r["relatedBills"][0]["type"], "s")
        self.assertEqual(r["rights"], "Public domain.")
        self.assertEqual(r["summary"]["versionCode"], "49")
        self.assertEqual(r["summaryCount"], 2)
        self.assertEqual(r["amendmentCount"], 1)

    def test_old_layout(self):
        r = parse_bill(OLD)
        self.assertEqual((r["congress"], r["type"], r["number"]), (117, "hr", "9"))
        self.assertTrue(r["schema"].startswith("pre-3.0"))
        self.assertEqual(r["committees"][0]["name"], "Rules Committee")
        self.assertEqual(r["subjects"], ["Taxation"])
        self.assertEqual(r["policyArea"], "Taxation")
        self.assertEqual(r["billVotes"][0]["fullActionName"], "Passage of a Measure")
        self.assertEqual(r["relatedBills"][0]["title"], "Older title")
        self.assertEqual(r["sponsors"][0]["byRequestType"], "By Request")
        self.assertEqual(r["summary"]["blocks"], [{"k": "p", "x": "Plain summary text."}])

    def test_summary_keeps_every_word(self):
        markup = "<p><b>FAA Act</b></p> <p>This law &amp; more</p><ul><li>item one;</li></ul> tail words"
        blocks = summary_blocks(markup)
        self.assertEqual([b["k"] for b in blocks], ["p", "p", "li", "p"])
        self.assertEqual(" ".join(b["x"] for b in blocks), plain_words(markup))

    def test_cdata_wrapped_summary(self):
        xml = V3.replace(b"<text>&lt;p&gt;Old text&lt;/p&gt;</text>", b"<cdata><text>&lt;p&gt;Old text&lt;/p&gt;</text></cdata>")
        xml = xml.replace(b"<versionCode>49</versionCode>", b"<versionCode>01</versionCode>").replace(b"<actionDate>2024-05-16</actionDate><actionDesc>Public Law",
                                                                                                         b"<actionDate>2020-01-01</actionDate><actionDesc>Public Law")
        r = parse_bill(xml)
        self.assertEqual(r["summary"]["blocks"], [{"k": "p", "x": "Old text"}])

    def test_latest_summary_rule(self):
        s = latest_summary([{"actionDate": "2024-01-01", "updateDate": "2024-01-02", "text": "<p>a</p>", "versionCode": "00"},
                            {"actionDate": "2024-01-01", "updateDate": "2024-03-01", "text": "<p>b</p>", "versionCode": "07"},
                            {"actionDate": "2023-01-01", "updateDate": "2025-01-01", "text": "<p>c</p>"}])
        self.assertEqual(s["blocks"][0]["x"], "b")
        self.assertIsNone(latest_summary([{"actionDate": "2024-01-01"}]))


class BillsCommon(unittest.TestCase):
    def test_citations_and_urls(self):
        self.assertEqual(bc.ordinal(111), "111th")
        self.assertEqual(bc.ordinal(101), "101st")
        self.assertEqual(bc.display_citation("hconres", "5", 118), "H.Con.Res. 5, 118th Congress")
        self.assertEqual(bc.congress_gov_url(118, "hr", "3935"), "https://www.congress.gov/bill/118th-congress/house-bill/3935")
        self.assertEqual(bc.congress_gov_url(112, "sjres", "1"), "https://www.congress.gov/bill/112th-congress/senate-joint-resolution/1")
        self.assertEqual(bc.billstatus_xml_url(118, "s", 1), "https://www.govinfo.gov/bulkdata/BILLSTATUS/118/s/BILLSTATUS-118s1.xml")

    def test_dedupe_only_identical(self):
        acts = [{"date": "2023-01-01", "text": "A", "code": "1000"}, {"date": "2023-01-01", "text": "A", "code": "1000"},
                {"date": "2023-01-01", "text": "A", "code": "Intro-H"}]
        kept, dropped = bc.dedupe_actions(acts)
        self.assertEqual((len(kept), dropped), (2, 1))

    def test_milestones_and_status(self):
        r = parse_bill(V3)
        ms = bc.milestones(r, r["actions"])
        self.assertEqual(ms["passed_house"]["date"], "2023-07-20")
        self.assertEqual(ms["passed_house"]["evidence"], "code 8000")
        self.assertEqual(ms["became_law"]["date"], "2024-05-16")
        self.assertIsNone(ms["passed_senate"], "no Senate passage code -> not recorded")
        self.assertEqual(bc.status("hr", ms)[0], "became_law")

    def test_vitiated_passage(self):
        acts = [{"date": "2003-06-27", "text": "Passed/agreed to in Senate: Passed Senate.", "code": "17000", "source": "Library of Congress"},
                {"date": "2003-07-07", "text": "Senate vitiated previous passage pursuant to the order.", "source": "Senate"},
                {"date": "2003-06-01", "text": "Committee reported.", "code": "14000", "source": "Library of Congress"}]
        ms = bc.milestones({"introducedDate": "2003-01-07"}, acts)
        self.assertEqual(ms["passed_senate"]["vitiated"], "2003-07-07")
        self.assertEqual(bc.status("s", ms), ("reported", "Reported by committee"))

    def test_resolution_labels(self):
        ms = {"introduced": {"date": "2023-01-09"}, "passed_house": {"date": "2023-01-09"}}
        self.assertEqual(bc.status("hres", ms), ("passed_house", "Agreed to in House"))
        self.assertEqual(bc.status("hr", ms), ("passed_house", "Passed House"))
        self.assertEqual(bc.status("hr", {}), ("not_recorded", "Not recorded"))

    def test_text_rule(self):
        acts = [{"date": "2010-01-01", "text": "Became Public Law No: 111-1."}]
        self.assertEqual(bc.milestones({}, acts)["became_law"]["evidence"], "action text")

    def test_committee_report(self):
        self.assertEqual(bc.committee_report("H. Rept. 118-138")["url"], "https://www.govinfo.gov/app/details/CRPT-118hrpt138")
        self.assertEqual(bc.committee_report("H. Rept. 118-138")["linkService"], "https://www.govinfo.gov/link/crpt/118/hrpt/138")
        r = bc.committee_report("S. Rept. 117-12,Part 2")
        self.assertEqual((r["doc"], r["number"], r["suffix"]), ("srpt", 12, "Part 2"))
        self.assertIsNone(bc.committee_report("S. Exec. Rept. 117-1")["url"])

    def test_law_resolution(self):
        lookup = {"118-63": [{"id": "stat-138-1025", "shared": False}], "118-9": [{"id": "a", "shared": True}],
                  "118-10": [{"id": "b", "shared": False}, {"id": "c", "shared": False}]}
        ok = bc.law_entry({"type": "Public Law", "number": "118-63"}, lookup)
        self.assertEqual(ok["resolution"]["href"], "/records/public_laws_enacted/stat-138-1025")
        self.assertEqual(ok["govinfo"], "https://www.govinfo.gov/link/plaw/118/public/63")
        self.assertEqual(bc.law_entry({"type": "Public Law", "number": "118-9"}, lookup)["resolution"]["status"], "ambiguous")
        self.assertEqual(bc.law_entry({"type": "Public Law", "number": "118-10"}, lookup)["resolution"]["status"], "ambiguous")
        self.assertEqual(bc.law_entry({"type": "Public Law", "number": "118-11"}, lookup)["resolution"]["status"], "not_found")
        self.assertEqual(bc.law_entry({"type": "Private Law", "number": "118-1"}, lookup)["resolution"]["status"], "not_checked")
        self.assertEqual(bc.law_entry({"type": "Public Law", "number": "118-63"}, None)["resolution"]["status"], "not_checked")
        odd = bc.law_entry({"type": "Public Law", "number": "106-246"}, lookup, 110)
        self.assertEqual(odd["resolution"]["status"], "inconsistent")
        self.assertNotIn("govinfo", odd)

    def test_text_version(self):
        t = bc.text_version({"type": "Introduced in House", "date": "2023-06-09",
                             "formats": [{"url": "https://www.govinfo.gov/content/pkg/BILLS-118hr3935ih/xml/BILLS-118hr3935ih.xml"}]})
        self.assertEqual(t["package"], "BILLS-118hr3935ih")
        self.assertEqual(t["details"], "https://www.govinfo.gov/app/details/BILLS-118hr3935ih")


def _int(v: int) -> bytes:
    return bytes([1 if v < 0 else 0]) + struct.pack("<I", abs(v))


def _str(s: str | None) -> bytes:
    if s is None:
        return _int(-1)
    b = s.encode()
    return _int(len(b)) + b


def synthetic_archive(rows: list[str]) -> bytes:
    """A minimal pg_dump custom archive (v1.16, gzip) with one TABLE DATA entry and its data block."""
    head = b"PGDMP" + bytes([1, 16, 0, 4, 8, 1, 1]) + b"".join(_int(0) for _ in range(7))
    head += _str("db") + _str("17.0") + _str("17.0") + _int(1)
    entry = _int(7) + _int(1) + _str("0") + _str("0") + _str("t") + _str("TABLE DATA") + _int(3) + _str("") + _str("")
    entry += _str("COPY public.t (id, name, tags) FROM stdin;\n") + _str("public") + _str("") + _str("heap") + _int(114)
    entry += _str("owner") + _str("false") + _str(None) + bytes([1]) + (0).to_bytes(8, "little")
    data = ("\n".join(rows) + "\n\\.\n\n").encode()
    comp = zlib.compress(data)
    block = bytes([1]) + _int(7) + _int(len(comp[:10])) + comp[:10] + _int(len(comp[10:])) + comp[10:] + _int(0)
    return head + entry + block


class PgDump(unittest.TestCase):
    def test_toc_and_block(self):
        raw = synthetic_archive(["1\tAlpha\t{a,b}", "2\t\\N\t{}", "3\tTab\\there\t{\"x y\"}"])
        a = pr.read_toc(raw)
        self.assertEqual(a.version, (1, 16, 0))
        self.assertEqual(len(a.toc), 1)
        e = a.toc[0]
        self.assertEqual((e.tag, e.desc, e.offset_flag), ("t", "TABLE DATA", 1))
        cols = pr.copy_columns(e.copy_stmt)
        self.assertEqual(cols, ["id", "name", "tags"])
        rest = raw[a.toc_end:]
        bs = pr.BlockStream(iter([rest[i:i + 7] for i in range(0, len(rest), 7)]), a.int_size, a.compression)
        out = list(pr.rows(bs.lines(7), cols))
        self.assertEqual([r["id"] for r in out], ["1", "2", "3"])
        self.assertIsNone(out[1]["name"])
        self.assertEqual(out[2]["name"], "Tab\there")
        self.assertEqual(oc.pg_array(out[2]["tags"]), ["x y"])
        bs2 = pr.BlockStream(iter([rest]), a.int_size, a.compression)
        self.assertGreater(bs2.skip(7), 0)
        with self.assertRaises(ValueError):
            list(pr.BlockStream(iter([rest]), 4, 1).lines(8))

    def test_bad_rows(self):
        with self.assertRaises(ValueError):
            list(pr.rows(iter(["1\t2"]), ["a", "b", "c"]))
        self.assertEqual(pr.unescape_copy("a\\\\b\\nc\\101"), "a\\b\ncA")


class OpenStates(unittest.TestCase):
    def test_sessions_and_arrays(self):
        self.assertTrue(oc.is_regular({"classification": "", "name": "2025 Regular Session"}))
        self.assertFalse(oc.is_regular({"classification": "primary", "name": "2025 1st Extraordinary Session"}))
        self.assertFalse(oc.is_regular({"classification": "special", "name": "2025 Session"}))
        self.assertTrue(oc.is_regular({"classification": "primary", "name": "2026 Fiscal Session"}))
        self.assertEqual(oc.pg_array('{introduction,"reading-1"}'), ["introduction", "reading-1"])
        self.assertEqual(oc.pg_array("{}"), [])
        self.assertEqual(oc.abbr("ocd-jurisdiction/country:us/district:dc/government"), "DC")
        self.assertIsNone(oc.abbr("ocd-jurisdiction/country:us/state:mt/place:missoula/government"))

    def test_milestones(self):
        org = {"o-lower": "lower", "o-upper": "upper", "o-gov": "executive", "o-uni": "legislature"}
        acts = [{"date": "2025-01-10", "order": "0", "classification": ["introduction"], "organization_id": "o-lower"},
                {"date": "2025-03-01", "order": "1", "classification": ["passage"], "organization_id": "o-lower"},
                {"date": "2025-04-01", "order": "0", "classification": ["passage"], "organization_id": "o-upper"},
                {"date": "2025-05-01", "order": "0", "classification": ["executive-signature"], "organization_id": "o-gov"}]
        ms = oc.milestones(acts, org)
        self.assertEqual(ms["passed_lower"]["date"], "2025-03-01")
        self.assertEqual(ms["passed_upper"]["date"], "2025-04-01")
        self.assertIsNone(ms["became_law"])
        self.assertEqual(oc.status(ms)[0], "signed")
        self.assertEqual(oc.outcome(ms), "enacted")
        uni = oc.milestones([{"date": "2025-02-01", "classification": ["passage"], "organization_id": "o-uni"}], org)
        self.assertEqual(oc.status(uni)[0], "passed_legislature")
        self.assertEqual(oc.outcome(oc.milestones([], org)), "none")
        self.assertEqual(oc.status(oc.milestones([], org))[0], "not_recorded")

    def test_sources_and_ids(self):
        srcs = [{"url": "https://www.justia.com/x"}, {"url": "https://openstates.org/ca/bills/x"}, {"url": "ftp://x"},
                {"url": "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=1", "note": ""},
                {"url": "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=1"}]
        self.assertEqual([s["url"] for s in oc.official_sources(srcs)],
                         ["https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=1"])
        kinds = {u: oc.source_kind(u) for u in (
            "https://legislation.nysenate.gov/api/3/bills/2023-2024/A1492?summary=&detail=",
            "http://webservices.legis.ga.gov/GGAServices/Members/Service.svc?wsdl",
            "https://www.nysenate.gov/legislation/bills/2025/A1492",
            "https://status.rilegislature.gov/",
            "https://alison.legislature.state.al.us/bill-search",
            "https://nebraskalegislature.gov/bills/search_by_date.php?SessionDay=2025-01-08",
            "https://bills.legmt.gov/#/laws/bill/2/LC4301?open_tab=sum",
            "https://legislature.vermont.gov/bill/loadBillDetailedStatus/2026/123")}
        self.assertEqual(list(kinds.values()), ["data", "data", "page", "search", "search", "search", "page", "data"])
        ordered = oc.official_sources([{"url": "https://sdlegislature.gov/api/Bills/1"}, {"url": "https://sdlegislature.gov/Session/Bill/1"}])
        self.assertEqual([s["kind"] for s in ordered], ["page", "data"])
        self.assertEqual(oc.record_id("CA", "20252026", "AB 1"), "ca-20252026-ab1")
        self.assertEqual(oc.record_id("AZ", "57th-2nd-regular", "HB 2001"), "az-57th-2nd-regular-hb2001")
        self.assertEqual(oc.ident_key("H.B. 10a"), "HB10A")
        self.assertEqual(oc.openstates_url("CA", "20252026", "AB 1"), "https://openstates.org/ca/bills/20252026/AB1/")

    def test_choose_sessions(self):
        import build_state_bills as bsb

        with tempfile.TemporaryDirectory() as d:
            src = Path(d)
            j = "ocd-jurisdiction/country:us/state:ms/government"
            sessions = [
                {"id": "s25", "identifier": "2025", "name": "2025 Regular Session", "classification": "primary", "start_date": "2025-01-07", "jurisdiction_id": j},
                {"id": "s26", "identifier": "2026", "name": "2026 Regular Session", "classification": "primary", "start_date": "2025-01-06", "jurisdiction_id": j},
                {"id": "x26", "identifier": "20261E", "name": "2026 1st Extraordinary Session", "classification": "primary", "start_date": "2026-07-14", "jurisdiction_id": j},
                {"id": "s27", "identifier": "2027", "name": "2027 Regular Session", "classification": "primary", "start_date": "2027-01-05", "jurisdiction_id": j},
                {"id": "s24", "identifier": "2024", "name": "2024 Regular Session", "classification": "primary", "start_date": "2024-01-02", "jurisdiction_id": j},
            ]
            bills = [{"id": "b1", "legislative_session_id": "s25", "first_action_date": "2025-01-20"},
                     {"id": "b2", "legislative_session_id": "s26", "first_action_date": "2026-01-20"},
                     {"id": "b3", "legislative_session_id": "x26", "first_action_date": "2026-07-14"},
                     {"id": "b4", "legislative_session_id": "s27", "first_action_date": "2026-11-01"},
                     {"id": "b5", "legislative_session_id": "s24", "first_action_date": "2024-01-20"}]
            for name, items in (("sessions", sessions), ("bills", bills)):
                with gzip.open(src / f"{name}.jsonl.gz", "wt") as fh:
                    fh.write("".join(json.dumps(x) + "\n" for x in items))
            _, chosen, _ = bsb.choose_sessions(src)
            self.assertEqual([(c["identifier"], c["role"]) for c in chosen[j]], [("2026", "current"), ("2025", "preceding")])


class VerifierSecondPath(unittest.TestCase):
    def test_regex_identity_ignores_nested_blocks(self):
        import verify_legislation as vl

        nested = V3.replace(b"<amendments><amendment>", b"<amendments><amendment><amendments><latestAction><actionDate>1999-01-01</actionDate></latestAction></amendments>")
        ident = vl.regex_identity(nested.decode())
        self.assertEqual((ident["congress"], ident["type"], ident["number"]), ("118", "hr", "3935"))
        self.assertEqual(ident["introduced"], "2023-06-09")
        self.assertIsNone(ident["latest"], "the fixture has no bill-level latestAction; nested ones must not be picked")
        self.assertEqual(ident["laws"], ["118-63"])
        self.assertEqual(len(ident["summaries"]), 2)
        self.assertEqual(vl.strip_balanced("a<x>1<x>2</x>3</x>b<x/>c<x />d", "x"), "abcd")
        old = vl.regex_identity(OLD.replace(b"<title>", b"<amendments /><laws /><latestAction><actionDate>2021-01-03</actionDate></latestAction><title>").decode())
        self.assertEqual((old["number"], old["latest"], len(old["summaries"])), ("9", "2021-01-03", 1))


class CongressApiNames(unittest.TestCase):
    def test_stored_name_has_no_key(self):
        import congress_api as api

        p = api.stored_name("/bill/118/hr/1", {"format": "json", "api_key": "SECRET"})
        self.assertNotIn("SECRET", str(p))
        self.assertTrue(str(p).endswith("bill_118_hr_1__format=json.json.gz"))


if __name__ == "__main__":
    unittest.main()
