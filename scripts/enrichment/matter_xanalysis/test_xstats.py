"""Unit tests for the cross-analysis statistics helpers (python3 -B -m unittest test_xstats, run from this directory)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import xstats  # noqa: E402


class Ranks(unittest.TestCase):
    def test_ties_get_average_ranks(self):
        self.assertEqual(xstats.ranks([10, 20, 20, 5]), [2.0, 3.5, 3.5, 1.0])

    def test_pearson_of_ranks_is_spearman(self):
        x = [1, 2, 3, 4, 5]
        self.assertAlmostEqual(xstats.pearson(xstats.ranks(x), xstats.ranks([2, 4, 6, 8, 100])), 1.0)
        self.assertAlmostEqual(xstats.pearson(xstats.ranks(x), xstats.ranks([5, 4, 3, 2, 1])), -1.0)
        self.assertIsNone(xstats.pearson([1, 1, 1], [1, 2, 3]))


class Multiplicity(unittest.TestCase):
    def test_bh_matches_hand_computation(self):
        # sorted p: 0.01, 0.02, 0.03, 0.5 -> raw p*m/k: 0.04, 0.04, 0.04, 0.5 (monotone from the top)
        self.assertEqual([round(x, 6) for x in xstats.bh_adjust([0.03, 0.01, 0.5, 0.02])], [0.04, 0.04, 0.5, 0.04])

    def test_bh_never_exceeds_one_and_keeps_order(self):
        adj = xstats.bh_adjust([0.9, 0.95, 0.99])
        self.assertTrue(all(a <= 1.0 for a in adj))
        self.assertEqual(sorted(adj), adj)

    def test_permutation_p_is_small_for_a_perfect_rank_match_and_large_for_noise(self):
        x = list(range(30))
        self.assertLess(xstats.permutation_p(x, x, 1.0, n_perm=999, seed=1), 0.01)
        noise = [7, 3, 9, 1, 5, 2, 8, 6, 4, 0]
        rho = xstats.pearson(xstats.ranks(list(range(10))), xstats.ranks(noise))
        self.assertGreater(xstats.permutation_p(list(range(10)), noise, rho, n_perm=999, seed=1), 0.05)


if __name__ == "__main__":
    unittest.main()
