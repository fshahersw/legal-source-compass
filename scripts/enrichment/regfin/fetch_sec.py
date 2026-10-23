"""Acquire the SEC broker-dealer monthly lists and the investment-adviser (Form ADV) reports.

Sources (public information on sec.gov, "may be copied or further distributed ... without the SEC's permission"):
  - Company Information About Active Broker-Dealers: one tab-delimited text file per month (2007-03 .. latest)
    https://www.sec.gov/foia/frequently-requested-documents/company-information-about-active-broker-dealers
  - Information About Registered Investment Advisers and Exempt Reporting Advisers: latest monthly zips
    https://www.sec.gov/data-research/sec-markets-data/information-about-registered-investment-advisers-exempt-reporting-advisers
Raw bytes are stored unchanged (BD files gzip-compressed byte-for-byte) with sha256 in private/acq/regfin/_manifest.jsonl.
SEC fair access: declared User-Agent, <= 4 requests/second (limit is 10).
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import regfin_http as h  # noqa: E402

SEC = "https://www.sec.gov"
BD_PAGE = h.ACQ / "terms" / "sec_bd_page.html"
RIA_PAGE = h.ACQ / "pages" / "sec_ria_data.html"
IA_LATEST = {
    "ia/ia100226.zip": "/files/investment/data/other/information-about-registered-investment-advisers-exempt-reporting-advisers/ia100226.zip",
    "ia/ia100226-exempt.zip": "/files/investment/data/other/information-about-registered-investment-advisers-exempt-reporting-advisers/ia100226-exempt.zip",
}


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cur = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.cur = [dict(attrs).get("href", ""), ""]

    def handle_data(self, data):
        if self.cur is not None:
            self.cur[1] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.cur is not None:
            self.rows.append((self.cur[0], " ".join(self.cur[1].split())))
            self.cur = None


def bd_files():
    parser = Links()
    parser.feed(BD_PAGE.read_text(encoding="utf-8", errors="replace"))
    out, seen = [], set()
    for href, label in parser.rows:
        if re.search(r"/bd[-0-9a-z]*\.txt$", href) and href not in seen:
            seen.add(href)
            out.append({"month_label": label, "path": href, "file": href.rsplit("/", 1)[1]})
    return out


if __name__ == "__main__":
    files = bd_files()
    (h.ACQ / "sec").mkdir(parents=True, exist_ok=True)
    only_latest = "--latest" in sys.argv
    todo = files[:1] if only_latest else files
    done = 0
    for item in todo:
        url = SEC + item["path"]
        status, body = h.fetch(url, "sec/bd/" + item["file"], gz=True)
        item["status"] = status
        item["bytes"] = len(body)
        done += 1
        if done % 25 == 0:
            print("bd", done, "of", len(todo), flush=True)
    (h.ACQ / "sec" / "bd_index.json").write_text(json.dumps(files, indent=1))
    bad = [f for f in todo if f.get("status") != 200]
    print("bd files", len(todo), "non-200", len(bad), [(f["file"], f.get("status")) for f in bad][:10])
    if not only_latest:
        for dest, path in IA_LATEST.items():
            status, body = h.fetch(SEC + path, "sec/" + dest)
            print(status, len(body), path)
