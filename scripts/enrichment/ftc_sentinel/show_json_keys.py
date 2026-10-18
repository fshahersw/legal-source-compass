"""Print selected keys of a JSON file (diagnostic). Usage: python3 -I -B show_json_keys.py FILE KEY [KEY ...] | --match SUBSTR"""
import json
import sys

data = json.load(open(sys.argv[1]))
if sys.argv[2] == "--match":
    for k, v in data.items():
        if sys.argv[3].lower() in k.lower():
            print(k, "=", json.dumps(v)[:300])
else:
    for k in sys.argv[2:]:
        print(k, "=", json.dumps(data.get(k))[:500])
