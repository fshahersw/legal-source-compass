"""Write the markdown of a stored Firecrawl capture to a text file (diagnostic). Usage: python3 -I -B dump_markdown.py CAPTURE OUT"""
import json
import sys

doc = json.load(open(sys.argv[1]))
with open(sys.argv[2], "w") as out:
    out.write(doc.get("markdown") or "")
print(len(doc.get("markdown") or ""), "chars;", (doc.get("markdown") or "").count("\n"), "lines")
