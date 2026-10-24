"""Print the choice legends found in archived OPTIONS responses (field -> [(value, display_name)])."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cl_api
for (method, url), rec in sorted(cl_api.load_index().items()):
    if method != "OPTIONS":
        continue
    j = json.loads(cl_api.read_raw(rec["sha256"]))
    fields = (j.get("actions") or {}).get("POST") or {}
    print("==", url.replace(cl_api.API, ""), "fields:", len(fields))
    for name, f in fields.items():
        if f.get("choices"):
            ch = [(c["value"], c["display_name"]) for c in f["choices"]]
            if len(ch) > 60 or name in sys.argv[1:]:
                print("  ", name, len(ch), "choices (long)" if len(ch) > 60 else ch)
            else:
                print("  ", name, ch)
