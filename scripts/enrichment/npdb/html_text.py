"""Plain-text rendering of a saved HTML page (scripts/styles dropped, block tags become line breaks).

Usage: python3 -I -B html_text.py INPUT.raw [OUTPUT.txt]
"""
import html.parser
import sys

BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "dt", "dd", "section", "article", "caption", "thead", "tbody"}
CELL = {"td", "th"}


class _Text(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        elif tag in BLOCK:
            self.out.append("\n")
        elif tag in CELL:
            self.out.append(" | ")
        if tag == "a":
            href = dict(attrs).get("href")
            if href and not href.startswith(("#", "javascript", "JavaScript")) and not self.skip:
                self.out.append("")
                self._href = href
        if tag in ("h1", "h2", "h3", "h4") and not self.skip:
            self.out.append("## ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        elif tag in BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def render(raw):
    parser = _Text()
    parser.feed(raw)
    lines = []
    for line in "".join(parser.out).splitlines():
        line = " ".join(line.split())
        if line:
            lines.append(line)
    return "\n".join(lines) + "\n"


def main(argv):
    with open(argv[1], encoding="utf-8", errors="replace") as handle:
        text = render(handle.read())
    if len(argv) > 2:
        with open(argv[2], "w", encoding="utf-8") as out:
            out.write(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main(sys.argv)
