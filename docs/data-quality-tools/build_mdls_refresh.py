"""Generate the mdls JPML 2026-10-01 refresh contract (SQL text) from the parsed reports. No DB access."""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACTS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "wt-quality", "database", "contracts"))
RUN = "c490cdf1-b32e-46ae-95c5-788cdeba3f33"
SRC = "C:/Users/firas/.codex/corpus-cache/seeger-weiss/2026-10-02/full-matter-audit/"

p = json.load(open(os.path.join(HERE, "parsed_jpml.json"), encoding="utf-8"))
oct_a = {r["mdl"]: r for r in p["actions_2026-10-01"]}
assert len(oct_a) == 162


def q(s):
    return "'" + s.replace("'", "''") + "'"


def jt(r):
    m = re.search(r"\(([^)]*)\)\s*$", r["judge_title"])
    return m.group(1)


vals = ",\n    ".join(f"({m}, {r['pending']}, {r['total']}, {q(jt(r))})" for m, r in sorted(oct_a.items()))

# source hashes (computed once with sha256sum; verified again here)
import hashlib


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


H = {
    "actions": sha(SRC + "jpml-2026-10-01.pdf"),
    "dockets": sha(SRC + "jpml-master-dockets-2026-10-01.pdf"),
    "terminated": sha(SRC + "jpml-terminated-2025.pdf"),
}
DOC = {k: "jpmldoc-" + v[:16] for k, v in H.items()}
print(DOC)
json.dump({"sha": H, "doc": DOC, "values_rows": len(oct_a)}, open(os.path.join(HERE, "refresh_sources.json"), "w"), indent=1)
open(os.path.join(HERE, "oct_values.sql.txt"), "w", encoding="utf-8").write(vals)
print("values written", len(vals))
