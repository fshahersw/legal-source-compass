import hashlib
import unittest

from ok_parse import (
    CURRENCY_STATEMENT,
    parse_title_index,
    parse_title_text,
    split_history,
)


def parse_fixture(text, title="12", heading="Civil Procedure"):
    return parse_title_text(
        text,
        title=title,
        title_heading=heading,
        source_url=f"https://example.invalid/os{title}.rtf",
        receipt_sha256="a" * 64,
        member=f"os{title}.rtf",
        derivative_sha256=hashlib.sha256(text.encode()).hexdigest(),
    )


class OklahomaParserTests(unittest.TestCase):
    def test_inventory_and_body_are_separate(self):
        text = (
            "§12-95.  Limitation of other actions.\t10\n\n"
            "§12-95.  Limitation of other actions.\n"
            "A.  Other civil actions shall be brought as provided.\n"
            "Added by Laws 2025, c. 1, § 1, eff. Nov. 1, 2025.\n"
        )
        inventory, rows = parse_fixture(text)
        self.assertEqual(1, len(inventory))
        self.assertEqual(1, len(rows))
        self.assertEqual("12-95", rows[0]["native_id"])
        self.assertEqual("A.  Other civil actions shall be brought as provided.", rows[0]["text"])
        self.assertEqual(
            "Added by Laws 2025, c. 1, § 1, eff. Nov. 1, 2025.",
            rows[0]["history"],
        )
        self.assertEqual(CURRENCY_STATEMENT, rows[0]["currency"]["statement"])

    def test_span_is_exact_unicode_code_point_slice(self):
        text = (
            "§12-1.  Heading.\t1\n\n"
            "§12-1.  Heading.\n"
            "Body with “smart quotes”.\n"
            "R.L. 1910, § 1.\n"
        )
        _inventory, rows = parse_fixture(text)
        span = rows[0]["source"]["span"]
        self.assertEqual(rows[0]["text"], text[span["start"] : span["end"]])
        self.assertEqual(len(rows[0]["text"]), span["end"] - span["start"])

    def test_status_placeholder_is_retained(self):
        text = (
            "§12-2.  Repealed by Laws 1984, c. 1, § 2.\t1\n\n"
            "§12-2.  Repealed by Laws 1984, c. 1, § 2.\n"
        )
        _inventory, rows = parse_fixture(text)
        self.assertEqual("Repealed", rows[0]["status_label"])
        self.assertEqual("", rows[0]["text"])
        self.assertIsNone(rows[0]["source"]["span"])

    def test_duplicate_occurrences_get_unique_path(self):
        text = (
            "§12-3.  First.\t1\n"
            "§12-3.  First.\t2\n\n"
            "§12-3.  First.\nOne.\n"
            "§12-3.  First.\nTwo.\n"
        )
        inventory, rows = parse_fixture(text)
        self.assertEqual("12-3:occurrence:2", inventory[1]["native_id"])
        self.assertEqual("12-3:occurrence:2", rows[1]["native_id"])
        self.assertEqual("derived_occurrence", rows[1]["identity_kind"])
        self.assertEqual("12-3:occurrence:2", rows[1]["citation_path"][-1]["number"])

    def test_ethics_rule_alias_normalizes_to_same_key(self):
        text = (
            "Rule 2.45.  Calculation of Travel Expenditures.\t28\n\n"
            "Rule 2.45.  Calculation of Travel Expenditures.\nFirst.\n"
            "§74E-Rule 2.45.  Calculation of Travel Expenditures.\nSecond.\n"
        )
        inventory, rows = parse_fixture(text, title="74E", heading="Ethics Rules")
        self.assertEqual("74E-Rule 2.45", inventory[0]["native_id"])
        self.assertEqual("74E-Rule 2.45", rows[0]["native_id"])
        self.assertEqual("74E-Rule 2.45:occurrence:2", rows[1]["native_id"])

    def test_foreign_or_malformed_marker_gets_title_bound_composite(self):
        text = (
            "§21-1111.  Foreign marker in this title.\t1\n\n"
            "§21-1111.  Foreign marker in this title.\nBody.\n"
        )
        inventory, rows = parse_fixture(text, title="2", heading="Agriculture")
        self.assertRegex(inventory[0]["native_id"], r"^2:marker:[0-9a-f]{16}$")
        self.assertEqual(inventory[0]["native_id"], rows[0]["native_id"])
        self.assertEqual("composite_source_title_marker", rows[0]["identity_kind"])
        self.assertEqual("§21-1111", rows[0]["citation"])

    def test_history_split_is_conservative(self):
        body, history = split_history(
            "A.  Substantive text.\n"
            "Added by Laws 2020, c. 1, § 1.\n"
            "Amended by Laws 2021, c. 2, § 2."
        )
        self.assertEqual("A.  Substantive text.", body)
        self.assertEqual(
            "Added by Laws 2020, c. 1, § 1.\nAmended by Laws 2021, c. 2, § 2.",
            history,
        )
        body, history = split_history("Text ending with an ordinary sentence.")
        self.assertEqual("Text ending with an ordinary sentence.", body)
        self.assertIsNone(history)

    def test_title_index_deduplicates_publisher_repeat(self):
        page = """
        <p>
        <a href="/OK_Statutes/CompleteTitles/os38.pdf"><b>Title 38.</b></a> Jurors (69KB)<br>
        <a href="/OK_Statutes/CompleteTitles/os38.pdf"><b>Title 38.</b></a> Jurors (69KB)<br>
        <a href="/OK_Statutes/CompleteTitles/os85A.pdf"><b>Title 85A.</b></a>
          Administrative Workers' Compensation System (574KB)<br>
        </p>
        """
        titles, duplicates = parse_title_index(page)
        self.assertEqual(["38", "85A"], [row["title"] for row in titles])
        self.assertEqual(1, len(duplicates))
        self.assertEqual("Jurors (69KB)", titles[0]["heading"])
        self.assertIn("Administrative Workers", titles[1]["heading"])


if __name__ == "__main__":
    unittest.main()
