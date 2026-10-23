"""Senate roll-call vote XML (senate.gov LIS): vote menus for the 101st-119th Congresses, then the member-level XML of every
vote on a nomination (PN) whose menu title names a judgeship, a justice or a court, plus every en bloc vote that includes a
nomination. The exact join to judicial nominations (by congress + PN citation) happens in the builder; this step only
collects the candidate votes. Stored by fetchlib (gzip, sha256 in the manifest); a re-run makes no new requests.

  python3 -I -B crawl_senate.py menus
  python3 -I -B crawl_senate.py votes
  python3 -I -B crawl_senate.py judicial   (after build_nominations.py: votes on judicial PNs whose menu title omits the office)
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

MENU = "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{c}_{s}.xml"
VOTE = "https://www.senate.gov/legislative/LIS/roll_call_votes/vote{c}{s}/vote_{c}_{s}_{n}.xml"
CONGRESSES = range(101, 120)
JUDICIAL_TITLE = re.compile(r"\b(Judge|Justice|Court)\b", re.I)


def menus():
    for c in CONGRESSES:
        for s in (1, 2):
            status, body, _ = fl.fetch(MENU.format(c=c, s=s), "senate", method="direct urllib GET (senate.gov roll-call vote menu XML)", ok_missing=True)
            if status == 200 and body:
                yield c, s, ET.fromstring(body)


def text(el, tag):
    found = el.find(tag)
    return "".join(found.itertext()).strip() if found is not None else ""


def candidates(root):
    for vote in root.iter("vote"):
        number = text(vote, "vote_number")
        issue = text(vote, "issue")
        title = text(vote, "title")
        bloc = [text(m, "issue") for m in vote.iter("matter")]
        if issue.upper().startswith("PN") and JUDICIAL_TITLE.search(title):
            yield number
        elif any(b.upper().startswith("PN") for b in bloc):
            yield number


def judicial_keys() -> set:
    """(congress, PN) of every nomination in the judicial_nominations build: votes whose menu title does not name the
    office (e.g. 'Nomination - Clarence Thomas') are found by this exact key instead."""
    build = json.loads((fl.ROOT / "private" / "build" / "judiciary" / "judicial_nominations.json").read_text())
    return {(r["item"]["congress"], r["item"]["citation"]) for r in build["rows"]}


def main(step: str) -> None:
    if step == "judicial":
        keys, count, new = judicial_keys(), 0, 0
        for c, s, root in menus():
            for vote in root.iter("vote"):
                pns = [text(vote, "issue")] + [text(m, "issue") for m in vote.iter("matter")]
                if any((c, p.upper().replace(" ", "")) in keys for p in pns if p):
                    url = VOTE.format(c=c, s=s, n=text(vote, "vote_number"))
                    name = fl.safe_name(url)
                    new += not (fl.ACQ / "senate" / (name + ".gz")).exists()
                    fl.fetch(url, "senate", method="direct urllib GET (senate.gov roll-call vote XML)", ok_missing=True)
                    count += 1
        print(json.dumps({"judicial_votes": count, "newly_fetched": new}), flush=True)
        return
    if step == "menus":
        n = 0
        for c, s, root in menus():
            n += 1
        print(json.dumps({"menus": n}))
        return
    count = 0
    for c, s, root in menus():
        for number in candidates(root):
            fl.fetch(VOTE.format(c=c, s=s, n=number), "senate", method="direct urllib GET (senate.gov roll-call vote XML)", ok_missing=True)
            count += 1
            if count % 200 == 0:
                print(json.dumps({"votes": count, "at": f"{c}-{s}"}), flush=True)
    print(json.dumps({"votes": count}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
