"""Write src/lib/external/ecfrXml.fixtures.json: each fixture XML with the items ecfr_parse.py makes of it, so the
TypeScript port (src/lib/external/ecfrXml.ts) is tested against the parser that built the dataset.

  python3 -I -B scripts/enrichment/ecfr_full/make_ts_fixtures.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ecfr_parse as ep  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "src", "lib", "external", "ecfrXml.fixtures.json")


def main() -> None:
    fixtures = []
    for name in sorted(os.listdir(os.path.join(HERE, "fixtures"))):
        if not name.endswith(".xml"):
            continue
        path = os.path.join(HERE, "fixtures", name)
        with open(path, encoding="utf-8") as fh:
            xml = fh.read()
        with open(path, "rb") as fh:
            items = [obj for kind, obj, _ in ep.iter_title(fh, ep.Stats()) if kind == "item"]
        fixtures.append({"name": name, "xml": xml, "items": [
            {"n": i["n"], "type": i["type"], "heading": i["heading"], "lines": i["lines"], "layout": i["layout"], "notes": i["notes"]}
            for i in items]})
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"generated_by": "scripts/enrichment/ecfr_full/make_ts_fixtures.py", "fixtures": fixtures}, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(json.dumps({"fixtures": len(fixtures), "items": sum(len(f["items"]) for f in fixtures)}))


if __name__ == "__main__":
    main()
