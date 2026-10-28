"""Acquire public-domain judge portraits for judges linked to a CourtListener person.

Input: Free Law Project's judge-pics index (people.json at the pinned revision; private/acq/judge_pics/people.json) and the judge ↔
CourtListener crosswalk (private/build/judge_xwalk/judge_cl_crosswalk.json). A portrait is used only when

- its licence is "Work of Federal Government" or "Work of State Government" (entries with no recorded licence are left out), and
- its CourtListener person id is the person a judge record is linked to by an exact-evidence crosswalk tier (FJC id, the FJC-backed
  parent profile, or a unique exact name at the court or in the state). Possible, ambiguous and unlinked records get no portrait.
- its own slug does not name somebody else (index_name_consistent): the index carries a wrong person id on a few entries.
- the judge record has no photo of its own in the corpus (1,155 of the 1,183 linked records already carry this collection's
  portrait as a stored file; those keep it, and only the records without one are filled here).

The original bytes are kept unchanged in private/acq/judge_pics/orig/ with their SHA-256. The site serves a derived copy sized
for the profile header (public/judge-portraits/<person id>.jpeg, at most 224 x 288 pixels, JPEG quality 82), recorded with its own
SHA-256 beside the original's.
The credit shown on the site is the source each portrait records (the court, the Supreme Court collection, the D.C. Circuit
historical society, the Tennessee judiciary or the Wikipedia article it was taken from) with its licence, not the index itself.
Output: src/lib/judges/portraits.server.json, read only by server functions.

    python3 -B scripts/visuals/acquire_judge_portraits.py
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import io
import json
import os
import time
import urllib.parse
import sys
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

from judge_portrait_release import index_name_consistent  # noqa: E402
REVISION = "a5cf4252"
INDEX = os.path.join(ROOT, "private", "acq", "judge_pics", "people.json")
RAW = os.path.join(ROOT, "private", "acq", "judge_pics", "orig")
PUBLIC = os.path.join(ROOT, "public", "judge-portraits")
CROSSWALK = os.path.join(ROOT, "private", "build", "judge_xwalk", "judge_cl_crosswalk.json")
OUT = os.path.join(ROOT, "src", "lib", "judges", "portraits.server.json")
IMAGE_URL = "https://raw.githubusercontent.com/freelawproject/judge-pics/{rev}/judge_pics/data/orig/{path}.jpeg"
LICENSES = ("Work of Federal Government", "Work of State Government")
LINKED = ("exact_id", "parent_profile_link", "exact_name_same_court", "exact_name_same_state")
MAX_BYTES = 30_000_000
THUMB = (224, 288)
USER_AGENT = "legal-source-compass portrait acquisition (research)"


def credit(source: str | None) -> dict:
    """The recorded source as a link when it is an http(s) URL, otherwise as text."""
    text = (source or "").strip()
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        label = "Wikipedia" if parsed.netloc.endswith("wikipedia.org") else parsed.netloc.removeprefix("www.")
        return {"sourceLabel": label, "sourceUrl": text}
    return {"sourceLabel": text or "Not recorded", "sourceUrl": None}


def fetch(path: str) -> bytes:
    url = IMAGE_URL.format(rev=REVISION, path=urllib.parse.quote(path))
    last = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=40) as response:
                body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError("image exceeds size bound")
            return body
        except Exception as error:  # noqa: BLE001 - retried, then reported
            last = error
            time.sleep(2 ** attempt)
    raise RuntimeError(f"{path}: {last}")


def recorded_photo_ids() -> set[str]:
    """Judge records whose corpus item already names a photo (read-only; credentials from the environment)."""
    import corpus_writer

    return {row["id"] for row in corpus_writer.fetch_all("judges", select="id,item") if (row.get("item") or {}).get("photo_url")}


def main():
    recorded = recorded_photo_ids()
    people = json.load(open(INDEX))
    eligible = {p["person"]: p for p in people if p.get("license") in LICENSES and isinstance(p.get("person"), int) and p.get("path")}
    judges: dict[str, int] = {}
    contradicted: dict[int, str] = {}
    for row in json.load(open(CROSSWALK))["rows"]:
        cells = row["item"]["cells"]
        if row["id"] in recorded:
            continue
        if cells.get("tier") in LINKED and cells.get("cl_person_id") is not None and int(cells["cl_person_id"]) in eligible:
            person = int(cells["cl_person_id"])
            # The index carries a wrong person id on a few entries (e.g. "baker-josh", a Tennessee judiciary portrait, on
            # person 153, John Harris Baker, 1832-1915): an entry whose own slug names somebody else is not used.
            if not index_name_consistent(eligible[person]["path"], cells.get("cl_name") or ""):
                contradicted[person] = eligible[person]["path"]
                continue
            judges[row["id"]] = person
    wanted = sorted(set(judges.values()))
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(PUBLIC, exist_ok=True)

    def one(person: int):
        entry = eligible[person]
        cached = os.path.join(RAW, f"{entry['path']}.jpeg")
        body = open(cached, "rb").read() if os.path.exists(cached) else fetch(entry["path"])
        im = Image.open(io.BytesIO(body))
        im.verify()
        im = Image.open(io.BytesIO(body))
        if im.format != "JPEG" or min(im.size) < 40:
            raise ValueError(f"{entry['path']}: not a usable JPEG {im.format} {im.size}")
        if not os.path.exists(cached):
            with open(cached, "wb") as h:
                h.write(body)
        original_size = im.size
        thumb = im.convert("RGB")
        thumb.thumbnail(THUMB, Image.Resampling.LANCZOS)
        out = io.BytesIO()
        thumb.save(out, "JPEG", quality=82, optimize=True, progressive=True)
        derived = out.getvalue()
        with open(os.path.join(PUBLIC, f"{person}.jpeg"), "wb") as h:
            h.write(derived)
        return person, {
            "assetPath": f"/judge-portraits/{person}.jpeg",
            "sha256": hashlib.sha256(derived).hexdigest(),
            "width": thumb.size[0],
            "height": thumb.size[1],
            "originalSha256": hashlib.sha256(body).hexdigest(),
            "originalWidth": original_size[0],
            "originalHeight": original_size[1],
            "license": entry["license"],
            "artist": entry.get("artist") or None,
            "dateCreated": entry.get("date_created") or None,
            **credit(entry.get("source")),
        }

    portraits, failed = {}, {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(one, person): person for person in wanted}
        for future in concurrent.futures.as_completed(futures):
            try:
                person, record = future.result()
                portraits[str(person)] = record
            except Exception as error:  # noqa: BLE001 - listed in the summary
                failed[futures[future]] = str(error)[:120]
    kept = {judge: person for judge, person in sorted(judges.items()) if str(person) in portraits}
    for name in os.listdir(PUBLIC):
        if name.removesuffix(".jpeg") not in portraits:
            os.remove(os.path.join(PUBLIC, name))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as h:
        json.dump({
            "index": {"revision": REVISION, "licenses": list(LICENSES), "crosswalkTiers": list(LINKED)},
            "people": dict(sorted(portraits.items(), key=lambda kv: int(kv[0]))),
            "judges": kept,
        }, h, indent=1, ensure_ascii=False)
        h.write("\n")
    print(json.dumps({"recorded_photos": len(recorded), "eligible_people": len(eligible), "linked_judges_without_photo": len(judges), "people": len(portraits),
                      "judges": len(kept), "failed": len(failed), "index_name_contradicted": len(contradicted)}))
    for person, path in sorted(contradicted.items()):
        print("  not used (index slug names somebody else)", person, path)
    for person, reason in sorted(failed.items()):
        print("  failed", person, reason)


if __name__ == "__main__":
    main()
