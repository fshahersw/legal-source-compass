"""Release packet for Free Law Project judge portraits on judge pages that show none (owner decision 2026-10-27).

Inputs
- the pinned judge-pics index (people.json at revision a5cf4252) in <packet>/flp_index/people.json;
- scripts/visuals/judge_portrait_release.candidates.json: judge pages bound to a CourtListener person by an exact identifier
  chain (FJC judge id equal on both sides, or a linked judge_cl_crosswalk exact-name tier, which names one CourtListener
  person and lets several directory records claim it only when the directory duplicates that exact name), captured from
  read-only SELECTs. Each row also carries the CourtListener name; an index slug that contradicts it is refused
  (index_name_consistent), because a few index entries carry the wrong person id.

Each portrait shows its recorded source and licence. An index entry with no recorded licence is released with the licence
shown as "not recorded" (owner decision 2026-10-27: an unknown status is a caution hold, not source evidence).

Steps (nothing here writes to production unless --upload is given; the lead runs that step):

    python -B scripts/visuals/judge_portrait_release.py --packet DIR --fetch     # originals at the pinned revision
    python -B scripts/visuals/judge_portrait_release.py --packet DIR --build     # verify, derive, manifest + SQL
    python -B scripts/visuals/judge_portrait_release.py --packet DIR --upload    # lead only: corpus-originals objects

--build records each original's sha256 beside the index's own hash (the index hash is kept from when an entry was added and
does not always match the file at the pinned revision), keeps an already stored portrait (its route is
"portrait-" + sha256(index path)[:20], the scheme of the 1,174 stored ones) and derives a profile-header copy for the rest
(at most 224 x 288 pixels, JPEG quality 82, as scripts/visuals/acquire_judge_portraits.py does). It writes
<packet>/manifest.json and the apply/rollback SQL under database/contracts/.
--upload reads EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY from the environment (never printed), PUTs each
derived file to corpus-originals/<sha[:2]>/<sha> and reads it back to check the hash.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CANDIDATES = os.path.join(HERE, "judge_portrait_release.candidates.json")
CONTRACT = os.path.join(ROOT, "database", "contracts", "judge-portraits-release-20261027.sql")
ROLLBACK = os.path.join(ROOT, "database", "contracts", "judge-portraits-release-20261027-rollback.sql")
REVISION = "a5cf4252"
IMAGE_URL = "https://raw." + "githubusercontent.com/freelawproject/judge-pics/{rev}/judge_pics/data/orig/{path}.jpeg"
ROUTE_PREFIX = "/supplement-files/judge_portraits/portrait-"
BUCKET = "corpus-originals"
THUMB = (224, 288)
MAX_BYTES = 30_000_000
USER_AGENT = "legal-source-compass portrait release (research)"
LICENCE_TEXT = {
    "Work of Federal Government": "recorded as a work of federal government",
    "Work of State Government": "recorded as a work of state government",
    None: "licence not recorded",
}
# Already stored (corpus_artifacts.ready = true), read 2026-10-27; new bytes are not derived for these.
STORED = {
    "kearney-mark-1963": {"sha256": "0b987c96f6e3079d627151ba248dcc478b65044af2613595b0a087d485907801", "bytes": 9041},
    "owen-priscilla-1954-10-04": {"sha256": "7630604f81946e19066b892fee76d46d6e3556c672660634b5462c47f7081a6e", "bytes": 4771},
}


# Common short forms of given names, used only to avoid flagging an index slug such as "wyatt-tom" for "Thomas Wyatt".
NICKNAMES = {
    "tom": "thomas", "tim": "timothy", "bill": "william", "bob": "robert", "jim": "james", "mike": "michael",
    "dan": "daniel", "dave": "david", "joe": "joseph", "ed": "edward", "ted": "edward", "chuck": "charles",
    "dick": "richard", "jack": "john", "steve": "stephen", "ken": "kenneth", "pat": "patrick", "sam": "samuel",
}


def _name_tokens(text: str) -> list[str]:
    ascii_text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return [t for t in re.split(r"[^a-z]+", ascii_text) if t]


def index_name_consistent(path: str, cl_name: str) -> bool:
    """False when the index slug (surname-given[-date]) contradicts the name of the CourtListener person it names.

    The judge-pics index carries a CourtListener person id beside each slug; a few ids are wrong (e.g. "baker-josh", a
    Tennessee judiciary portrait, carries person 153, John Harris Baker, 1832-1915). Identity still comes from the person
    id; this check only refuses entries whose own slug says they show somebody else.
    """
    slug = [t for t in (path or "").lower().split("-") if t.isalpha()]
    name = _name_tokens(cl_name)
    if len(slug) < 2 or not name:
        return False
    runs = {"".join(name[i:j]) for i in range(len(name)) for j in range(i + 1, len(name) + 1)}
    for k in range(1, len(slug)):
        if "".join(slug[:k]) not in runs:
            continue
        given = slug[k]
        for token in name:
            if token == given or token.startswith(given) or (len(token) == 1 and given.startswith(token)):
                return True
            if NICKNAMES.get(given) == token:
                return True
    return False


def route_for(path: str) -> str:
    """The artifact route of an index path (same scheme as the stored /supplement-files/judge_portraits files)."""
    return ROUTE_PREFIX + hashlib.sha256(path.encode()).hexdigest()[:20]


def object_key(sha: str) -> str:
    return f"{sha[:2]}/{sha}"


def credit(licence: str | None) -> str:
    if licence not in LICENCE_TEXT:
        raise ValueError(f"unexpected licence {licence!r}")
    return f"Portrait: Free Law Project judicial portrait collection; {LICENCE_TEXT[licence]}."


def source_fields(source: str | None) -> dict:
    """The recorded source as given: a URL stays a URL; a plain label (e.g. 'Alabama Court Website') stays text."""
    text = (source or "").strip()
    parsed = urllib.parse.urlparse(text)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return {"photo_source": text, "photo_source_label": None}
    return {"photo_source": None, "photo_source_label": text or "Not recorded"}


def index_entries(people: list[dict]) -> dict[str, dict]:
    return {p["path"]: p for p in people if isinstance(p.get("path"), str)}


def plan(people: list[dict], candidates: dict) -> list[dict]:
    """One row per released judge page. Raises on any candidate the index does not support exactly."""
    by_path = index_entries(people)
    seen_judges: set[str] = set()
    rows = []
    for c in candidates["release"]:
        entry = by_path.get(c["path"])
        if entry is None:
            raise ValueError(f"{c['path']}: not in the index")
        if entry.get("person") != c["person"] or not isinstance(c["person"], int) or c["person"] <= 0:
            raise ValueError(f"{c['path']}: index person {entry.get('person')} != candidate {c['person']}")
        if c["judge_id"] in seen_judges or len(c["judge_id"]) != 32:
            raise ValueError(f"{c['judge_id']}: duplicate or malformed judge id")
        if not (c["basis"] == "fjc_id" or c["basis"].startswith("crosswalk:exact_")):
            raise ValueError(f"{c['judge_id']}: basis {c['basis']} is not an exact identifier chain")
        if not index_name_consistent(c["path"], c.get("cl_name") or ""):
            raise ValueError(f"{c['path']}: index slug contradicts CourtListener person {c['person']} ({c.get('cl_name')!r})")
        seen_judges.add(c["judge_id"])
        licence = entry.get("license")
        rows.append({
            "judge_id": c["judge_id"],
            "name": c["name"],
            "cl_name": c["cl_name"],
            "person": c["person"],
            "path": c["path"],
            "route": route_for(c["path"]),
            "filename": f"{c['path']}.jpeg",
            "stored": c["path"] in STORED,
            "licence": licence,
            "photo_credit": credit(licence),
            **source_fields(entry.get("source")),
            "recorded_source": entry.get("source"),
            "artist": entry.get("artist"),
            "date_created": entry.get("date_created"),
            "original_sha256": entry["hash"],
            "basis": c["basis"],
            "evidence": c["evidence"],
            "pre_item_md5": c.get("pre_item_md5"),
            "pre_detail_md5": c.get("pre_detail_md5"),
        })
    return rows


def derive(body: bytes) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    from PIL import Image

    im = Image.open(io.BytesIO(body))
    im.verify()
    im = Image.open(io.BytesIO(body))
    if im.format != "JPEG" or min(im.size) < 40:
        raise ValueError(f"not a usable JPEG: {im.format} {im.size}")
    size = im.size
    thumb = im.convert("RGB")
    thumb.thumbnail(THUMB, Image.Resampling.LANCZOS)
    out = io.BytesIO()
    thumb.save(out, "JPEG", quality=82, optimize=True, progressive=True)
    return out.getvalue(), thumb.size, size


def sql_text(value: str | None) -> str:
    return "null" if value is None else "'" + value.replace("'", "''") + "'"


def sql_json(value) -> str:
    return "'" + json.dumps(value, ensure_ascii=False, sort_keys=True).replace("'", "''") + "'::jsonb"


def render_sql(manifest: dict) -> tuple[str, str]:
    rows = manifest["rows"]
    # One artifact per index path: directory duplicates of one person (two judges records) share the same file.
    new, seen_routes = [], set()
    for r in rows:
        if not r["stored"] and r["route"] not in seen_routes:
            seen_routes.add(r["route"])
            new.append(r)
    stored_routes = {r["route"] for r in rows if r["stored"]}
    ids = ", ".join(sql_text(r["judge_id"]) for r in rows)
    routes_new = ", ".join(sql_text(r["route"]) for r in new)
    head = (
        "-- Judge portraits release (owner decision 2026-10-27: \"dont withhold any data. If its accurate and valuable, USE IT\").\n"
        f"-- Generated by scripts/visuals/judge_portrait_release.py from the manifest body digest {manifest['sha256']}\n"
        "-- (sha256 of the sorted-key JSON body, not of the manifest.json file).\n"
        f"-- {len(rows)} judge pages without any portrait get the Free Law Project portrait of the CourtListener person they are\n"
        "-- bound to by an exact identifier chain (see scripts/visuals/judge_portrait_release.candidates.json).\n"
        f"-- {len(stored_routes)} portraits are already stored artifacts; {len(new)} new derived files must be uploaded to\n"
        "-- corpus-originals first (judge_portrait_release.py --upload). Rollback: judge-portraits-release-20261027-rollback.sql.\n"
    )
    apply = [head, "begin;", "set local statement_timeout = '60s';", ""]
    if new:
        apply.append("-- 1. Artifact rows for the newly stored derived files (route scheme: portrait-<sha256(index path)[:20]>).")
        apply.append("insert into public.corpus_artifacts (route, sha256, object_key, bytes, mime, filename, ready) values")
        apply.append(",\n".join(
            f"  ({sql_text(r['route'])}, {sql_text(r['derived_sha256'])}, {sql_text(object_key(r['derived_sha256']))}, "
            f"{r['derived_bytes']}, 'image/jpeg', {sql_text(r['filename'])}, true)" for r in new))
        apply.append("on conflict (route) do nothing;")
        apply.append("")
    apply.append("-- 2. Bind each portrait to its judge page (item and detail carry the same photo fields), only where none is recorded.")
    for r in rows:
        fields = {"photo_url": r["route"], "photo_credit": r["photo_credit"], "photo_source": r["photo_source"]}
        if r["photo_source_label"]:
            fields["photo_source_label"] = r["photo_source_label"]
        provenance = {
            "collection": "Free Law Project judge-pics",
            "index_revision": REVISION,
            "index_path": r["path"],
            "courtlistener_person": r["person"],
            "index_hash": r["original_sha256"],
            "original_sha256": r["fetched_sha256"],
            "stored_sha256": r["derived_sha256"],
            "licence_as_recorded": r["licence"],
            "source_as_recorded": r["recorded_source"],
            "binding_basis": r["basis"],
            "binding_evidence": r["evidence"],
            "released_under": "owner decision 2026-10-27",
        }
        apply.append(
            f"update public.corpus_records set item = item || {sql_json(fields)},\n"
            f"  detail = coalesce(detail, '{{}}'::jsonb) || {sql_json({**fields, 'photo_provenance': provenance})}\n"
            f"where dataset = 'judges' and id = {sql_text(r['judge_id'])} and coalesce(item->>'photo_url', '') = '';  -- {r['name']}"
        )
    apply += [
        "",
        "-- 3. Retire the empty legacy catalog row (0 records, ready=false; its 1,174 portraits are served through judges.photo_url).",
        "delete from public.corpus_datasets where id = 'judge_portraits' and imported_records = 0",
        "  and not exists (select 1 from public.corpus_records where dataset = 'judge_portraits');",
        "",
        "-- Verify before commit (enforced): bound = %d, artifacts = %d (route, sha256 and ready as written), legacy_row = 0;"
        % (len(rows), len(new)),
        "-- any other result raises and the whole transaction rolls back.",
        "do $verify$",
        "declare v_bound bigint; v_artifacts bigint; v_legacy bigint;",
        "begin",
        "  select count(*) into v_bound from public.corpus_records r join (values",
        ",\n".join(f"    ({sql_text(r['judge_id'])}, {sql_text(r['route'])})" for r in rows),
        "  ) as want(id, route) on r.dataset = 'judges' and r.id = want.id",
        "   and r.item->>'photo_url' = want.route and r.detail->>'photo_url' = want.route;",
        "  select count(*) into v_artifacts from public.corpus_artifacts a join (values",
        (",\n".join(f"    ({sql_text(r['route'])}, {sql_text(r['derived_sha256'])})" for r in new)
         if new else "    (null::text, null::text)"),
        "  ) as want(route, sha256) on a.route = want.route and a.sha256 = want.sha256 and a.ready;",
        "  select count(*) into v_legacy from public.corpus_datasets where id = 'judge_portraits';",
        "  if v_bound <> %d or v_artifacts <> %d or v_legacy <> 0 then" % (len(rows), len(new)),
        "    raise exception 'judge portraits release check failed: bound=%, artifacts=%, legacy_row=%', v_bound, v_artifacts, v_legacy;",
        "  end if;",
        "end",
        "$verify$;",
        "commit;",
        "",
    ]
    rollback = [
        "-- Rollback of judge-portraits-release-20261027.sql (restores the pre-release state exactly).",
        "begin;",
        "set local statement_timeout = '60s';",
        "update public.corpus_records",
        "   set item = item - 'photo_url' - 'photo_credit' - 'photo_source' - 'photo_source_label' || '{\"photo_url\": \"\"}'::jsonb,",
        "       detail = detail - 'photo_url' - 'photo_credit' - 'photo_source' - 'photo_source_label' - 'photo_provenance'",
        "                || '{\"photo_url\": \"\", \"photo_provenance\": null}'::jsonb",
        f" where dataset = 'judges' and id in ({ids})",
        "   and item->>'photo_url' in (%s);" % ", ".join(sql_text(x) for x in dict.fromkeys(r["route"] for r in rows)),
    ]
    if new:
        rollback.append(f"delete from public.corpus_artifacts where route in ({routes_new});")
    rollback += [
        "insert into public.corpus_datasets (id, label, ready, expected_records, imported_records, manifest_sha256, metadata, updated_at)",
        "select r.id, r.label, r.ready, r.expected_records, r.imported_records, r.manifest_sha256, r.metadata, r.updated_at",
        "  from jsonb_populate_record(null::public.corpus_datasets, $legacy$" + manifest["legacy_catalog_row"] + "$legacy$::jsonb) r",
        "on conflict (id) do nothing;",
        "",
        "-- Verify before commit (enforced): every row is back to its pre-release bytes (md5 of item and detail as read",
        "-- 2026-10-27): restored = %d, artifacts_left = 0, legacy_row = 1; any other result raises and rolls back." % len(rows),
        "do $verify$",
        "declare v_restored bigint; v_left bigint; v_legacy bigint;",
        "begin",
        "  select count(*) into v_restored from public.corpus_records r join (values",
        ",\n".join(f"    ({sql_text(r['judge_id'])}, {sql_text(r['pre_item_md5'])}, {sql_text(r['pre_detail_md5'])})" for r in rows),
        "  ) as pre(id, item_md5, detail_md5) on r.dataset = 'judges' and r.id = pre.id",
        "   and md5(r.item::text) = pre.item_md5 and md5(r.detail::text) = pre.detail_md5;",
        "  select count(*) into v_left from public.corpus_artifacts where route in (%s);" % (routes_new or "null"),
        "  select count(*) into v_legacy from public.corpus_datasets where id = 'judge_portraits';",
        "  if v_restored <> %d or v_left <> 0 or v_legacy <> 1 then" % len(rows),
        "    raise exception 'judge portraits rollback check failed: restored=%, artifacts_left=%, legacy_row=%', v_restored, v_left, v_legacy;",
        "  end if;",
        "end",
        "$verify$;",
        "commit;",
        "-- The uploaded objects stay in corpus-originals (content-addressed, unreferenced after rollback); remove them only with",
        "-- an explicit instruction: " + ", ".join(object_key(r["derived_sha256"]) for r in new),
        "",
    ]
    return "\n".join(apply), "\n".join(rollback)


def fetch(path: str) -> bytes:
    url = IMAGE_URL.format(rev=REVISION, path=urllib.parse.quote(path))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("image exceeds size bound")
    return body


def load(packet: str) -> tuple[list[dict], dict, str]:
    raw = open(os.path.join(packet, "flp_index", "people.json"), "rb").read()
    candidates = json.load(open(CANDIDATES, encoding="utf-8"))
    sha = hashlib.sha256(raw).hexdigest()
    if sha != candidates["index"]["sha256"]:
        raise SystemExit(f"index sha256 {sha} != pinned {candidates['index']['sha256']}")
    return json.loads(raw), candidates, sha


def cmd_fetch(packet: str) -> None:
    people, candidates, _ = load(packet)
    os.makedirs(os.path.join(packet, "orig"), exist_ok=True)
    for row in plan(people, candidates):
        dest = os.path.join(packet, "orig", row["filename"])
        if not os.path.exists(dest):
            with open(dest, "wb") as h:
                h.write(fetch(row["path"]))
            time.sleep(2)
        print(row["path"], os.path.getsize(dest))


def cmd_build(packet: str, legacy_row_file: str) -> None:
    people, candidates, index_sha = load(packet)
    rows = plan(people, candidates)
    os.makedirs(os.path.join(packet, "derived"), exist_ok=True)
    derived_by_path: dict[str, dict] = {}
    for row in rows:
        body = open(os.path.join(packet, "orig", row["filename"]), "rb").read()
        # The index's own "hash" is recorded when an entry is added; six of these ten files were replaced in the
        # repository afterwards, so the bytes at the pinned revision are recorded beside it rather than rejected.
        row["fetched_sha256"] = hashlib.sha256(body).hexdigest()
        row["index_hash_matches"] = row["fetched_sha256"] == row["original_sha256"]
        if row["stored"]:
            row.update(derived_sha256=STORED[row["path"]]["sha256"], derived_bytes=STORED[row["path"]]["bytes"])
            continue
        if row["path"] not in derived_by_path:  # one derived file per index path (directory duplicates share it)
            derived, size, original_size = derive(body)
            sha = hashlib.sha256(derived).hexdigest()
            with open(os.path.join(packet, "derived", sha + ".jpeg"), "wb") as h:
                h.write(derived)
            derived_by_path[row["path"]] = dict(derived_sha256=sha, derived_bytes=len(derived), width=size[0], height=size[1],
                                                original_width=original_size[0], original_height=original_size[1])
        row.update(derived_by_path[row["path"]])
    legacy = open(legacy_row_file, encoding="utf-8").read().strip()
    json.loads(legacy)
    body = {"index_sha256": index_sha, "revision": REVISION, "rows": rows, "legacy_catalog_row": legacy}
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    manifest = {**body, "sha256": digest}
    with open(os.path.join(packet, "manifest.json"), "w", encoding="utf-8") as h:
        json.dump(manifest, h, indent=1, ensure_ascii=False)
        h.write("\n")
    apply, rollback = render_sql(manifest)
    with open(CONTRACT, "w", encoding="utf-8", newline="\n") as h:
        h.write(apply)
    with open(ROLLBACK, "w", encoding="utf-8", newline="\n") as h:
        h.write(rollback)
    print(json.dumps({"rows": len(rows), "new_files": len({r["route"] for r in rows if not r["stored"]}), "manifest_sha256": digest}))


def cmd_render(packet: str) -> None:
    manifest = json.load(open(os.path.join(packet, "manifest.json"), encoding="utf-8"))
    body = {k: v for k, v in manifest.items() if k != "sha256"}
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if digest != manifest["sha256"]:
        raise SystemExit(f"manifest body digest {digest} != recorded {manifest['sha256']}")
    apply, rollback = render_sql(manifest)
    with open(CONTRACT, "w", encoding="utf-8", newline="\n") as h:
        h.write(apply)
    with open(ROLLBACK, "w", encoding="utf-8", newline="\n") as h:
        h.write(rollback)
    print(json.dumps({"rows": len(manifest["rows"]), "manifest_body_digest": digest}))


def cmd_upload(packet: str) -> None:
    url = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise SystemExit("EXTERNAL_SUPABASE_URL and EXTERNAL_SUPABASE_SERVICE_ROLE_KEY must be set")
    manifest = json.load(open(os.path.join(packet, "manifest.json"), encoding="utf-8"))
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    done: set[str] = set()
    for row in manifest["rows"]:
        if row["stored"] or row["derived_sha256"] in done:
            continue
        sha = row["derived_sha256"]
        done.add(sha)
        body = open(os.path.join(packet, "derived", sha + ".jpeg"), "rb").read()
        if hashlib.sha256(body).hexdigest() != sha:
            raise SystemExit(f"{row['path']}: derived file changed since the build")
        target = f"{url}/storage/v1/object/{BUCKET}/{object_key(sha)}"
        put = urllib.request.Request(target, data=body, method="POST",
                                     headers={**headers, "Content-Type": "image/jpeg", "x-upsert": "false"})
        try:
            urllib.request.urlopen(put, timeout=120).read()
        except urllib.error.HTTPError as error:  # 409/400 "already exists" is fine: content-addressed
            if error.code not in (400, 409):
                raise
        with urllib.request.urlopen(urllib.request.Request(target, headers=headers), timeout=120) as response:
            back = response.read()
        if hashlib.sha256(back).hexdigest() != sha:
            raise SystemExit(f"{row['path']}: readback hash mismatch")
        print("stored", object_key(sha), len(back))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--packet", required=True)
    ap.add_argument("--legacy-row", help="JSON of the judge_portraits corpus_datasets row (to_jsonb), for the rollback")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--fetch", action="store_true")
    group.add_argument("--build", action="store_true")
    group.add_argument("--upload", action="store_true")
    group.add_argument("--render", action="store_true", help="re-render the SQL from an existing manifest.json (no fetch, no derive)")
    args = ap.parse_args(argv)
    if args.fetch:
        cmd_fetch(args.packet)
    elif args.render:
        cmd_render(args.packet)
    elif args.build:
        if not args.legacy_row:
            raise SystemExit("--build needs --legacy-row")
        cmd_build(args.packet, args.legacy_row)
    else:
        cmd_upload(args.packet)


if __name__ == "__main__":
    sys.exit(main())
