"""Save a read-only corpus lookup (transcribed from a SELECT run through the read-only SQL tool) after checking its md5.

Usage: python3 -I -B save_lookup.py <name> <txt file> <expected md5> <query text file>
The txt file holds the exact string_agg output; the query's own md5(...) of that string must equal <expected md5>, so a
transcription error is caught. Writes private/build/state_analysis/lookups/<name>.json with the query, md5 and parsed values.
"""
import hashlib
import json
import os
import sys
import time

import sa_http


def main(name: str, txt: str, md5: str, query_file: str) -> None:
    text = open(txt).read().strip()
    got = hashlib.md5(text.encode()).hexdigest()
    if got != md5:
        raise SystemExit(f"md5 mismatch: {got} != {md5}")
    values = {}
    for part in text.split(","):
        k, v = part.split(":")
        values[k] = int(v)
    out = os.path.join(sa_http.ROOT, "private", "build", "state_analysis", "lookups", name + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as h:
        json.dump({"name": name, "query": open(query_file).read().strip(), "md5_of_string_agg": md5, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "count": len(values), "values": values}, h, indent=1, sort_keys=True)
    print(out, len(values), sum(values.values()))


if __name__ == "__main__":
    main(*sys.argv[1:])
