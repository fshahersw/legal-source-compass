"""Unit tests for the court-name resolver and address parser (python3 -B -m unittest test_court_locations, run from this directory)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import locations_lib as ll  # noqa: E402


class Labels(unittest.TestCase):
    def test_label_to_short_names(self):
        self.assertEqual(ll.label_short_names("Alabama Middle"), ["M.D. Alabama"])
        self.assertEqual(ll.label_short_names("Arkansas Eastern & Western"), ["E.D. Arkansas", "W.D. Arkansas"])
        self.assertEqual(ll.label_short_names("Idaho"), ["D. Idaho", "Idaho"])


class Addresses(unittest.TestCase):
    def parse(self, page):
        return ll.find_addresses(ll.page_lines(page))

    def test_multi_line_block_with_suite_and_building(self):
        a = self.parse("<p>Thurgood Marshall Federal Judiciary Building<br>One Columbus Circle, NE<br>Room G-255, North Lobby<br>Washington, DC 20544-0005</p>")
        self.assertEqual(len(a), 1)
        self.assertEqual((a[0]["name"], a[0]["street"], a[0]["street2"], a[0]["city"], a[0]["state"], a[0]["zip"]),
                         ("Thurgood Marshall Federal Judiciary Building", "One Columbus Circle, NE", "Room G-255, North Lobby", "Washington", "DC", "20544"))

    def test_city_state_zip_split_across_elements(self):
        a = self.parse("<div>280 South 1st Street</div><span>San Jose,</span><span>CA</span><span>95113</span>")
        self.assertEqual((a[0]["street"], a[0]["city"], a[0]["state"], a[0]["zip"]), ("280 South 1st Street", "San Jose", "CA", "95113"))

    def test_one_line_named_and_labelled(self):
        a = self.parse("<td>Address</td><td>Thurgood Marshall U.S. Courthouse, 40 Foley Square, New York, NY 10007</td>")
        self.assertEqual((a[0]["name"], a[0]["street"], a[0]["city"]), ("Thurgood Marshall U.S. Courthouse", "40 Foley Square", "New York"))
        b = self.parse("<p>Frank M. Johnson Jr U.S. Courthouse Complex</p><p>Address: One Church Street, Montgomery, AL 36104</p>")
        self.assertEqual((b[0]["name"], b[0]["street"], b[0]["zip"]), ("Frank M. Johnson Jr U.S. Courthouse Complex", "One Church Street", "36104"))

    def test_map_links_and_notes_are_not_part_of_the_address(self):
        a = self.parse("<p>Closed Saturdays, Sundays, and federal holidays<br>701 Avenue A ( map )<br>Opelika, AL 36801</p>")
        self.assertEqual((a[0]["name"], a[0]["street"]), (None, "701 Avenue A"))

    def test_city_and_zip_without_a_street_is_not_an_address(self):
        self.assertEqual(self.parse("<p>Jurors report to</p><p>Boston, MA 02210</p>"), [])

    def test_keep_rules(self):
        base = {"name": None, "street": "1 Main St", "street2": None, "city": "Boston", "state": "MA", "zip": "02210"}
        self.assertIsNone(ll.keep(base, {"MA"}))
        self.assertEqual(ll.keep(base, {"NH"}), "outside the court's states")
        self.assertIsNone(ll.keep({**base, "name": "Thurgood Marshall U.S. Courthouse"}, None))
        self.assertIsNotNone(ll.keep({**base, "name": "U.S. Probation Office"}, None))
        self.assertIsNotNone(ll.keep({**base, "name": "PACER Service Center"}, None))


if __name__ == "__main__":
    unittest.main()
