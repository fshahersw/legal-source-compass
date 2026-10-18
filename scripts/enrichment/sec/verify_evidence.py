"""Step 3: verify every candidate company<->MDL pair against the filing text itself.

Input:  private/acq/sec-companies/efts_hits.json
Output: private/acq/sec-companies/evidence.json
Filing documents are cached gzip-compressed (byte-identical) under private/acq/sec-companies/docs/.

Rules (see targets.py for the tiers):
  * Only the registrant's own periodic, current or registration filings count (fund, ownership and
    asset-backed filings are excluded: forms N-*, 13F, SC 13*, 485*, 497*; SIC 6189/6722/6726).
  * Tier A/B: every candidate filing (up to 40 per pair, newest first) is downloaded and checked.
  * Tier C: up to 3 filings per pair dated on or after the MDL's JPML filing/transfer date.
  * A pair is linked by the strongest tier with at least one verified filing.
"""
import functools
import gzip
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import evidence as ev  # noqa: E402
import sec_http as h  # noqa: E402
import targets as tg  # noqa: E402

ACQ = h.ACQ
ALLOWED_FORMS = {
    "10-K", "10-K405", "10-KT", "10-Q", "8-K", "20-F", "6-K", "40-F", "S-1", "S-4", "F-1", "F-4",
    "10-12B", "10-12G", "20FR12B", "424B1", "424B2", "424B3", "424B4", "424B5", "ARS", "DRS",
}
EXCLUDED_SIC = {"6189", "6722", "6726"}
AB_LIMIT = 40
C_LIMIT = 6


def form_ok(form: str | None) -> bool:
    return bool(form) and form.replace("/A", "") in ALLOWED_FORMS


def doc_url(hit) -> str:
    cik = int(hit["ciks"][0])
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{hit['adsh'].replace('-', '')}/{hit['file']}"


TEXT_VERSION = "p2"  # bump when evidence.filing_text changes


@functools.lru_cache(maxsize=256)
def doc_text(url: str) -> str | None:
    """Visible text of a filing document. The parsed text is cached (derived data, gzip) next to the
    unchanged raw download, keyed by URL and TEXT_VERSION."""
    if url.lower().endswith((".pdf", ".jpg", ".gif", ".png", ".xml")):
        return None
    cached = h.cache_path(url + "#" + TEXT_VERSION, "text", ".txt.gz")
    if cached.exists():
        return gzip.decompress(cached.read_bytes()).decode()
    body = h.get(url, kind="docs", suffix=".htm", compress=True, timeout=180)
    if body is None:
        return None
    text = ev.filing_text(body)
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(gzip.compress(text.encode(), 6))
    return text


def candidates(data):
    """(cik, mdl) -> {name, sic, tiers: {tier: {adsh: hit}}}"""
    pairs = {}
    for q in data["queries"]:
        for hit in q["hits"]:
            if not form_ok(hit["form"]) or not hit["file"] or not ev.document_counts(hit["form"], hit["file_type"]):
                continue
            sics = hit["sics"] if len(hit["sics"]) == len(hit["ciks"]) else [None] * len(hit["ciks"])
            for cik, name, sic in zip(hit["ciks"], hit["names"], sics):
                if sic in EXCLUDED_SIC:
                    continue
                key = (cik, q["mdl"])
                pair = pairs.setdefault(key, {"cik": cik, "name": name, "sic": sic, "tiers": defaultdict(dict)})
                tier_hits = pair["tiers"][q["tier"]]
                # Keep one document per accession (the main document is preferred over exhibits).
                prev = tier_hits.get(hit["adsh"])
                if prev is None or (prev["file_type"] or "").startswith("EX") and not (hit["file_type"] or "").startswith("EX"):
                    tier_hits[hit["adsh"]] = {**hit, "term": q.get("term")}
    return pairs


PERIODIC = {"10-K", "10-Q", "20-F", "40-F", "10-K405", "10-KT"}


