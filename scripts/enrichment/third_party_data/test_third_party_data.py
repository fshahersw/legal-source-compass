"""Offline unit tests for the third_party_data stream (synthetic fixtures, no network).

Run:  cd scripts/enrichment/third_party_data && python3 -B -m unittest -v test_third_party_data
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import build_sol_discrepancies as sol  # noqa: E402
import build_third_party_data as bt  # noqa: E402
import check_no_source_names as nsn  # noqa: E402
import check_sources as cs  # noqa: E402
import htmltext  # noqa: E402
import tp_common as tp  # noqa: E402
import verify_sample as vs  # noqa: E402
import vt_parse as vp  # noqa: E402
import write_verdicts as wv  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BUILD = os.path.join(ROOT, "private", "build", "third_party_data")


# --------------------------------------------------------------------------- shared helpers

class TestCommon(unittest.TestCase):
    def test_host_and_source_class(self):
        self.assertEqual(tp.host_of("https://www.ftc.gov/enforcement/refunds/x"), "ftc.gov")
        self.assertEqual(tp.host_of(""), "")
        self.assertEqual(tp.host_of(None), "")
        self.assertEqual(tp.source_class("https://www.ftc.gov/x"), "government")
        self.assertEqual(tp.source_class("https://www.doj.state.or.us/x"), "government")
        self.assertEqual(tp.source_class("https://www.claimdepot.com/settlements/x"), "aggregator")
        self.assertEqual(tp.source_class("https://www.prnewswire.com/news/x"), "press_release")
        self.assertEqual(tp.source_class("https://www.uscourts.gov/x"), "court")
        self.assertEqual(tp.source_class("https://cases.courts.ca.gov/x"), "court")
        self.assertEqual(tp.source_class("https://www.examplesettlement.com/"), "settlement_website")
        self.assertEqual(tp.source_class(None), "none")

    def test_money_values(self):
        self.assertEqual(tp.money_values("$6,100,000 and $1.5 million and $20.00"), [6100000.0, 1500000.0, 20.0])
        self.assertEqual(tp.money_values("no figures"), [])
        self.assertEqual(tp.money_values(None), [])
        self.assertEqual(tp.money_values("$2 billion"), [2e9])

    def test_norm_title_and_url(self):
        self.assertEqual(tp.norm_title("Smith v. Acme, Inc. ($5M) Settlement"), "smith v acme inc $5m settlement")
        self.assertEqual(tp.norm_url("HTTPS://www.Example.com/a/b/?q=1#frag"), "example.com/a/b?q=1")
        self.assertEqual(tp.norm_url(""), "")
        self.assertEqual(tp.norm_url("http://example.com/a/"), tp.norm_url("https://www.example.com/a"))

    def test_caption(self):
        self.assertEqual(tp.caption("Polk v. American Well Corp."), ("Polk", "American Well Corp."))
        self.assertEqual(tp.caption("Acme $5M Settlement (Doe vs. Acme Inc.)"), ("Doe", "Acme Inc."))
        self.assertIsNone(tp.caption("Wise Auto Group $1M Wage and Hour Class Action Settlement"))
        self.assertIsNone(tp.caption(""))

    def test_company_matching_exact_ambiguous_nomatch(self):
        index = {tp.norm_company("BAXTER INTERNATIONAL INC"): ["0000010456"],
                 tp.norm_company("Twin Corp"): ["0000000001", "0000000002"]}
        self.assertEqual(tp.exact_company("Baxter International, Inc.", index), ("0000010456", "matched"))
        self.assertEqual(tp.exact_company("  baxter   international inc ", index), ("0000010456", "matched"))
        self.assertEqual(tp.exact_company("Twin Corp", index), (None, "ambiguous"))
        self.assertEqual(tp.exact_company("Baxter Healthcare", index), (None, "no_match"))  # no fuzzy / prefix matching
        self.assertEqual(tp.exact_company("Becton, Dickinson, and Company", {tp.norm_company("BECTON DICKINSON & CO"): ["1"]}), (None, "no_match"))  # no abbreviation expansion
        self.assertEqual(tp.exact_company("", index), (None, "no_name"))

    def test_deadline_state_boundaries(self):
        self.assertEqual(tp.deadline_state(None, "2026-10-18"), "unknown")
        self.assertEqual(tp.deadline_state("2026-10-17", "2026-10-18"), "passed")
        self.assertEqual(tp.deadline_state("2026-10-18", "2026-10-18"), "within_30_days")
        self.assertEqual(tp.deadline_state("2026-11-17", "2026-10-18"), "within_30_days")  # exactly 30 days
        self.assertEqual(tp.deadline_state("2026-11-18", "2026-10-18"), "future")

    def test_tokens_jaccard(self):
        a, b = tp.tokens("Etairos Health Data Breach Settlement"), tp.tokens("DAP Health Data Breach Settlement")
        self.assertAlmostEqual(tp.jaccard(a, b), 4 / 6, places=3)
        self.assertEqual(tp.jaccard(set(), b), 0.0)


class TestHtmlText(unittest.TestCase):
    def test_scripts_dropped_and_links_kept(self):
        text, links = htmltext.to_text("<html><head><title>T</title><script>var x=1;</script></head><body><p>Claim deadline June 15, 2026</p><a href='/c'>Claim</a></body></html>")
        self.assertIn("Claim deadline June 15, 2026", text)
        self.assertNotIn("var x", text)
        self.assertEqual(links, [("Claim", "/c")])

    def test_check_sources_key_is_stable(self):
        self.assertEqual(cs.key_of("https://a.example/x"), cs.key_of("https://a.example/x"))
        self.assertNotEqual(cs.key_of("https://a.example/x"), cs.key_of("https://a.example/y"))
        self.assertEqual(len(cs.key_of("https://a.example/x")), 20)


# --------------------------------------------------------------------------- Violation Tracker listing parser

FED_HTML = """
<html><body><p>Below are data sources for federal agencies that Violation Tracker covers.</p>
<p>Environmental Protection Agency: <a href="https://echo.epa.gov/">enforcement cases</a></p>
<p>Federal Aviation Administration: <a href="/a/b">quarterly enforcement reports</a> and <a href="https://www.faa.gov/c">civil penalties</a></p>
<p>Office of Foreign Assets Control: <a href="https://goodjobsfirst.org/x">Good Jobs First link</a></p>
<p>Consumer Product Safety Commission</p>
<p>Jump to state and local sources</p>
<p>Not an entry after the break</p></body></html>
"""
STATE_HTML = """
<html><body><p>Violation Tracker coverage for state AGs and other agencies.</p>
<h3>ALABAMA</h3>
<p>Alabama Attorney General: <a href="https://www.alabamaag.gov/news">settlements and verdicts announced in press releases</a></p>
<h3>ILLINOIS</h3>
<p>Chicago Commission on Human Relations: <a href="https://www.chicago.gov/cchr">decisions</a></p>
<p>Illinois Department of Public Health: open records request</p>
<h3>DISTRICT OF COLUMBIA</h3>
<p>Office of the Attorney General for DC: <a href="https://oag.dc.gov/x">press releases</a></p>
<p>Jump to federal sources</p>
</body></html>
"""


class TestViolationTrackerParser(unittest.TestCase):
    def test_federal_entries(self):
        entries = vp.parse_federal(FED_HTML, "https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources")
        self.assertEqual([e["agency"] for e in entries],
                         ["Environmental Protection Agency", "Federal Aviation Administration", "Office of Foreign Assets Control", "Consumer Product Safety Commission"])
        self.assertEqual(entries[0]["links"], [("enforcement cases", "https://echo.epa.gov/")])
        faa = entries[1]
        self.assertEqual([u for _, u in faa["links"]], ["https://www.faa.gov/c"])  # the relative link resolves to a Good Jobs First page and is dropped
        self.assertEqual(vp.norm_url("/x", "https://agency.gov/p/"), "https://agency.gov/x")
        self.assertEqual(vp.norm_url("//agency.gov/y", "https://agency.gov/p/"), "https://agency.gov/y")
        self.assertIsNone(vp.norm_url("", "https://agency.gov/"))
        self.assertEqual(entries[2]["links"], [])  # Good Jobs First navigation link dropped
        self.assertEqual(entries[3]["coverage"], "")  # agency-only line: no coverage phrase invented
        self.assertTrue(all(e["jurisdiction"] == "Federal" for e in entries))

    def test_state_entries_and_states(self):
        entries = vp.parse_state_local(STATE_HTML, "https://violationtracker.goodjobsfirst.org/pages/local-state-data-sources")
        self.assertEqual([(e["state"], e["agency"]) for e in entries],
                         [("AL", "Alabama Attorney General"), ("IL", "Chicago Commission on Human Relations"),
                          ("IL", "Illinois Department of Public Health"), ("DC", "Office of the Attorney General for DC")])
        self.assertEqual(entries[2]["links"], [])  # open-records request has no URL
        self.assertEqual(entries[3]["jurisdiction"], "District of Columbia")

    def test_split_entry(self):
        self.assertEqual(vp.split_entry("Agency: covers; also more"), ("Agency", "covers; also more"))
        self.assertEqual(vp.split_entry("Agency only"), ("Agency only", ""))

    def test_dedupe_links_keeps_first_nonempty_anchor(self):
        links = vp.dedupe_links([("", "https://a.gov/x"), ("Anchor", "https://a.gov/x"), ("", ""), ("GJF", "https://goodjobsfirst.org/y")])
        self.assertEqual(links, [("Anchor", "https://a.gov/x")])

    def test_levels(self):
        def level(agency, jurisdiction="Illinois"):
            return vp.level_of({"agency": agency, "jurisdiction": jurisdiction})
        self.assertEqual(level("Environmental Protection Agency", "Federal"), "federal")
        self.assertEqual(level("Public Company Accounting Oversight Board", "Federal"), "federal_self_regulatory")
        self.assertEqual(level("Chicago Commission on Human Relations"), "local")
        self.assertEqual(level("Denver Labor", "Colorado"), "local")
        self.assertEqual(level("Maricopa County Attorney", "Arizona"), "local")
        self.assertEqual(level("Bay Area Air Quality Management District", "California"), "regional")
        self.assertEqual(level("Olympic Region (WA) Clean Air Agency", "Washington"), "regional")
        self.assertEqual(level("Illinois Department of Public Health"), "state")
        self.assertEqual(level("CalRecycle", "California"), "state")

    def test_source_types(self):
        self.assertEqual(vp.source_types(""), ["resource"])
        self.assertIn("open_records_request", vp.source_types("open records request"))
        self.assertIn("press_releases", vp.source_types("settlements and verdicts announced in press releases"))
        self.assertIn("orders_and_actions", vp.source_types("settlements and verdicts announced in press releases"))
        self.assertEqual(vp.source_types("zzz qqq"), ["other"])

    def test_domains(self):
        self.assertTrue(vp.official_domain("dph.illinois.gov"))
        self.assertTrue(vp.official_domain("www.doj.state.or.us"))
        self.assertFalse(vp.official_domain("example.com"))
        self.assertEqual(vp.registrable("www.doj.state.or.us"), "state.or.us")
        self.assertEqual(vp.registrable("a.b.example.com"), "example.com")


# --------------------------------------------------------------------------- SettleSignal builder pieces

def record(**kw):
    base = {"title": "Doe v. Acme Corp.", "url": "https://settlesignal.com/settlements/doe-v-acme/", "official_settlement_url": "https://acmesettlement.com/",
            "official_claim_url": None, "verification_status": "official_source_found", "claim_deadline": "2026-12-01",
            "estimated_payout": "$20.00 each", "status": "Open for claims", "applicable_states": [], "accepted_official_evidence": True}
    base.update(kw)
    return base


class TestRetrievalAndInclusion(unittest.TestCase):
    def check(self, **kw):
        base = {"url": "https://acmesettlement.com/", "final_url": "https://acmesettlement.com/", "status": 200, "settlesignal_url": "x", "checked_at": "2026-10-18T00:00:00Z"}
        base.update(kw)
        return base

    def page(self, text):
        handle = tempfile.NamedTemporaryFile("wb", suffix=".bin", delete=False)
        handle.write(text.encode())
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_retrieved_needs_settlement_wording_and_same_site(self):
        ok = self.check(path=self.page("<html>Settlement claim form deadline</html>"))
        self.assertEqual(bt.retrieval_state(ok)[0], "retrieved")
        parked = self.check(path=self.page("<html>This domain is for sale</html>"))
        self.assertEqual(bt.retrieval_state(parked)[0], "not_retrieved")
        moved = self.check(path=self.page("<html>settlement</html>"), final_url="https://other-site.example/booting")
        self.assertEqual(bt.retrieval_state(moved)[0], "not_retrieved")

    def test_bot_wall_is_access_restricted_not_missing(self):
        self.assertEqual(bt.retrieval_state(self.check(status=403))[0], "access_restricted")
        self.assertEqual(bt.retrieval_state(self.check(status=404))[0], "not_retrieved")
        self.assertEqual(bt.retrieval_state(self.check(status=None, error="URLError: boom"))[0], "not_retrieved")
        self.assertEqual(bt.retrieval_state(self.check(status=None, outcome="robots_disallowed"))[0], "access_restricted")
        self.assertEqual(bt.retrieval_state(None)[0], "not_retrieved")

    def test_sandbox_block_page_is_never_read_as_a_404(self):
        url = "https://www.ftc.gov/enforcement/refunds/rando-refunds"
        blocked = self.check(url=url, final_url=url, status=404, sha256=bt.SANDBOX_BLOCK_SHA)
        state, note, method = bt.retrieval_state(blocked)
        self.assertEqual((state, method), ("access_restricted", "none"))
        live = {url: {"status": 200, "note": "Rando Refunds", "usable": True}}
        state, note, method = bt.retrieval_state(blocked, live)
        self.assertEqual((state, method), ("retrieved", "firecrawl"))
        dead = {url: {"status": 404, "note": "Page not found", "usable": False}}
        state, note, method = bt.retrieval_state(blocked, dead)
        self.assertEqual((state, method), ("not_retrieved", "firecrawl"))
        # a 404 from a different host with the same body hash is still only a sandbox block for ftc.gov; hosts are looked up by URL
        self.assertEqual(bt.retrieval_state(self.check(status=404))[0], "not_retrieved")

    def test_independent_read_is_recorded_on_exclusions(self):
        c = self.check(url="https://gone.example/", status=404)
        state, note, _ = bt.retrieval_state(c, {"https://gone.example/": {"status": 404, "note": "Not Found", "usable": False}})
        self.assertEqual(state, "not_retrieved")
        self.assertIn("independent read through Firecrawl", note)

    def test_firecrawl_read_upgrades_only_when_it_is_the_cited_page(self):
        url = "https://www.example-settlement.com/"
        usable = {url: {"status": 200, "note": "official site", "usable": True}}
        hijacked = {url: {"status": 200, "note": "now a gambling site", "usable": False}}
        empty_shell = self.check(url=url, status=200, path=self.page("<html>JavaScript app shell</html>"))  # no settlement wording in the static HTML
        self.assertEqual(bt.retrieval_state(empty_shell)[0], "not_retrieved")
        self.assertEqual(bt.retrieval_state(empty_shell, usable)[0::2], ("retrieved", "firecrawl"))
        state, note, _ = bt.retrieval_state(empty_shell, hijacked)
        self.assertEqual(state, "not_retrieved")  # a 200 that is not the cited page never upgrades
        self.assertIn("now a gambling site", note)
        tls = self.check(url=url, status=None, error="URLError: certificate verify failed")
        self.assertEqual(bt.retrieval_state(tls, usable)[0::2], ("retrieved", "firecrawl"))
        redirect = self.check(url=url, status=302)
        self.assertEqual(bt.retrieval_state(redirect, usable)[0], "retrieved")
        bot_wall = self.check(url=url, status=403)
        self.assertEqual(bt.retrieval_state(bot_wall, usable)[0::2], ("retrieved", "firecrawl"))
        self.assertEqual(bt.retrieval_state(bot_wall, hijacked)[0], "access_restricted")
        unreachable_robots = self.check(url=url, status=None, outcome="robots_unreachable", error="URLError: tls")
        self.assertEqual(bt.retrieval_state(unreachable_robots, usable)[0], "retrieved")
        self.assertEqual(bt.retrieval_state(unreachable_robots)[0], "not_retrieved")

    def test_robots_disallow_is_never_overridden_by_a_page_read(self):
        url = "https://www.example-settlement.com/"
        usable = {url: {"status": 200, "note": "official site", "usable": True}}
        disallowed = self.check(url=url, status=None, outcome="robots_disallowed")
        self.assertEqual(bt.retrieval_state(disallowed, usable)[0::2], ("access_restricted", "none"))

    def test_load_firecrawl_flags(self):
        # entries without an explicit flag are usable only when they are a 200; null status is never usable
        original = bt.ACQ
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "verification"))
            with open(os.path.join(tmp, "verification", "firecrawl_checks.json"), "w", encoding="utf-8") as handle:
                json.dump({"ftc": [["a-refunds", 200, "A"], ["b-refunds", 404, "Page not found"]],
                           "other": [["https://x.example/", 200, "ok"], ["https://y.example/", 200, "parked", False], ["https://z.example/", None, "timeout"]]}, handle)
            bt.ACQ = tmp
            try:
                got = bt.load_firecrawl()
            finally:
                bt.ACQ = original
        self.assertTrue(got[bt.FIRECRAWL_FTC_BASE + "a-refunds"]["usable"])
        self.assertFalse(got[bt.FIRECRAWL_FTC_BASE + "b-refunds"]["usable"])
        self.assertTrue(got["https://x.example/"]["usable"])
        self.assertFalse(got["https://y.example/"]["usable"])
        self.assertFalse(got["https://z.example/"]["usable"])

    def test_citable_rules(self):
        retrieved = self.check(path=self.page("settlement"))
        self.assertEqual(bt.citable(record(), retrieved)[0], True)
        self.assertEqual(bt.citable(record(official_settlement_url=None), None), (False, "no official source URL in the record"))
        self.assertFalse(bt.citable(record(official_settlement_url="https://www.claimdepot.com/settlements/x"), retrieved)[0])
        self.assertFalse(bt.citable(record(verification_status="third_party_only"), retrieved)[0])
        self.assertFalse(bt.citable(record(), self.check(status=404))[0])
        self.assertTrue(bt.citable(record(), self.check(status=403))[0])  # restricted host: included, labelled not loaded

    def test_facts_not_recorded_path(self):
        self.assertEqual(bt.facts([("A", None), ("B", ""), ("C", "x"), ("D", 0)]), [["A", "Not recorded"], ["B", "Not recorded"], ["C", "x"], ["D", "0"]])


class TestOverlap(unittest.TestCase):
    EXISTING = [
        {"id": "s1", "slug": "doe-v-acme", "source_url": "https://settlesignal.com/settlements/doe-v-acme/", "title": "Doe v. Acme Corp. $5M Settlement", "amount_in_title": "", "caption": "", "family": "", "mdl": ""},
        {"id": "s2", "slug": "", "source_url": "https://officialsite.com/claim", "title": "Some Other Title", "amount_in_title": "", "caption": "", "family": "", "mdl": ""},
        {"id": "s3", "slug": "", "source_url": "https://other.example/x", "title": "Beta $3M Co-Pay Settlement (Roe v. Beta Inc.)", "amount_in_title": "", "caption": "", "family": "", "mdl": ""},
        {"id": "s4", "slug": "etairos-like", "source_url": "https://settlesignal.com/settlements/etairos-like/", "title": "DAP Health Data Breach Settlement", "amount_in_title": "", "caption": "", "family": "", "mdl": ""},
        {"id": "s5", "slug": "dup-a", "source_url": "https://shared.example/claim", "title": "Dup Title", "amount_in_title": "", "caption": "", "family": "", "mdl": ""},
        {"id": "s6", "slug": "dup-b", "source_url": "https://shared.example/claim", "title": "Dup Title Again", "amount_in_title": "", "caption": "", "family": "", "mdl": ""},
    ]

    def recs(self):
        return [
            record(url="https://settlesignal.com/settlements/doe-v-acme/", title="Doe v. Acme Corp. $5M Settlement", official_settlement_url="https://acme.example/"),
            record(url="https://settlesignal.com/settlements/x-official/", title="Totally Different", official_settlement_url="https://www.officialsite.com/claim/"),
            record(url="https://settlesignal.com/settlements/roe/", title="Beta $3M Class Action (Roe v. Beta Inc.)", official_settlement_url="https://new.example/"),
            record(url="https://settlesignal.com/settlements/brand-new/", title="Gamma Widgets Refund", official_settlement_url="https://gamma.example/"),
            record(url="https://settlesignal.com/settlements/etairos/", title="Etairos Health Data Breach Settlement", official_settlement_url="https://etairos.example/"),
            record(url="https://settlesignal.com/settlements/shared/", title="Unrelated Name", official_settlement_url="https://shared.example/claim"),
        ]

    def test_exact_matches_non_match_and_near_duplicates(self):
        results, near, matched = bt.overlap(self.recs(), self.EXISTING)
        self.assertEqual(results["https://settlesignal.com/settlements/doe-v-acme/"]["existing_ids"], ["s1"])
        self.assertEqual(results["https://settlesignal.com/settlements/x-official/"]["existing_ids"], ["s2"])  # official URL, www and trailing slash normalised
        self.assertEqual(results["https://settlesignal.com/settlements/roe/"]["exact"]["caption_and_amount"], ["s3"])  # caption + amount in title, not the same title
        self.assertEqual(results["https://settlesignal.com/settlements/brand-new/"]["existing_ids"], [])  # non-match: no row is invented
        self.assertEqual(sorted(matched), ["s1", "s2", "s3", "s5", "s6"])
        pairs = [(n["settlesignal_url"].rsplit("/", 2)[-2], n["existing_id"]) for n in near]
        self.assertIn(("etairos", "s4"), pairs)  # listed for review only
        self.assertTrue(all(n["action"] == "review only; not merged" for n in near))

    def test_ambiguous_official_url_lists_every_candidate(self):
        results, _, _ = bt.overlap(self.recs(), self.EXISTING)
        self.assertEqual(results["https://settlesignal.com/settlements/shared/"]["existing_ids"], ["s5", "s6"])  # never collapsed to one


class TestCatalogCoverage(unittest.TestCase):
    def test_coverage_by_host_name_and_acronym(self):
        by_host = {"echo.epa.gov": {"regulatory_epa_cases": 120}, "faa.gov": {"sources": 0}}
        labels = {"regulatory_epa_cases": {"label": "EPA ECHO enforcement cases", "ready": True},
                  "agency_safety_fda_recalls": {"label": "FDA recalls (openFDA)", "ready": True},
                  "unrelated": {"label": "SECTION lookup", "ready": True}}
        epa = {"agency": "Environmental Protection Agency", "jurisdiction": "Federal", "links": [("x", "https://echo.epa.gov/")]}
        got = bt.corpus_coverage(epa, by_host, labels)
        self.assertEqual([c["dataset"] for c in got], ["regulatory_epa_cases"])
        self.assertIn("same official host echo.epa.gov (120 records)", got[0]["basis"])
        fda = {"agency": "Food and Drug Administration", "jurisdiction": "Federal", "links": []}
        self.assertEqual([c["dataset"] for c in bt.corpus_coverage(fda, by_host, labels)], ["agency_safety_fda_recalls"])  # whole-word acronym
        sec = {"agency": "Securities and Exchange Commission", "jurisdiction": "Federal", "links": []}
        self.assertEqual(bt.corpus_coverage(sec, by_host, labels), [])  # 'SECTION' does not contain the whole word SEC
        state = {"agency": "Idaho Department of Labor", "jurisdiction": "Idaho", "links": [("x", "https://labor.idaho.gov/")]}
        self.assertEqual(bt.corpus_coverage(state, by_host, labels), [])

    def test_url_state(self):
        self.assertEqual(bt.url_state(None)[0], "not_checked")
        self.assertEqual(bt.url_state({"outcome": "robots_disallowed"})[0], "not_fetched")
        self.assertEqual(bt.url_state({"status": 403})[0], "restricted")
        self.assertEqual(bt.url_state({"status": 404})[0], "error")
        self.assertEqual(bt.url_state({"status": None, "error": "boom"}), ("unreachable", "boom"))
        state, note = bt.url_state({"status": 200, "url": "https://a.gov/x", "final_url": "https://a.gov/x", "page_title": "Press &amp; News"})
        self.assertEqual((state, note), ("ok", "HTTP 200 — page title: Press & News"))
        state, note = bt.url_state({"status": 200, "url": "https://a.gov/x", "final_url": "https://b.gov/portal"})
        self.assertIn("redirected to https://b.gov/portal", note)  # a redirect elsewhere is visible, not hidden


# --------------------------------------------------------------------------- verification sample matching

class TestVerifySample(unittest.TestCase):
    def test_date_variants(self):
        variants = vs.date_variants("2026-06-09")
        for text in ("June 9, 2026", "6/9/2026", "06/09/2026", "9 June 2026", "Jun. 9, 2026", "June 9th, 2026"):
            self.assertIn(text, variants)

    def test_title_amount_precision(self):
        self.assertEqual(vs.title_amounts("Cook County $5.68M Settlement"), [(5680000.0, 1e6, 2)])
        self.assertEqual(vs.title_amounts("Ampac $318,825 BIPA"), [(318825.0, 1.0, 2)])
        self.assertEqual(vs.title_amounts("Settlement"), [])

    def test_party_phrase(self):
        self.assertEqual(vs.party_phrase("Thompson v. iQ Credit Union Settlement"), "iQ Credit Union")
        self.assertEqual(vs.party_phrase("Ampac Holdings $318,825 Illinois BIPA Class Action Settlement"), "Ampac Holdings")  # stops at the dollar figure

    def test_check_record_matches_and_misses(self):
        rec = {"claim_deadline": "2026-06-15", "estimated_payout": "approximately $572.36 each", "title": "Ampac Holdings $318,825 BIPA Settlement"}
        page = "Vega v. Ampac Holdings, LLC. Claims Deadline June 15, 2026. You may receive approximately $572.36."
        out = vs.check_record(rec, page)
        self.assertTrue(out["fields"]["date"]["match"])
        self.assertFalse(out["fields"]["amount"]["match"])  # the $318,825 title figure is not on the page
        self.assertIn("title $318,825.00 (rounded in title)", out["fields"]["amount"]["missing"])
        self.assertTrue(out["fields"]["parties"]["match"])

    def test_check_record_not_recorded_fields_are_none_not_false(self):
        out = vs.check_record({"claim_deadline": None, "estimated_payout": None, "title": "Plain Title"}, "anything")
        self.assertIsNone(out["fields"]["date"]["match"])
        self.assertIsNone(out["fields"]["amount"]["match"])

    def test_sample_is_deterministic_and_seeded(self):
        recs = [{"url": f"https://x/{i}"} for i in range(100)]
        self.assertEqual(vs.sample(recs, 10, 20261018), vs.sample(list(reversed(recs)), 10, 20261018))
        self.assertNotEqual(vs.sample(recs, 10, 1), vs.sample(recs, 10, 2))


class TestVerdictRules(unittest.TestCase):
    def test_verdict_categories(self):
        r = wv.verdict_of
        self.assertEqual(r({"identity": "confirmed", "date": "confirmed", "payout": "confirmed"}), "verified")
        self.assertEqual(r({"identity": "confirmed", "date": "not_applicable", "payout": "confirmed"}), "verified")
        self.assertEqual(r({"identity": "confirmed", "date": "confirmed", "payout": "not_found"}), "partially_verified")
        self.assertEqual(r({"identity": "confirmed", "date": "not_applicable", "payout": "partly_confirmed"}), "partially_verified")
        self.assertEqual(r({"identity": "confirmed", "date": "not_found", "payout": "not_found"}), "identity_only")
        self.assertEqual(r({"identity": "confirmed", "date": "not_applicable", "payout": "not_applicable"}), "identity_only")
        self.assertEqual(r({"identity": "confirmed", "date": "contradicted", "payout": "confirmed"}), "contradicted")
        self.assertEqual(r({"identity": "not_found", "date": "confirmed"}), "identity_not_confirmed")

    def test_auto_fields_mapping(self):
        row = {"fields": {"date": {"match": True, "evidence": "Claims Deadline June 15, 2026"},
                          "amount": {"match": False, "matched": ["payout $1.00"], "missing": ["title $5.00 (rounded in title)"]},
                          "parties": {"match": None}}}
        out = wv.auto_fields(row)
        self.assertEqual(out["date"][0], "confirmed")
        self.assertEqual(out["payout"][0], "partly_confirmed")
        self.assertEqual(out["identity"][0], "not_applicable")

    def test_wilson_interval(self):
        low, high = wv.wilson(17, 33)
        self.assertAlmostEqual(low, 0.3522, places=3)
        self.assertAlmostEqual(high, 0.675, places=3)
        self.assertIsNone(wv.wilson(0, 0))
        self.assertEqual(wv.wilson(0, 10)[0], 0.0)


# --------------------------------------------------------------------------- Advottic limitations discrepancy report (private)

class TestDiscrepancyReport(unittest.TestCase):
    def test_years_text_and_formatting(self):
        self.assertEqual(sol.years_text("2 years"), 2.0)
        self.assertEqual(sol.years_text("1 year"), 1.0)
        self.assertIsNone(sol.years_text("Not recorded"))
        self.assertIsNone(sol.years_text("2 years from discovery"))  # never guessed
        self.assertEqual(sol.fmt_years(None), "Not recorded")
        self.assertEqual(sol.fmt_years(1), "1 year")
        self.assertEqual(sol.fmt_years(2.5), "2.5 years")

    def test_rule_scope_from_id(self):
        general = {"id": "legal-review:la-personal_injury-general-review-20261002"}
        special = {"id": "legal-review:la-personal_injury-asbestos-review-20261002"}
        numbered = {"id": "legal-review:ky-limitations-3-20261002"}
        self.assertEqual(sol.rule_scope(general)[0], "ordinary")
        self.assertEqual(sol.rule_scope(special)[0], "special")
        self.assertEqual(sol.rule_scope(numbered)[0], "ordinary")
        self.assertEqual(sol.rule_scope({"id": "other"})[0], "unknown")

    def test_rule_years_units(self):
        self.assertEqual(sol.rule_years({"period": {"amount": 2, "unit": "calendar_years"}}), (2.0, ""))
        self.assertEqual(sol.rule_years({"period": {"amount": 90, "unit": "days"}})[0], None)
        self.assertEqual(sol.rule_years({"period": None})[0], None)

    def rules(self, state, claim, years, ident="general"):
        return {"id": f"legal-review:{state.lower()}-{claim}-{ident}-review-20261002", "rule_kind": "limitations", "state": state, "claim_type": claim,
                "pinpoint": "§ 1", "source_url": "https://x.gov", "scope": "", "period": {"amount": years, "unit": "calendar_years"},
                "review_status": "ok", "rule_version": 1}

    def test_compare_review_statuses(self):
        adv = {("AA", "personal-injury"): {"years": 2, "note": ""}, ("BB", "personal-injury"): {"years": 3, "note": ""},
               ("CC", "personal-injury"): {"years": 2, "note": ""}, ("DD", "wrongful-death"): {"years": 2, "note": ""},
               ("EE", "fraud"): {"years": 3, "note": ""}}
        review = [self.rules("AA", "personal_injury", 2), self.rules("BB", "personal_injury", 2),
                  self.rules("CC", "personal_injury", 2), self.rules("CC", "personal_injury", 3, ident="baseline")]
        out = {(r["state"], r["advottic_claim"]): r["status"] for r in sol.compare_review(adv, review)}
        self.assertEqual(out[("AA", "personal-injury")], "agree")
        self.assertEqual(out[("BB", "personal-injury")], "disagree")
        self.assertEqual(out[("CC", "personal-injury")], "mixed")
        self.assertEqual(out[("DD", "wrongful-death")], "corpus_lacks")
        self.assertNotIn(("EE", "fraud"), out)  # categories with no corpus counterpart are listed under 'lacking', not compared

    def test_special_scope_rules_are_not_compared(self):
        adv = {("AA", "personal-injury"): {"years": 2, "note": ""}}
        review = [self.rules("AA", "personal_injury", 6, ident="asbestos")]
        row = sol.compare_review(adv, review)[0]
        self.assertEqual(row["status"], "not_comparable")
        self.assertEqual(len(row["other_rules"]), 1)

    def test_compare_lp_identical_different_missing(self):
        adv = {("AA", "fraud"): {"years": 2, "note": ""}, ("BB", "fraud"): {"years": 3, "note": ""}, ("CC", "fraud"): {"years": 4, "note": ""}}
        lp = {("AA", "fraud"): {"id": "lp1", "years": 2.0, "period_text": "2 years", "section": "", "check": "", "review_fact": ""},
              ("BB", "fraud"): {"id": "lp2", "years": 2.0, "period_text": "2 years", "section": "", "check": "", "review_fact": ""},
              ("ZZ", "fraud"): {"id": "lp3", "years": 1.0, "period_text": "1 year", "section": "", "check": "", "review_fact": ""}}
        rows, extra = sol.compare_lp(adv, lp)
        status = {(r["state"]): r["status"] for r in rows}
        self.assertEqual(status, {"AA": "identical", "BB": "different", "CC": "missing_in_limitation_periods"})
        self.assertEqual(extra, [("ZZ", "fraud")])


# --------------------------------------------------------------------------- no source names in publishable files (owner decision 2026-10-18)

class TestNoSourceNames(unittest.TestCase):
    """Synthetic rows: the guard must catch every forbidden name and host, in keys and values, at any depth."""

    NAMES = ["SettleSignal", "settle signal", "SETTLE-SIGNAL", "GoodJobsFirst", "Good Jobs First", "goodjobs", "Violation Tracker", "ViolationTracker",
             "violation-tracker", "Advottic", "GJF"]

    def test_every_forbidden_name_is_found_case_insensitively(self):
        for name in self.NAMES:
            self.assertIsNotNone(tp.forbidden_in_text(f"Compiled by {name} for the atlas"), name)
            self.assertIsNotNone(tp.forbidden_in_text(name.upper()), name)
            self.assertIsNotNone(tp.forbidden_in_text(name.lower()), name)

    def test_variants_and_hidden_characters(self):
        self.assertIsNotNone(tp.forbidden_in_text("Settle­Signal"))  # soft hyphen
        self.assertIsNotNone(tp.forbidden_in_text("Settle​Signal"))  # zero-width space
        self.assertIsNotNone(tp.forbidden_in_text("Good_Jobs  First"))  # separators removed
        self.assertIsNotNone(tp.forbidden_in_text("Violation. Tracker"))
        self.assertIsNone(tp.forbidden_in_text("Good faith settlement of a job-related violation; tracker pixel claims"))
        self.assertIsNone(tp.forbidden_in_text("Compiled from public settlement notices and administrator pages"))
        self.assertIsNone(tp.forbidden_in_text(""))

    def test_hosts_and_urls(self):
        for url in ("https://settlesignal.com/settlements/x/", "https://www.SettleSignal.com/", "http://goodjobsfirst.org/terms",
                    "https://violationtracker.goodjobsfirst.org/pages/a", "https://advottic.com/open-data/x.json", "https://sub.advottic.com/"):
            self.assertIsNotNone(tp.forbidden_in_url(url), url)
        for url in ("https://www.ftc.gov/enforcement/refunds/x", "https://example-settlement.com/", "/records/settlements/settlement-abc", ""):
            self.assertIsNone(tp.forbidden_in_url(url), url)
        self.assertEqual(tp.forbidden_host("settlesignal.com"), "settlesignal.com")
        self.assertIsNone(tp.forbidden_host("notsettlesignal.example"))  # a host is matched on whole labels

    def row(self, **extra):
        item = {"id": "notice:x", "title": "Doe v. Acme", "links": [{"label": "Official source", "url": "https://acme.example/"}], "cells": {"a": "b"}}
        item.update(extra)
        return {"dataset": "settlement_notices", "id": "notice:x", "category": "settlement_notices", "state": "", "title": "Doe v. Acme", "source_url": "https://acme.example/",
                "item": item, "detail": {"facts": [["How compiled", "Compiled from public settlement notices and administrator pages"]]}, "text": "Doe v. Acme", "filters": {}}

    def build(self, row):
        return {"dataset": "settlement_notices", "label": "Settlement notices", "listing_block": {}, "summary": {"method": "ok"}, "rows": [row], "built_at": "x", "inputs": []}

    def test_clean_synthetic_build_passes(self):
        self.assertEqual(nsn.scan_build(self.build(self.row())), [])

    def test_first_offending_path_is_reported_for_values_keys_urls_and_nesting(self):
        # value in a nested fact
        row = self.row()
        row["detail"]["facts"].append(["Attribution", "Data: SettleSignal (settlesignal.com), CC-BY 4.0"])
        hits = nsn.scan_build(self.build(row))
        self.assertEqual(hits[0][:2], ("$.rows[0].detail.facts[1][1]", "value"))
        # a link to the compiler's host
        row = self.row()
        row["item"]["links"].append({"label": "Record", "url": "https://settlesignal.com/settlements/x/"})
        self.assertEqual(nsn.scan_build(self.build(row))[0][0], "$.rows[0].item.links[1].url")
        # a dict KEY
        row = self.row(settlesignal_url="https://acme.example/y")
        hits = nsn.scan_build(self.build(row))
        self.assertEqual(hits[0][:2], ("$.rows[0].item.settlesignal_url", "key"))
        # summary, label, dataset and inputs are scanned too
        build = self.build(self.row())
        build["summary"]["license"] = "CC BY 4.0 per the Advottic open-data page"
        self.assertEqual(nsn.scan_build(build)[0][0], "$.summary.license")
        build = self.build(self.row())
        build["inputs"].append({"url": "https://violationtracker.goodjobsfirst.org/pages/x", "path": "x", "sha256": "0"})
        self.assertEqual(nsn.scan_build(build)[0][0], "$.inputs[0].url")
        build = self.build(self.row())
        build["label"] = "Settlements - GJF compilation"
        self.assertEqual(nsn.scan_build(build)[0][0], "$.label")

    def test_main_exit_codes_and_publishable_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            clean = os.path.join(tmp, "settlement_notices.json")
            dirty = os.path.join(tmp, "other_notices.json")
            private = os.path.join(tmp, "private_side_file.json")
            with open(clean, "w", encoding="utf-8") as handle:
                json.dump(self.build(self.row()), handle)
            bad = self.build(self.row())
            bad["dataset"] = "other_notices"
            bad["rows"][0]["detail"]["facts"].append(["Source", "https://goodjobsfirst.org/x"])
            with open(dirty, "w", encoding="utf-8") as handle:
                json.dump(bad, handle)
            with open(private, "w", encoding="utf-8") as handle:
                json.dump({"note": "private file that may name SettleSignal; not a build file", "rows": {"a": "settlesignal.com"}}, handle)
            self.assertIsNone(nsn.check_file(private))  # not build-shaped: never scanned
            self.assertEqual(nsn.check_file(clean)["hits"], [])
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                codes = (nsn.main([clean]), nsn.main([dirty]), nsn.main([clean, dirty, private]))
            self.assertEqual(codes, (0, 1, 1))
            self.assertIn("first offending path: $.rows[0].detail.facts[1][1]", out.getvalue())

    def test_public_wording_removes_the_name_and_keeps_the_evidence(self):
        self.assertEqual(tp.public_wording("the $318,825 fund in the SettleSignal title is not."), "the $318,825 fund in the compiled title is not.")
        self.assertEqual(tp.public_wording("SettleSignal's figure differs"), "the compilation's figure differs")
        self.assertEqual(tp.public_wording("read directly (bytes unchanged under private/acq)"), "read directly (bytes unchanged)")
        self.assertIsNone(tp.public_wording(None))
        self.assertIsNone(tp.forbidden_in_text(tp.public_wording("Deadline matches; the SettleSignal title and the SettleSignal payout text are not on the page")))

    def test_citable_rejects_a_record_whose_only_url_is_on_a_forbidden_host(self):
        retrieved = {"url": "https://settlesignal.com/x", "final_url": "https://settlesignal.com/x", "status": 403, "checked_at": "2026-10-18T00:00:00Z"}
        only_forbidden = record(official_settlement_url="https://settlesignal.com/settlements/x/", official_claim_url=None)
        self.assertEqual(bt.citable(only_forbidden, retrieved), (False, "the only usable URL is on a host that may not be published"))
        self.assertIsNone(bt.cited_url(only_forbidden))
        fallback = record(official_settlement_url="https://advottic.com/x", official_claim_url="https://acmesettlement.com/claim")
        self.assertEqual(bt.cited_url(fallback), "https://acmesettlement.com/claim")  # the claim URL is used when it is the only usable one

    def test_settlement_url_field_decides_the_cited_page_as_vetted(self):
        junk = "No claim form currently available"
        self.assertEqual(bt.cited_url(record(official_settlement_url="https://a.example/", official_claim_url=junk)), "https://a.example/")
        # first-pass semantics: a settlement-URL field that is a bare host (no scheme) is not a retrievable cited page, so the record is
        # classed 'no official source URL' even when the claim URL is a proper URL (the claim URL was never retrieved)
        bare = record(official_settlement_url="www.PHMGDataSettlement.com", official_claim_url="https://www.phmg.example/submit-claim")
        self.assertEqual(bt.citable(bare, None), (False, "no official source URL in the record"))
        self.assertEqual(bt.citable(record(official_settlement_url=None, official_claim_url=junk), None), (False, "no official source URL in the record"))

    def test_text_in_the_claim_url_field_is_never_emitted_as_a_link(self):
        for row in load_build("settlement_notices")["rows"] if load_build("settlement_notices") else []:
            for link in row["item"]["links"]:
                if link["label"] == "Official claim form":
                    self.assertTrue(link["url"].startswith(("http://", "https://")), row["id"])

    def test_parser_drops_compiler_links_and_counts_them(self):
        html = ("<html><body><p>Below are data sources for federal agencies that Violation Tracker covers.</p>"
                "<p>Agency A: <a href='https://violationtracker.goodjobsfirst.org/x'>list</a></p>"
                "<p>Agency B: <a href='https://settlesignal.com/y'>tool</a> and <a href='https://agency-b.gov/z'>orders</a></p>"
                "<p>Jump to state and local sources</p></body></html>")
        entries = vp.parse_federal(html, "https://violationtracker.goodjobsfirst.org/pages/violation-tracker-data-sources")
        self.assertEqual([e["links"] for e in entries], [[], [("orders", "https://agency-b.gov/z")]])
        self.assertEqual([e["dropped_forbidden_links"] for e in entries], [1, 1])


# --------------------------------------------------------------------------- built files (skipped when the build has not run)

def load_build(name):
    path = os.path.join(BUILD, name + ".json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_private(name):
    with open(os.path.join(BUILD, name), encoding="utf-8") as handle:
        return json.load(handle)


@unittest.skipUnless(load_build("settlement_notices"), "build file not present")
class TestBuiltNotices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = load_build("settlement_notices")
        cls.rows = cls.build["rows"]

    def test_shape_and_uniqueness(self):
        ids = [r["id"] for r in self.rows]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(r["dataset"] == r["category"] == "settlement_notices" for r in self.rows))
        self.assertTrue(all(r["id"].startswith("notice:") and r["item"]["id"] == r["id"] == r["detail"]["id"] for r in self.rows))
        self.assertTrue(all(r["source_url"].startswith("https://") for r in self.rows))
        self.assertTrue(all("ordinal" not in r for r in self.rows))
        self.assertEqual(len(self.rows), 831)

    def test_every_row_is_labelled_compiled_with_a_verification_status(self):
        allowed = {"Verified", "Partially verified", "Matter only", "Contradicted", "Not verified"}
        for r in self.rows:
            self.assertIn("Compiled record", r["item"]["badges"])
            self.assertIn(r["item"]["cells"]["verification"], allowed)
            self.assertTrue(r["item"]["compiled"])
            labels = dict(r["detail"]["facts"])
            self.assertIn("Verification", labels)
            self.assertIn("Record layer", labels)
            self.assertEqual(labels["How compiled"], bt.NOTICE_METHOD)
            self.assertRegex(labels["Last checked"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertNotIn("Attribution", labels)
            self.assertNotIn("Publisher feed", labels)

    def test_only_records_with_a_citable_primary_source(self):
        for r in self.rows:
            src = r["item"]["primary_source"]
            self.assertTrue(src["url"].startswith("http"))
            self.assertIn(src["retrieval"], {"retrieved", "access_restricted"})
            self.assertNotIn(src["class"], {"aggregator", "none"})

    def test_court_and_mdl_never_invented(self):
        for r in self.rows:
            urls = [link["url"] for link in r["item"]["links"]]
            self.assertFalse([u for u in urls if u.startswith(("/courts/", "/matters/lens/"))])
            facts = dict(r["detail"]["facts"])
            self.assertTrue(facts["Court"].startswith("Not recorded"))
            self.assertTrue(facts["MDL"].startswith("Not recorded"))

    def test_links_are_exact_keys(self):
        for r in self.rows:
            for link in r["item"]["links"]:
                url = link["url"]
                if url.startswith("/places/"):
                    self.assertRegex(url, r"^/places/[A-Z]{2}$")
                elif url.startswith("/companies/"):
                    self.assertRegex(url, r"^/companies/\d{10}$")
                elif url.startswith("/records/"):
                    self.assertTrue(url.startswith("/records/settlements/settlement-"))
                else:
                    self.assertTrue(url.startswith(("https://", "http://")))
                    self.assertIsNone(tp.forbidden_in_url(url))

    def test_source_url_is_the_cited_official_page(self):
        for r in self.rows:
            ver = r["item"]["verification"]
            expected = ver["source_url"] if ver.get("verdict") != "not_verified" else r["item"]["primary_source"]["url"]
            self.assertEqual(r["source_url"], expected, r["id"])
            self.assertEqual(tp.host_of(r["source_url"]).split(".")[-2:], tp.host_of(r["item"]["primary_source"]["url"]).split(".")[-2:], r["id"])  # same official site
            self.assertIsNone(tp.forbidden_in_url(r["source_url"]))
        for r in self.rows:
            ver = r["item"]["verification"]
            if ver.get("verdict") == "verified":
                self.assertEqual(r["source_url"], ver["source_url"])

    def test_contradicted_rows_say_so(self):
        contradicted = [r for r in self.rows if r["item"]["cells"]["verification"] == "Contradicted"]
        self.assertEqual(len(contradicted), 2)
        for r in contradicted:
            self.assertIn("different value", dict(r["detail"]["facts"])["Figures from"])

    def test_no_advottic_or_compiler_name_in_the_build(self):
        blob = json.dumps(self.rows).lower()
        for name in tp.FORBIDDEN_SUBSTRINGS:
            self.assertNotIn(name, blob, name)
        self.assertEqual(nsn.scan_build(self.build), [])

    def test_summary_is_neutral_and_states_the_method(self):
        summary = self.build["summary"]
        self.assertEqual(summary["method"], bt.NOTICE_METHOD)
        self.assertTrue(summary["compiled"])
        self.assertEqual(summary["last_checked"], summary["check_date"])
        for key in ("source", "publisher", "attribution", "license", "terms_conflict", "publish_hold", "feed_generated", "feed_dateModified"):
            self.assertNotIn(key, summary)
        self.assertNotIn("feed_generated", summary["counts"])
        self.assertEqual(self.build["label"], "Settlement notices (compiled; official source cited)")
        for entry in self.build["inputs"]:
            self.assertIsNone(tp.forbidden_in_text(json.dumps(entry)))

    def test_state_field_only_for_a_single_published_state(self):
        for r in self.rows:
            states = r["filters"]["state"]
            self.assertEqual(r["state"], states[0] if len(states) == 1 and states[0] != "nationwide" else "")

    def test_verdict_rows_agree_with_the_published_set(self):
        with open(os.path.join(ROOT, "private", "acq", "third_party_data", "verification", "verdicts.json"), encoding="utf-8") as handle:
            verdicts = json.load(handle)
        built = {r["id"] for r in self.rows}
        for v in verdicts["rows"]:
            nid = "notice:" + bt.slug_of(v["settlesignal_url"])
            if v["verdict"] == "not_in_published_set":
                self.assertNotIn(nid, built, v["title"])
            else:
                self.assertIn(nid, built, v["title"])

    def test_verification_evidence_is_carried_exactly(self):
        with open(os.path.join(ROOT, "private", "acq", "third_party_data", "verification", "verdicts.json"), encoding="utf-8") as handle:
            verdicts = json.load(handle)
        rows = {r["id"]: r for r in self.rows}
        for v in verdicts["rows"]:
            if v["verdict"] == "not_in_published_set":
                continue
            ver = rows["notice:" + bt.slug_of(v["settlesignal_url"])]["item"]["verification"]
            self.assertEqual(ver["verdict"], v["verdict"])
            self.assertEqual(ver["fields"], v["fields"])  # statuses and evidence untouched
            self.assertEqual(ver["note"], tp.public_wording(v.get("note")))
            self.assertNotIn("settlesignal_url", ver)

    def test_verification_rate_arithmetic(self):
        ver = self.build["summary"]["verification"]
        counts = ver["verdict_counts"]
        self.assertEqual(sum(counts.values()), ver["in_published_set"])
        self.assertAlmostEqual(ver["strict_rate"]["rate"], counts.get("verified", 0) / ver["in_published_set"], places=4)
        self.assertGreaterEqual(ver["in_published_set"], 30)
        built = {}
        for r in self.rows:
            key = r["filters"]["verification"][0]
            if key != "not_verified":
                built[key] = built.get(key, 0) + 1
        self.assertEqual(built, counts)

    def test_deadline_years_are_counted_over_built_rows(self):
        counts = self.build["summary"]["counts"]
        self.assertEqual(sum(counts["deadline_years"].values()) + counts["deadline_state_included"].get("unknown", 0), len(self.rows))

    def test_provenance_stays_private_and_covers_every_row(self):
        prov = load_private("notice_provenance_private.json")
        self.assertIn("PRIVATE", prov)
        self.assertEqual(set(prov["rows"]), {r["id"] for r in self.rows})
        self.assertTrue(all(p["publisher_url"].startswith("https://") for p in prov["rows"].values()))

    def test_excluded_records_are_listed_with_reasons(self):
        excluded = load_private("third_party_settlesignal_excluded.json")
        self.assertEqual(excluded["count"], 66)
        self.assertEqual(len(excluded["rows"]) + len(self.rows), self.build["summary"]["records_considered"])
        self.assertTrue(all(e["reason"] for e in excluded["rows"]))


@unittest.skipUnless(load_build("enforcement_data_sources_catalog"), "build file not present")
class TestBuiltCatalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = load_build("enforcement_data_sources_catalog")
        cls.rows = cls.build["rows"]

    def test_shape_and_no_penalty_records(self):
        ids = [r["id"] for r in self.rows]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(i.startswith("src:") for i in ids))
        self.assertTrue(self.build["summary"]["no_penalty_records"])
        for r in self.rows:
            self.assertTrue(r["source_url"].startswith(("https://", "http://")))
            blob = json.dumps(r["item"]["entry"]).lower()
            self.assertNotIn("penalty amount", blob)

    def test_every_row_cites_the_agencys_own_url_and_none_is_invented(self):
        for r in self.rows:
            urls = r["item"]["entry"]["urls"]
            self.assertTrue(urls, r["id"])
            self.assertEqual(r["source_url"], urls[0]["url"])
            self.assertEqual(dict(r["detail"]["facts"])["Official URL(s)"], " ; ".join(u["url"] for u in urls))
            for u in urls:
                self.assertIsNone(tp.forbidden_in_url(u["url"]))
            self.assertNotIn("listed_line", r["item"]["entry"])
            self.assertNotIn("listed_by", r["item"])

    def test_states_link_only_exact_usps(self):
        for r in self.rows:
            for link in r["item"]["links"]:
                if link["url"].startswith("/places/"):
                    self.assertRegex(link["url"], r"^/places/[A-Z]{2}$")
                else:
                    self.assertIsNone(tp.forbidden_in_url(link["url"]))
                    self.assertTrue(link["label"].startswith("Official source"))

    def test_spot_checks_cover_at_least_fifteen_entries(self):
        spot = self.build["summary"]["spot_checks"]
        self.assertGreaterEqual(spot["sampled"], 15)
        self.assertEqual(spot["entry_text_matches_listing"], spot["sampled"])
        self.assertEqual(sum(spot["result_counts"].values()), spot["sampled"])
        self.assertEqual(spot["sampled"] + spot["sampled_not_in_published_set"], spot["sampled_total"])
        carried = [r for r in self.rows if r["item"]["spot_check"]]
        self.assertEqual(len(carried), spot["sampled"])

    def test_counts_add_up(self):
        counts = self.build["summary"]["counts"]
        self.assertEqual(counts["entries"], len(self.rows))
        self.assertEqual(counts["federal"] + counts["state_local"], counts["entries"])
        self.assertEqual(counts["entries"] + counts["excluded"], counts["listed_entries"])
        self.assertEqual(counts["excluded_no_url"] + counts["excluded_only_url_on_forbidden_host"], counts["excluded"])
        self.assertEqual(counts["listed_federal"] + counts["listed_state_local"], counts["listed_entries"])

    def test_summary_is_neutral_and_states_the_method(self):
        summary = self.build["summary"]
        self.assertEqual(summary["method"], bt.CATALOG_METHOD)
        for key in ("listed_by", "list_urls", "third_party_list", "terms", "aggregate_figures"):
            self.assertNotIn(key, summary)
        self.assertEqual(nsn.scan_build(self.build), [])
        for entry in self.build["inputs"]:
            self.assertIsNone(tp.forbidden_in_text(json.dumps(entry)))

    def test_excluded_entries_are_listed_privately_with_reasons(self):
        excluded = load_private("enforcement_data_sources_catalog_excluded.json")
        counts = self.build["summary"]["counts"]
        self.assertEqual(excluded["count"], counts["excluded"])
        built = {r["id"] for r in self.rows}
        self.assertTrue(all(e["id"] not in built and e["reason"] for e in excluded["rows"]))
        prov = load_private("catalog_provenance_private.json")
        self.assertIn("PRIVATE", prov)
        self.assertEqual(set(prov["rows"]), built | {e["id"] for e in excluded["rows"]})


class TestPublishableFilesOnly(unittest.TestCase):
    def test_only_the_two_expected_build_shaped_files_sit_at_the_top_level(self):
        import glob
        found = set()
        for path in glob.glob(os.path.join(BUILD, "*.json")):
            with open(path, encoding="utf-8") as handle:
                if nsn.is_build_file(json.load(handle)):
                    found.add(os.path.splitext(os.path.basename(path))[0])
        if found:
            self.assertEqual(found, set(nsn.EXPECTED))


@unittest.skipUnless(os.path.exists(os.path.join(BUILD, "sol_discrepancies.json")), "report not present")
class TestPrivateDiscrepancyReport(unittest.TestCase):
    def test_report_is_private_and_not_a_dataset(self):
        with open(os.path.join(BUILD, "sol_discrepancies.json"), encoding="utf-8") as handle:
            report = json.load(handle)
        self.assertIn("PRIVATE", report["hold"])
        self.assertNotIn("dataset", report)
        self.assertNotIn("rows", report)
        self.assertEqual(report["advottic_cells"], 459)
        self.assertEqual(set(report["mapping"][0]), {"advottic_claim", "advottic_label", "limitation_periods_claim", "statutory_limitations_review_claim", "note"})
        self.assertFalse(os.path.exists(os.path.join(BUILD, "advottic_statute_of_limitations.json")))

    def test_the_review_files_are_not_publishable_build_files(self):
        for name in ("sol_discrepancies.json", "advottic_templates_tools_review.json"):
            path = os.path.join(BUILD, name)
            if os.path.exists(path):
                self.assertFalse(nsn.is_build_file(load_private(name)), name)


if __name__ == "__main__":
    unittest.main()
