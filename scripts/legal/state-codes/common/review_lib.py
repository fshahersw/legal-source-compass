"""Shared helpers for the pre-flip review of a landed state code (sampling, normalisation, comparison).

The review compares landed section rows with the publisher's *live* page and records a verdict per
sample. Nothing here changes the corpus; the caller decides whether to call the review RPC.
"""
import difflib
import random
import re
import unicodedata

QUOTES = {'\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2212': '-',
          '\u00a0': ' ', '\u2009': ' ', '\u200b': ''}


def norm(text):
    text = unicodedata.normalize('NFKC', text or '')
    text = ''.join(QUOTES.get(c, c) for c in text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip().lower()


def words(text):
    return re.findall(r"[a-z0-9]+(?:[.'/-][a-z0-9]+)*", norm(text))


def sample_rows(rows, n=20, seed='state-code-review-2026-10-06', key=lambda r: r):
    rng = random.Random(seed)
    pool = list(rows)
    return rng.sample(pool, min(n, len(pool)))


def compare(landed_text, live_text):
    """Return (ratio, verdict) of word sequences; live_text should be the live section region."""
    a, b = words(landed_text), words(live_text)
    if not a and not b:
        return 1.0, 'match'
    ratio = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
    return ratio, ('match' if ratio >= 0.985 else 'mismatch')
