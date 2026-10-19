"""Read-only extract of the recall records the recall_patterns builder analyses.

Reads the published openFDA enforcement datasets (drug, device, food: the openFDA fields as stored), the CPSC Recall API dataset and
the NHTSA recalls dataset from the corpus, and writes one JSON line per record to private/build/recall_patterns/lookups/. Credentials
come only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment.

    python3 -I -B scripts/enrichment/recall_patterns/extract.py
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402

OUT = os.path.join(ROOT, "private", "build", "recall_patterns", "lookups")
SOURCES = {
    "fda_drug": ("agency_safety_openfda_drug_enforcement", "id,f:detail->fields"),
    "fda_device": ("agency_safety_openfda_device_enforcement", "id,f:detail->fields"),
    "fda_food": ("agency_safety_openfda_food_enforcement", "id,f:detail->fields"),
    "cpsc": ("agency_safety_cpsc_recalls_api", "id,title,r:item->recall,c:item->cells"),
    "nhtsa": ("agency_safety_nhtsa_recalls", "id,title,i:item,d:detail"),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for name, (dataset, select) in SOURCES.items():
        rows = writer.fetch_all(dataset, select=select)
        path = os.path.join(OUT, f"{name}.jsonl")
        with open(path, "w") as h:
            for row in rows:
                h.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        manifest[name] = {"dataset": dataset, "records": len(rows), "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()}
        print(name, len(rows))
    with open(os.path.join(OUT, "_manifest.json"), "w") as h:
        json.dump(manifest, h, indent=1)


if __name__ == "__main__":
    main()
