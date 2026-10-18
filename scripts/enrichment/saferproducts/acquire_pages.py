"""Fetch the public SaferProducts.gov FAQ/terms pages (HTML, bytes unchanged) for documentation and terms review.

  python3 -I -B scripts/enrichment/saferproducts/acquire_pages.py

Appends to private/acq/saferproducts/_manifest.jsonl through acquire.fetch. >= 0.7 s between requests.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acquire  # noqa: E402

BASE = "https://www.saferproducts.gov/FAQs/FrequentlyAskedQuestions"


def main():
    acquire.probe("https://www.saferproducts.gov/robots.txt")
    for number in ["", "2", "4", "5", "6", "7", "8", "9", "10", "11", "12"]:
        time.sleep(0.7)
        try:
            acquire.fetch(BASE + number, "pages/faq%s.html" % (number or "1"), timeout=120)
        except Exception as error:  # a missing FAQ number is not fatal
            print("skip", number, error, flush=True)


if __name__ == "__main__":
    main()
