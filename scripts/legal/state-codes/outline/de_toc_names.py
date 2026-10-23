"""Delaware Code title structure from the publisher's own table of contents (captured pages, read-only).

    python3 -I -B scripts/legal/state-codes/outline/de_toc_names.py <delcode index.html> <out names.json> \
        <title>=<title index.html> [<title>=<title index.html> ...]

https://delcode.delaware.gov/ lists every title as "Title 6 - Commerce and Trade". A title's own page
(https://delcode.delaware.gov/title6/index.html) prints its subtitles as two headings ("Subtitle I", then
"Uniform Commercial Code") followed by links ../title6/<slug>/index.html whose text is the unit's printed line
("Article 2A. Leases", "Chapter 12. DELAWARE FALSE CLAIMS AND REPORTING ACT"). Only titles whose page is given are
written:

  {"title:6": "Commerce and Trade",
   "title:6/c002a": {"subtitle": ["I", "Uniform Commercial Code"], "level": "article", "number": "2A",
                     "heading": "Leases"}, ...}

Text is kept character for character after whitespace runs collapse (capitals stay capitals). A link whose text is not
"<Article|Chapter|Part> <designation>. <heading>", or a title missing from the index, is refused rather than guessed.
"""
import html
import json
import re
import sys

TITLE_LINK = re.compile(r'href="\s*title(\d+)/index\.html\s*"[^>]*>\s*(.*?)</a>', re.S)
TOKEN = re.compile(r'<h3>\s*Subtitle\s+([IVXL]+)\s*</h3>\s*<h3>(.*?)</h3>'
                   r'|href="\.\./title(\d+)/(c[0-9a-z_]+)/index\.html"[^>]*>\s*(.*?)</a>', re.S)
UNIT = re.compile(r"^(Article|Chapter|Part)\s+([0-9A-Z]+)\.\s+(.+)$")


def text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def title_names(index_page):
    names = {}
    for number, inner in TITLE_LINK.findall(html.unescape(index_page)):
        m = re.match(rf"^Title {re.escape(number)}\s+-\s+(.+)$", text(inner))
        if not m:
            raise ValueError(f"title link text does not name title {number}: {text(inner)!r}")
        names[number] = m.group(1)
    return names


def title_units(title, page):
    units, subtitle = {}, None
    for sub_number, sub_name, link_title, slug, inner in TOKEN.findall(page):
        if sub_number:
            subtitle = [sub_number, text(sub_name)]
            continue
        if link_title != title:
            raise ValueError(f"title {title} page links a unit of title {link_title}: {slug}")
        m = UNIT.match(text(inner))
        if not m:
            raise ValueError(f"unit link text is not '<Kind> <designation>. <heading>': {text(inner)!r}")
        key = f"title:{title}/{slug}"
        entry = {"subtitle": subtitle, "level": m.group(1).lower(), "number": m.group(2), "heading": m.group(3)}
        if units.get(key, entry) != entry:
            raise ValueError(f"{key} listed twice with different text")
        units[key] = entry
    if not units:
        raise ValueError(f"no units found on the title {title} page")
    return units


def main(argv):
    index_page = open(argv[0], encoding="utf-8").read()
    titles = title_names(index_page)
    out = {}
    for spec in argv[2:]:
        title, path = spec.split("=", 1)
        if title not in titles:
            raise ValueError(f"title {title} is not in the captured title list")
        out[f"title:{title}"] = titles[title]
        out.update(title_units(title, open(path, encoding="utf-8").read()))
    with open(argv[1], "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"titles": sum(1 for k in out if "/" not in k), "units": sum(1 for k in out if "/" in k)}))


if __name__ == "__main__":
    main(sys.argv[1:])
