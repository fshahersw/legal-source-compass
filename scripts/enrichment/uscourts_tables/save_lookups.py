"""Save the court-id lookups (read-only SELECTs on the corpus, run once, pasted here) used to validate row labels -> court ids.

Districts: record ids and titles of the corpus dataset court_stats_district_nos (the 94 districts).
Bankruptcy courts: court_spine ids ending in "b" with their titles (excluding ptab, ttab, mspb, which are not bankruptcy
courts). A bankruptcy court is linked to its district only when the court names match exactly after the prefix
("D. Arizona" with "D. Arizona"); no other pairing is made. Circuits: court_spine circuit ids and titles.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "private" / "build" / "uscourts_tables" / "lookups" / "court_ids.json"

DISTRICT_SUFFIX = """akd=D. Alaska;almd=M.D. Alabama;alnd=N.D. Alabama;alsd=S.D. Alabama;ared=E.D. Arkansas;arwd=W.D. Arkansas;azd=D. Arizona;
cacd=C.D. California;caed=E.D. California;cand=N.D. California;casd=S.D. California;cod=D. Colorado;ctd=D. Connecticut;
dcd=District of Columbia;ded=D. Delaware;flmd=M.D. Florida;flnd=N.D. Florida;flsd=S.D. Florida;gamd=M.D. Georgia;gand=N.D. Georgia;
gasd=S.D. Georgia;gud=D. Guam;hid=D. Hawaii;iand=N.D. Iowa;iasd=S.D. Iowa;idd=D. Idaho;ilcd=C.D. Illinois;ilnd=N.D. Illinois;
ilsd=S.D. Illinois;innd=N.D. Indiana;insd=S.D. Indiana;ksd=D. Kansas;kyed=E.D. Kentucky;kywd=W.D. Kentucky;laed=E.D. Louisiana;
lamd=M.D. Louisiana;lawd=W.D. Louisiana;mad=D. Massachusetts;mdd=D. Maryland;med=D. Maine;mied=E.D. Michigan;miwd=W.D. Michigan;
mnd=D. Minnesota;moed=E.D. Missouri;mowd=W.D. Missouri;msnd=N.D. Mississippi;mssd=S.D. Mississippi;mtd=D. Montana;
nced=E.D. North Carolina;ncmd=M.D. North Carolina;ncwd=W.D. North Carolina;ndd=D. North Dakota;ned=D. Nebraska;nhd=D. New Hampshire;
njd=D. New Jersey;nmd=D. New Mexico;nmid=Northern Mariana Islands;nvd=D. Nevada;nyed=E.D. New York;nynd=N.D. New York;nysd=S.D. New York;
nywd=W.D. New York;ohnd=N.D. Ohio;ohsd=S.D. Ohio;oked=E.D. Oklahoma;oknd=N.D. Oklahoma;okwd=W.D. Oklahoma;ord=D. Oregon;
paed=E.D. Pennsylvania;pamd=M.D. Pennsylvania;pawd=W.D. Pennsylvania;prd=D. Puerto Rico;rid=D. Rhode Island;scd=D. South Carolina;
sdd=D. South Dakota;tned=E.D. Tennessee;tnmd=M.D. Tennessee;tnwd=W.D. Tennessee;txed=E.D. Texas;txnd=N.D. Texas;txsd=S.D. Texas;
txwd=W.D. Texas;utd=D. Utah;vaed=E.D. Virginia;vawd=W.D. Virginia;vid=Virgin Islands;vtd=D. Vermont;waed=E.D. Washington;
wawd=W.D. Washington;wied=E.D. Wisconsin;wiwd=W.D. Wisconsin;wvnd=N.D. West Virginia;wvsd=S.D. West Virginia;wyd=D. Wyoming"""

BANKRUPTCY_SUFFIX = """cacb=C.D. California;ilcb=C.D. Illinois;akb=D. Alaska;arb=D. Arizona;cob=D. Colorado;ctb=D. Connecticut;deb=D. Delaware;
gub=D. Guam;hib=D. Hawaii;idb=D. Idaho;ksb=D. Kansas;meb=D. Maine;mdb=D. Maryland;mab=D. Massachusetts;mnb=D. Minnesota;mtb=D. Montana;
nhb=D. New Hampshire;nmb=D. New Mexico;ndb=D. North Dakota;orb=D. Oregon;prb=D. Puerto Rico;scb=D. South Carolina;sdb=D. South Dakota;
utb=D. Utah;vtb=D. Vermont;vib=D. Virgin Islands;dcb=District of Columbia;areb=E.D. Arkansas;caeb=E.D. California;kyeb=E.D. Kentucky;
laeb=E.D. Louisiana;mieb=E.D. Michigan;moeb=E.D. Missouri;nyeb=E.D. New York;okeb=E.D. Oklahoma;paeb=E.D. Pennsylvania;
tneb=E.D. Tennessee;txeb=E.D. Texas;vaeb=E.D. Virginia;waeb=E.D. Washington;wieb=E.D. Wisconsin;almb=M.D. Alabama;gamb=M.D. Georgia;
lamb=M.D. Louisiana;ncmb=M.D. North Carolina;pamb=M.D. Pennsylvania;tnmb=M.D. Tennessee;alnb=N.D. Alabama;canb=N.D. California;
flnb=N.D. Florida;ganb=N.D. Georgia;ilnb=N.D. Illinois;innb=N.D. Indiana;ianb=N.D. Iowa;msnb=N.D. Mississippi;nynb=N.D. New York;
ohnb=N.D. Ohio;oknb=N.D. Oklahoma;wvnb=N.D. West Virginia;nmib=Northern Mariana Islands;casb=S.D. California;flsb=S.D. Florida;
gasb=S.D. Georgia;ilsb=S.D. Illinois;insb=S.D. Indiana;iasb=S.D. Iowa;mssb=S.D. Mississippi;nysb=S.D. New York;ohsb=S.D. Ohio;
txsb=S.D. Texas;wvsb=S.D. West Virginia;arwb=W.D. Arkansas;kywb=W.D. Kentucky;miwb=W.D. Michigan;mowb=W.D. Missouri;nywb=W.D. New York;
ncwb=W.D. North Carolina;okwb=W.D. Oklahoma;pawb=W.D. Pennsylvania;tnwb=W.D. Tennessee;txwb=W.D. Texas;vawb=W.D. Virginia;
wawb=W.D. Washington;wiwb=W.D. Wisconsin;nvb=D. Nevada;njb=D. New Jersey;rib=D. Rhode Island;wyb=D. Wyoming;nceb=E.D. North Carolina;
flmb=M.D. Florida;txnb=N.D. Texas;alsb=S.D. Alabama;lawb=W.D. Louisiana"""

# Former districts some tables still print (court_spine id -> name): Judicial Business S-19 prints "IL,E", footnoted "No longer a
# separate district"; the directory's record for it is "District Court, E.D. Illinois" (id illinoised).
HISTORICAL_DISTRICTS = {"illinoised": "E.D. Illinois (no longer a separate district)"}

CIRCUIT_TITLE = {
    "cadc": "Court of Appeals for the D.C. Circuit", "ca1": "Court of Appeals for the First Circuit", "ca2": "Court of Appeals for the Second Circuit",
    "ca3": "Court of Appeals for the Third Circuit", "ca4": "Court of Appeals for the Fourth Circuit", "ca5": "Court of Appeals for the Fifth Circuit",
    "ca6": "Court of Appeals for the Sixth Circuit", "ca7": "Court of Appeals for the Seventh Circuit", "ca8": "Court of Appeals for the Eighth Circuit",
    "ca9": "Court of Appeals for the Ninth Circuit", "ca10": "Court of Appeals for the Tenth Circuit", "ca11": "Court of Appeals for the Eleventh Circuit",
    "cafc": "Court of Appeals for the Federal Circuit",
}


def pairs(block):
    out = {}
    for item in block.replace("\n", "").split(";"):
        if "=" in item:
            k, v = item.split("=", 1)
            out[k.strip()] = v.strip().rstrip(".")
    return out


def build():
    districts = pairs(DISTRICT_SUFFIX)
    bankruptcy = pairs(BANKRUPTCY_SUFFIX)
    by_name = {}
    for bid, name in bankruptcy.items():
        by_name.setdefault(name, []).append(bid)
    district_to_bankruptcy = {}
    for did, name in districts.items():
        ids = by_name.get(name, [])
        if len(ids) == 1:
            district_to_bankruptcy[did] = ids[0]
    return {
        "districts": sorted(districts),
        "district_titles": {**{k: f"U.S. District Court, {v}" for k, v in districts.items()},
                            **{k: f"U.S. District Court, {v}" for k, v in HISTORICAL_DISTRICTS.items()}},
        "historical_districts": sorted(HISTORICAL_DISTRICTS),
        "bankruptcy": sorted(bankruptcy),
        "bankruptcy_titles": {k: f"U.S. Bankruptcy Court, {v}" for k, v in bankruptcy.items()},
        "district_to_bankruptcy": district_to_bankruptcy,
        "circuits": sorted(CIRCUIT_TITLE, key=lambda c: (c == "cafc", c != "cadc", int(c[2:]) if c[2:].isdigit() else 0)),
        "circuit_titles": CIRCUIT_TITLE,
        "source": "read-only SELECTs on corpus datasets court_stats_district_nos and court_spine, 2026-10-23",
    }


if __name__ == "__main__":
    doc = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1))
    print(len(doc["districts"]), "districts;", len(doc["bankruptcy"]), "bankruptcy ids;", len(doc["district_to_bankruptcy"]), "district-bankruptcy pairs;", len(doc["circuits"]), "circuits")
