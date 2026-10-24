"""Print help_text of fields in archived OPTIONS responses for the given endpoints."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api
want = set(sys.argv[1:])
for (method, url), rec in sorted(cl_api.load_index().items()):
    ep = url.replace(cl_api.API, "")
    if method != "OPTIONS" or (want and ep not in want):
        continue
    j = json.loads(cl_api.read_raw(rec["sha256"]))
    print("==", ep, "|", (j.get("description") or "")[:300].replace("\n", " "))
    for name, f in ((j.get("actions") or {}).get("POST") or {}).items():
        print("  ", name, "|", f.get("label"), "|", (f.get("help_text") or "")[:400].replace("\n", " "))
