"""Diagnostic: print the main-article text of a stored capture's markdown between two marker strings.
Usage: python3 -I -B show_text.py CAPTURE START_MARKER [END_MARKER] [MAXCHARS]"""
import json
import sys

md = json.load(open(sys.argv[1])).get("markdown") or ""
start = md.find(sys.argv[2])
end = md.find(sys.argv[3], start + 1) if len(sys.argv) > 3 and sys.argv[3] else -1
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 6000
print(md[start: end if end > 0 else start + limit][:limit])
