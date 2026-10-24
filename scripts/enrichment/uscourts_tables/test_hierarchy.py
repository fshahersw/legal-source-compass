"""Offline tests for hierarchy.py: row hierarchies read from a table's own printed sums (synthetic rows shaped like B-1A, C-4, BAP-2)."""
import unittest

import hierarchy as H
import normalize as N


def row(label, values, indent=0, section=False):
    if section:
        return {"label": label, "indent": indent, "section": True, "values": None, "flags": None}
    return {"label": label, "indent": indent, "section": False, "values": [None if v == "-" else v for v in values],
            "flags": ["dash" if v == "-" else None for v in values]}


def b1a_rows():
    """Flat rows (no indentation): Total = Criminal + Civil; Civil = U.S. + Private; U.S. = Plaintiff + Defendant; each block
    repeats "Civil Rights" (= Employment + Other Civil Rights) with different figures."""
    return [
        row("Total", [60, 66, 70]),
        row("Total Criminal Appeals", [10, 11, 12]),
        row("Total Civil Appeals", [50, 55, 58]),
        row("U.S. Appeals", [20, 22, 24]),
        row("U.S. Plaintiff", [8, 9, 10]),
        row("Tort Actions", [3, 3, 3]),
        row("Civil Rights", [5, 6, 7]),
        row("Employment", [2, 2, 3]),
        row("Other Civil Rights", [3, 4, 4]),
        row("U.S. Defendant", [12, 13, 14]),
        row("Tort Actions", [4, 4, 4]),
        row("Civil Rights", [8, 9, 10]),
        row("Employment", [5, 5, 5]),
        row("Other Civil Rights", [3, 4, 5]),
        row("Total Private Appeals", [30, 33, 34]),
        row("Antitrust", [1, 1, 1]),
        row("Civil Rights", [29, 32, 33]),
        row("Employment", [10, 11, 12]),
        row("Other Civil Rights", [19, 21, 21]),
    ]


class ResolveTests(unittest.TestCase):
    def test_blocks_are_found_from_the_sums(self):
        rows = b1a_rows()
        parents = H.resolve(rows, [0, 1, 2])
        paths = H.paths(rows, parents)
        joined = ["/".join(paths[i]) for i in range(len(rows))]
        self.assertIn("Total/Total Criminal Appeals", joined)
        self.assertIn("Total/Total Civil Appeals/U.S. Appeals/U.S. Plaintiff/Civil Rights/Employment", joined)
        self.assertIn("Total/Total Civil Appeals/U.S. Appeals/U.S. Defendant/Civil Rights/Employment", joined)
        self.assertIn("Total/Total Civil Appeals/Total Private Appeals/Civil Rights/Other Civil Rights", joined)
        self.assertEqual(len(set(joined)), len(joined))  # every row has its own path

    def test_too_few_columns_or_no_tree_is_not_resolved(self):
        rows = b1a_rows()
        self.assertIsNone(H.resolve(rows, [0, 1]))  # fewer than three summed columns
        flat = [row("A", [1, 2, 3]), row("B", [4, 5, 6]), row("C", [7, 8, 9])]
        self.assertIsNone(H.resolve(flat, [0, 1, 2]))  # nothing adds up: no hierarchy is invented

    def test_a_match_must_hold_in_every_column(self):
        rows = [row("Total", [5, 6, 7]), row("A", [2, 3, 3]), row("B", [3, 3, 3]), row("C", [1, 1, 1])]
        # A + B = 5, 6, 6: the third column breaks the match, so Total is not their parent
        self.assertIsNone(H.resolve(rows, [0, 1, 2]))

    def test_dashes_are_no_cases_and_headings_carry_the_path(self):
        rows = [
            row("Total Cases", [10, 10, 10], indent=3),
            row("United States Cases", [4, 4, 4]),
            row("Contract Actions", None, section=True),
            row("Franchise", [1, 1, 1], indent=3),
            row("Other Contracts", [3, 3, 3], indent=3),
            row("Federal Question", [6, 6, 6]),
            row("Contract Actions", None, section=True),
            row("Franchise", ["-", "-", "-"], indent=3),
            row("Other Contracts", [6, 6, 6], indent=3),
        ]
        parents = H.resolve(rows, [0, 1, 2])
        paths = H.paths(rows, parents)
        self.assertEqual(paths[3], ["Total Cases", "United States Cases", "Contract Actions", "Franchise"])
        self.assertEqual(paths[7], ["Total Cases", "Federal Question", "Contract Actions", "Franchise"])
        self.assertNotIn(2, paths)  # a section heading is not a data row


class NormalizeBySumsTests(unittest.TestCase):
    def columns(self):
        return [{"index": i, "key": k, "path": [k.title()], "label": k.title(), "fmt": "#,##0", "marks": [], "prior": False}
                for i, k in enumerate(["pending", "filed", "terminated"])]

    def test_repeated_labels_left_in_one_block_are_gaps(self):
        rows = [
            row("Total Cases", [10, 10, 10]),
            row("Actions Under Statutes", None, section=True),
            row("Consumer Credit", [2, 2, 2], indent=3),
            row("Antitrust", [3, 3, 3], indent=3),
            row("Consumer Credit", [1, 1, 1], indent=3),
            row("Antitrust", [4, 4, 4], indent=3),
        ]
        out = N.rows_by_sums(rows, self.columns())
        self.assertIsNotNone(out)
        kept, ambiguous = out
        self.assertEqual([r["label"] for r in kept], ["Total Cases"])
        self.assertEqual(sorted(a["label"] for a in ambiguous), ["Antitrust", "Antitrust", "Consumer Credit", "Consumer Credit"])


if __name__ == "__main__":
    unittest.main()
