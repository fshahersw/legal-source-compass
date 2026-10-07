"""Fetcher with an in-memory resume index (the base class rereads receipts.jsonl on every get)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))
from provenance_fetch import Fetcher  # noqa: E402


class FastFetcher(Fetcher):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self._idx = {}
        for r in self.receipts():
            if r.get('ok') and r.get('retrieval_method') == 'direct' and r.get('http_method') != 'POST':
                self._idx.setdefault(r['url'], r)

    def captured(self, url):
        return self._idx.get(url)

    def _append(self, receipt):
        super()._append(receipt)
        if receipt.get('ok') and receipt.get('retrieval_method') == 'direct' and receipt.get('http_method') != 'POST':
            self._idx.setdefault(receipt['url'], receipt)
