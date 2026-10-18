"""Plain-text rendering of an HTML capture (standard library only); scripts, styles and markup dropped.

Usage: python3 -I -B htmltext.py <file.html> [<out.txt>]
"""
import html
import html.parser
import re
import sys

BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer",
         "table", "ul", "ol", "dt", "dd", "td", "th", "nav", "main", "aside", "blockquote", "pre", "hr", "title"}


class _Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip, self.links = [], 0, []
        self._href = None

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg", "template"):
            self.skip += 1
        if tag in BLOCK:
            self.parts.append("\n")
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._anchor = []

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg", "template") and self.skip:
            self.skip -= 1
        if tag in BLOCK:
            self.parts.append("\n")
        if tag == "a" and self._href is not None:
            self.links.append((" ".join("".join(self._anchor).split()), self._href))
            self._href = None

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self._href is not None:
                self._anchor.append(data)


def to_text(raw):
    parser = _Text()
    parser.feed(raw)
    text = "".join(parser.parts)
    lines = [" ".join(line.split()) for line in text.splitlines()]
    out, blank = [], False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif not blank:
            out.append("")
            blank = True
    return "\n".join(out).strip() + "\n", parser.links


def links_of(raw):
    return to_text(raw)[1]


if __name__ == "__main__":
    raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
    text, links = to_text(raw)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as out:
            out.write(text)
            out.write("\n\n== LINKS ==\n")
            for anchor, href in links:
                out.write(f"{anchor}\t{href}\n")
    else:
        sys.stdout.write(text)