def order_for_c(hits):
    """Up to C_LIMIT filings: the newest periodic reports (10-K/10-Q/20-F/40-F main documents) first,
    then the newest other main documents, then the oldest and the middle filing."""
    main = [x for x in hits if not (x["file_type"] or "").upper().startswith("EX-")] or hits
    newest = sorted(main, key=lambda x: x["file_date"] or "", reverse=True)
    periodic = [x for x in newest if (x["form"] or "").replace("/A", "") in PERIODIC]
    picks = []
    for x in periodic[:4] + newest[:2] + newest[-1:] + newest[len(newest) // 2: len(newest) // 2 + 1]:
        if x not in picks:
            picks.append(x)
    return picks[:C_LIMIT]


def check(pair, target):
    mdl = target["mdl"]
    subjects = tg.SUBJECTS.get(mdl)
    gate = min(d for d in (target.get("date_filed"), target.get("date_transferred")) if d) if (target.get("date_filed") or target.get("date_transferred")) else None
    aliases = ev.name_aliases(pair["name"])
    result = {"cik": pair["cik"], "name": pair["name"], "sic": pair["sic"], "mdl": mdl, "tier": None,
              "aliases": aliases, "verified": [], "checked": 0, "search_hits": {}}
    for tier in ("A", "B", "C"):
        hits = list(pair["tiers"].get(tier, {}).values())
        if not hits:
            continue
        result["search_hits"][tier] = sorted(
            [{"adsh": x["adsh"], "form": x["form"], "file_date": x["file_date"]} for x in hits], key=lambda x: x["file_date"] or "")
        if tier == "C":
            if not gate or not subjects:
                continue
            hits = [x for x in hits if (x["file_date"] or "") >= gate]
            todo = order_for_c(hits)
        else:
            todo = sorted(hits, key=lambda x: x["file_date"] or "", reverse=True)[:AB_LIMIT]
        verified = []
        for hit in todo:
            url = doc_url(hit)
            text = doc_text(url)
            result["checked"] += 1
            if not text:
                continue
            main_doc = not (hit["file_type"] or "").upper().startswith("EX-")
            found = ev.verify(text, tier=tier, mdl=mdl, caption=target["caption"] if target["use_caption"] else None,
                              subjects=subjects, pl_terms=tg.PL_TERMS, mdl_terms=tg.MDL_TERMS,
                              aliases=aliases, main_document=main_doc, others=tg.other_terms(mdl))
            if not found:
                continue
            start, end, matched = found
            role = ev.role_at(text, start, end, aliases)
            dismissed = ev.dismissed_at(text, start, end, aliases)
            verified.append({
                "adsh": hit["adsh"], "file": hit["file"], "form": hit["form"], "file_date": hit["file_date"],
                "period_ending": hit["period_ending"], "url": url, "matched": text[start:end][:160],
                "excerpt": ev.excerpt(text, start, end), "role": role, "dismissed": dismissed,
                "file_type": hit["file_type"],
                "co_registrants": [n for c, n in zip(hit["ciks"], hit["names"]) if c != pair["cik"]][:6],
            })
        if verified:
            result["tier"] = tier
            result["verified"] = sorted(verified, key=lambda x: x["file_date"] or "")
            return result
    return result


def reread_roles():
    """Recompute only the role reading of every verified filing (cached documents; links unchanged)."""
    data = json.loads((ACQ / "evidence.json").read_text())
    targets = {t["mdl"]: t for t in json.loads((ACQ / "efts_hits.json").read_text())["targets"]}

    def one(pair):
        target = targets[pair["mdl"]]
        for v in pair["verified"]:
            text = doc_text(v["url"])
            if not text:
                continue
            found = ev.verify(text, tier=pair["tier"], mdl=pair["mdl"], caption=target["caption"] if target["use_caption"] else None,
                              subjects=tg.SUBJECTS.get(pair["mdl"]), pl_terms=tg.PL_TERMS, mdl_terms=tg.MDL_TERMS,
                              aliases=pair["aliases"], main_document=not (v.get("file_type") or "").upper().startswith("EX-"),
                              others=tg.other_terms(pair["mdl"]))
            if found:
                v["role"] = ev.role_at(text, found[0], found[1], pair["aliases"])
                v["dismissed"] = ev.dismissed_at(text, found[0], found[1], pair["aliases"])
                v["matched"] = text[found[0]:found[1]][:160]
                v["excerpt"] = ev.excerpt(text, found[0], found[1])
        return pair

    linked = [p for p in data["pairs"] if p["tier"]]
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(one, linked))
    (ACQ / "evidence.json").write_text(json.dumps(data, indent=0))
    roles = defaultdict(int)
    for p in linked:
        for v in p["verified"]:
            roles[v["role"]] += 1
    print("roles re-read for", len(linked), "pairs", dict(roles))


def main():
    if "--reread-roles" in sys.argv:
        reread_roles()
        return
    data = json.loads((ACQ / "efts_hits.json").read_text())
    targets = {t["mdl"]: t for t in data["targets"]}
    pairs = [(p, targets[mdl]) for (cik, mdl), p in candidates(data).items() if mdl in targets]
    print(len(pairs), "candidate pairs")
    done = []
    if "--recheck-c" in sys.argv:
        prior = {(r["cik"], r["mdl"]): r for r in json.loads((ACQ / "evidence.json").read_text())["pairs"]}
        keep = [prior[(p["cik"], t["mdl"])] for p, t in pairs if prior.get((p["cik"], t["mdl"]), {}).get("tier") in ("A", "B")]
        kept = {(r["cik"], r["mdl"]) for r in keep}
        pairs = [(p, t) for p, t in pairs if (p["cik"], t["mdl"]) not in kept]
        done.extend(keep)
        print(len(keep), "tier A/B pairs kept;", len(pairs), "pairs re-checked")
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, res in enumerate(pool.map(lambda pt: check(*pt), pairs)):
            done.append(res)
            if i % 100 == 0:
                print(i, sum(1 for r in done if r["tier"]), "linked so far", flush=True)
    linked = [r for r in done if r["tier"]]
    (ACQ / "evidence.json").write_text(json.dumps({"built": date.today().isoformat(), "pairs": done}, indent=0))
    by_tier = defaultdict(int)
    for r in linked:
        by_tier[r["tier"]] += 1
    print(len(linked), "linked pairs", dict(by_tier), "docs checked", sum(r["checked"] for r in done))


if __name__ == "__main__":
    main()
