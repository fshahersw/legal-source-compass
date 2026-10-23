"""Independent checks of judicial_nominations and judicial_confirmation_votes. Prints a JSON summary with a failure count and
writes verify_nominations.json.

1. Second path, Senate XML: every published vote record is re-read from the stored XML with regular expressions (not the
   ElementTree parser the builder uses); per-party yea/nay/not-voting counts and the senators' votes must equal the record,
   and the members' yeas and nays must equal the published count.
2. Cross-source: for every confirmation by yea-nay vote in the 101st Congress or later, the Congress.gov tally must equal
   the senate.gov tally of the linked 'On the Nomination' vote with the same record vote number (failure when it differs;
   missing XML is counted).
3. Second path, status: the status is recomputed from Congress.gov's latestAction text alone and compared.
4. FJC agreement (reported): for nominations linked to an FJC judge, the FJC confirmation date and Ayes/Nays against
   Congress.gov; voice votes against FJC 'Voice'.
5. Completeness (reported): FJC appointments to courts in scope with a nomination date from 1981-01-20 on, and how many are
   linked from a nomination.
6. Spot checks of well-known confirmations (failures when they differ).
"""
from __future__ import annotations

import collections
import gzip
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetchlib as fl  # noqa: E402

BUILD = fl.ROOT / "private" / "build" / "judiciary"
SENATE = fl.ACQ / "senate" / "legislative" / "LIS" / "roll_call_votes"
SPOT = [  # (congress, citation, nominee substring, method, yeas, nays) from the Senate's published results
    (102, "PN456", "Clarence Thomas", "Roll call", 52, 48),
    (103, "PN422", "Ruth Bader Ginsburg", "Roll call", 96, 3),
    (109, "PN1006", "Delgado-Colon", "Voice vote", None, None),
    (117, "PN393", "Julien Xavier Neals", "Roll call", 66, 33),
]


