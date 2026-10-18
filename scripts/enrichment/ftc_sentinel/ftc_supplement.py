"""Parse the independent Tavily readings of Do Not Call ranking tables (private/acq/ftc_sentinel/verify/read*.txt).

Tavily returns a ranking table column by column: first the rank and state names in order, then the numbers in pairs
(per-100K, count), sometimes in two overlapping runs separated by '[...]'. A block is accepted only when its names form
an unbroken rank chain, and each pair is then matched to its name by position. The rows are *candidates*: ftc_dnc only
adopts one when the state page count and the implied-population check corroborate it.
"""
import os
import re

from ftc_parse import state_usps, to_int

LIGATURES = {"Ɵ": "ti", "Ʃ": "tt", "ƞ": "ft"}
_NUM = re.compile(r"^\d[\d,]*$")


def clean(text):
    for bad, good in LIGATURES.items():
        text = text.replace(bad, good)
    return text


def _name_at(tokens, i):
    """(usps, next_index) when tokens[i:] starts with a state name (1-3 words), preferring the longest."""
    for n in (3, 2, 1):
        if i + n <= len(tokens):
            usps = state_usps(" ".join(tokens[i:i + n]))
            if usps and all(t[:1].isalpha() for t in tokens[i:i + n]):
                return usps, i + n
    return None, i


def _pairs(run):
    vals = [to_int(t) for t in run]
    return [(vals[k], vals[k + 1]) for k in range(0, len(vals) - 1, 2) if vals[k] is not None and vals[k + 1] is not None]


def parse_rank_blocks(text):
    """[{'kind': 'registrations'|'complaints'|None, 'rows': [{rank, usps, per100k, count}]}] for every complete name chain."""
    tokens = clean(text).split()
    blocks = []
    i = 0
    while i < len(tokens):
        chain, j = [], i
        while j < len(tokens) and re.fullmatch(r"\d{1,2}", tokens[j]):
            usps, nxt = _name_at(tokens, j + 1)
            if not usps or (chain and int(tokens[j]) != chain[-1][0] + 1):
                break
            chain.append((int(tokens[j]), usps))
            j = nxt
        if len(chain) < 5:
            i += 1
            continue
        runs, k = [], j
        while k < len(tokens) and _NUM.match(tokens[k]):
            k += 1
        runs.append(tokens[j:k])
        if k < len(tokens) and tokens[k] == "[...]":
            m = k + 1
            while m < len(tokens) and _NUM.match(tokens[m]):
                m += 1
            if m > k + 1:
                runs.append(tokens[k + 1:m])
        pairs = _pairs(runs[0])
        if len(runs) > 1:
            second = _pairs(runs[1])
            if second and second[0] in pairs:
                pairs = pairs[:pairs.index(second[0])] + second  # the continuation repeats the last pairs it overlaps
        head = " ".join(tokens[max(0, i - 40):i])
        last_reg, last_cmp = head.rfind("Registrations"), head.rfind("Complaints")
        kind = None if max(last_reg, last_cmp) < 0 else "registrations" if last_reg > last_cmp else "complaints"
        rows = [{"rank": r, "usps": u, "per100k": p, "count": c} for (r, u), (p, c) in zip(chain, pairs)]
        blocks.append({"kind": kind, "rows": rows, "names": len(chain)})
        i = k
    return blocks


def load_supplements(paths):
    """{kind: {usps: row}} from the given read files; each row carries source=<file name>. Duplicates keep the first."""
    out = {"registrations": {}, "complaints": {}}
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            body = handle.read().split("RAW_CONTENT\n", 1)[-1]
        for block in parse_rank_blocks(body):
            if block["kind"] is None:
                continue
            for row in block["rows"]:
                out[block["kind"]].setdefault(row["usps"], {**row, "source": os.path.basename(path)})
    return out
