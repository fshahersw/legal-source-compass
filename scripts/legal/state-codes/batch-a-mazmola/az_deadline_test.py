import pathlib
import sys
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from az_deadline import HardDeadline, run_with_deadline  # noqa: E402


class Deadline(unittest.TestCase):
    def test_a_call_that_does_not_finish_is_ended_at_the_deadline(self):
        started = time.monotonic()
        with self.assertRaises(HardDeadline):
            run_with_deadline(0.3, time.sleep, 30)
        self.assertLess(time.monotonic() - started, 3)

    def test_a_fetcher_style_except_exception_cannot_swallow_it(self):
        def retrying():
            for _ in range(5):
                try:
                    time.sleep(30)
                except Exception:
                    continue
        with self.assertRaises(HardDeadline):
            run_with_deadline(0.3, retrying)

    def test_a_call_that_finishes_returns_its_value_and_clears_the_timer(self):
        self.assertEqual(run_with_deadline(5, lambda: 7), 7)
        time.sleep(0.2)


if __name__ == '__main__':
    unittest.main()