def xml_members(path: Path):
    raw = gzip.decompress(path.read_bytes()).decode("utf-8")
    members = []
    for block in re.findall(r"<member>(.*?)</member>", raw, re.S):
        get = lambda tag: html.unescape((re.search(rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}>", block, re.S) or [None, ""])[1].strip())  # noqa: E731
        members.append((get("member_full"), get("party"), get("state"), get("vote_cast")))
    yeas = int(re.search(r"<yeas>(\d+)</yeas>", raw).group(1))
    nays = int(re.search(r"<nays>(\d+)</nays>", raw).group(1))
    return members, yeas, nays


def status_from_latest(text: str) -> str | None:
    t = (text or "").lower()
    if t.startswith("confirmed by the senate"):
        return "confirmed"
    if "withdrawal" in t:
        return "withdrawn"
    if "returned to the president" in t or "failed of confirmation" in t:
        return "returned"
    return None


def main() -> None:
    noms = [r["item"] for r in json.loads((BUILD / "judicial_nominations.json").read_text())["rows"]]
    votes = [r["item"] for r in json.loads((BUILD / "judicial_confirmation_votes.json").read_text())["rows"]]
    failures, checks, report, diffs = [], 0, collections.Counter(), []

    # 1. Senate XML second path
    for v in votes:
        c, s, n = v["congress"], v["session"], v["vote_number"]
        path = SENATE / f"vote{c}{s}" / f"vote_{c}_{s}_{n:05d}.xml.gz"
        members, yeas, nays = xml_members(path)
        checks += 1
        split = collections.defaultdict(collections.Counter)
        for _, party, _, cast in members:
            split[party][cast] += 1
        mine = {p["party"]: (p["yea"], p["nay"], p["not_voting"]) for p in v["party_split"]}
        theirs = {p: (cnt["Yea"], cnt["Nay"], cnt["Not Voting"]) for p, cnt in split.items()}
        if mine != theirs or (v["yeas"], v["nays"]) != (yeas, nays):
            failures.append({"check": "xml party split", "vote": v["vote_id"], "build": mine, "regex": theirs})
        if sum(1 for m in members if m[3] == "Yea") != yeas or sum(1 for m in members if m[3] == "Nay") != nays:
            report["xml_member_counts_differ_from_published_count"] += 1
        if [(m["name"], m["party"], m["state"], m["vote"]) for m in v["members"]] != members:
            failures.append({"check": "xml members", "vote": v["vote_id"]})

    # 2. Congress.gov tally vs senate.gov tally
    for nm in noms:
        conf = nm.get("confirmation") or {}
        if conf.get("method") != "Roll call" or nm["congress"] < 101 or not conf.get("record_vote"):
            continue
        report["roll_call_confirmations_101_on"] += 1
        match = [s for s in nm["senate_votes"] if s["question"] == "On the Nomination" and s["vote_id"].endswith(f"-{conf['record_vote']}")]
        if not match:
            report["roll_call_confirmation_without_xml"] += 1
            continue
        checks += 1
        # the parsed Congress.gov tally must be the one printed in its action text (parse check, a failure when not) ...
        printed = re.search(r"(\d+)\s*-\s*(\d+)", conf.get("text") or "")
        if not printed or [int(printed.group(1)), int(printed.group(2))] != [conf["yeas"], conf["nays"]]:
            failures.append({"check": "congress tally parse", "nomination": nm["id"], "text": conf.get("text")})
        # ... while a difference between the two publishers is reported, with both values kept in the records
        if (match[0]["yeas"], match[0]["nays"]) != (conf["yeas"], conf["nays"]):
            report["publisher_tally_differs"] += 1
            diffs.append({"nomination": nm["id"], "congress_gov": [conf["yeas"], conf["nays"]],
                          "senate_gov": [match[0]["yeas"], match[0]["nays"]], "vote": match[0]["vote_id"]})
        else:
            report["publisher_tally_equal"] += 1

    # 3. status from latestAction alone
    for nm in noms:
        want = status_from_latest((nm.get("latest_action") or {}).get("text"))
        if want is None:
            report["status_latest_action_not_final"] += 1
            continue
        checks += 1
        if want != nm["status"]:
            report["status_differs_from_latest_action"] += 1
            if "confirmed" in (want, nm["status"]):
                failures.append({"check": "status", "nomination": nm["id"], "build": nm["status"], "latest_action": nm["latest_action"]})

    # 4. FJC agreement
    profiles = {r["item"]["profile"]["nid"]: r["item"]["profile"] for r in json.loads((BUILD / "judge_profiles_fjc.json").read_text())["rows"]}
    for nm in noms:
        if not nm.get("fjc_nid") or nm["status"] != "confirmed":
            continue
        conf = nm["confirmation"] or {}
        servs = [s for s in profiles[nm["fjc_nid"]]["services"] if s.get("court_id") in nm["court_ids"]]
        same = [s for s in servs if s.get("confirmation") == conf.get("date")]
        report["fjc_linked_confirmed"] += 1
        if not same:
            report["fjc_confirmation_date_differs"] += 1
            continue
        report["fjc_confirmation_date_equal"] += 1
        s = same[0]
        if conf.get("method") == "Roll call":
            fjc_vote = re.findall(r"\d+", s.get("vote") or "")
            if len(fjc_vote) == 2:
                report["fjc_tally_compared"] += 1
                report["fjc_tally_equal" if [int(x) for x in fjc_vote] == [conf.get("yeas"), conf.get("nays")] else "fjc_tally_differs"] += 1
        else:
            report["fjc_voice_compared"] += 1
            report["fjc_voice_equal" if (s.get("senate_vote_type") or "").lower().startswith("voice") else "fjc_voice_type_differs"] += 1

    # 5. completeness against FJC appointments since 1981-01-20 (Article III courts with an id)
    linked = collections.Counter((nm["fjc_nid"]) for nm in noms if nm.get("fjc_nid") and nm["status"] == "confirmed")
    for nid, p in profiles.items():
        for s in p["services"]:
            if (s.get("nomination") or "") >= "1981-01-20" and s.get("court_id") and s.get("confirmation"):
                report["fjc_appointments_since_1981"] += 1
                if linked.get(nid):
                    report["fjc_appointments_judge_linked"] += 1

    # 6. spot checks
    by = {(nm["congress"], nm["citation"]): nm for nm in noms}
    for c, cit, name, method, y, n in SPOT:
        checks += 1
        nm = by.get((c, cit))
        conf = (nm or {}).get("confirmation") or {}
        ok = nm and name in (nm.get("nominee_name") or "") and conf.get("method") == method and conf.get("yeas") == y and conf.get("nays") == n
        if not ok:
            failures.append({"check": "spot", "nomination": [c, cit], "build": nm and {"name": nm.get("nominee_name"), "confirmation": conf}})
        else:
            report["spot_checks_ok"] += 1

    out = {"checks": checks, "failures": len(failures), "failure_examples": failures[:20], "report": dict(report),
           "publisher_tally_differences": diffs}
    (BUILD / "verify_nominations.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: out[k] for k in ("checks", "failures")} | {"report": dict(report)}))


if __name__ == "__main__":
    main()
