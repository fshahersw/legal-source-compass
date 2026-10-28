"""Builds database/contracts/documents-v2-sources.sql and its rollback on top of documents-v2-scope.sql.

The locator source change (source 'courtlistener-public-locator') was first written against the documents-v1.sql refresh
body. documents-v2-scope.sql replaces that body, so this script carries every locator hunk (v1 -> original v2-sources)
onto the scope body by exact, asserted line-block replacement: each hunk's old lines (or, for an insertion, the line
before it) must occur exactly once in the scope body. The rollback restores the scope body verbatim.
Run from the repository root:
  python scripts/documents/build_documents_v2_sources.py . <original v2-sources> <original v1>
(the originals are git show 2fbe58b1:database/contracts/documents-v2-sources.sql and
 git show 2fbe58b1:database/contracts/documents-v1.sql).
"""
import difflib
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
ORIG_SOURCES = Path(sys.argv[2]).read_text(encoding="utf-8").replace("\r\n", "\n")
ORIG_V1 = Path(sys.argv[3]).read_text(encoding="utf-8").replace("\r\n", "\n")
SCOPE = (ROOT / "database/contracts/documents-v2-scope.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
NL = "\n"


def block(text, name):
    m = re.search(r"create or replace function public\." + name + r"\(.*?\n(end )?\$\$;\n", text, re.S)
    assert m, name
    return m.group(0)


v1 = block(ORIG_V1, "documents_refresh_v1").splitlines(True)
loc = block(ORIG_SOURCES, "documents_refresh_v1").splitlines(True)
scope_refresh = block(SCOPE, "documents_refresh_v1")

DROP_V1 = "      pg_temp._doc_dk, pg_temp._doc_new;" + NL
DROP_SCOPE = "      pg_temp._doc_dk, pg_temp._doc_new, pg_temp._doc_mx;" + NL
ORDER_V1 = "   order by a.source_system, a.native_document_id, a.verified_at desc;" + NL
# the locator work-table analyze goes after the scope's master-docket evidence update
EVIDENCE_END = ("   where c.source_system = y.source_system and c.native_document_id = y.native_document_id"
                " and c.basis = 'docket_case';" + NL)

out = scope_refresh
for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=v1, b=loc, autojunk=False).get_opcodes():
    if tag == "equal":
        continue
    old = "".join(v1[i1:i2])
    new = "".join(loc[j1:j2])
    if old == DROP_V1:
        old, new = DROP_SCOPE, new.replace("pg_temp._doc_new,", "pg_temp._doc_new, pg_temp._doc_mx,")
    elif tag == "insert" and v1[i1 - 1] == ORDER_V1:
        old, new = EVIDENCE_END, EVIDENCE_END + new
    elif tag == "insert":  # anchor on the line(s) before, as many as make it unique
        k = 1
        while out.count("".join(v1[i1 - k:i1])) != 1 and k < 4:
            k += 1
        old = "".join(v1[i1 - k:i1])
        new = old + new
    n = out.count(old)
    assert n == 1, (tag, old[:120], n)
    out = out.replace(old, new)
assert "'govinfo', 'courtlistener-public-locator')" + NL + "     and a.native_case_id is not null" in out
assert "pg_temp._doc_new, pg_temp._doc_mx, pg_temp._doc_lseal, pg_temp._doc_ce;" in out
assert EVIDENCE_END + "  -- work tables have no statistics" in out

m = re.search(r"^(.*?)\ncreate or replace function public\.documents_refresh_v1", ORIG_SOURCES, re.S)
header = m.group(1)
OLD_TAIL = ("-- Rollback: documents-v2-sources.rollback.sql (four-source constraint and the documents-v1.sql refresh function)." + NL
            + "-- Apply after documents-v1.sql. Re-applying documents-v1.sql alone would restore the four-source function; re-apply" + NL
            + "-- this file after it.")
NEW_TAIL = ("-- Built on documents-v2-scope.sql (scripts/documents/build_documents_v2_sources.py): the refresh body is the scope" + NL
            + "-- body with the locator hunks above, so locator files of dockets no matter page lists also enter, as 'docket_case' with" + NL
            + "-- no MDL, or with the MDL an exact master-docket key names. Apply after documents-v1.sql and documents-v2-scope.sql," + NL
            + "-- then documents-v2-entry-flag.sql (it patches this body). Re-applying an earlier file restores its own body; re-apply" + NL
            + "-- the later files after it." + NL
            + "-- Rollback: documents-v2-sources.rollback.sql (four-source constraint and the documents-v2-scope.sql refresh function).")
assert header.count(OLD_TAIL) == 1
header = header.replace(OLD_TAIL, NEW_TAIL)
GRANTS = (NL + "revoke all on function public.documents_refresh_v1(text) from public, anon, authenticated;" + NL
          + "grant execute on function public.documents_refresh_v1(text) to service_role;" + NL + NL + "commit;" + NL)
fwd = header + NL + out + GRANTS
(ROOT / "database/contracts/documents-v2-sources.sql").write_text(fwd, encoding="utf-8", newline="\n")

ORIG_RB = (ROOT / "database/contracts/documents-v2-sources.rollback.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
rb_head = ORIG_RB[: ORIG_RB.index("create or replace function public.documents_refresh_v1")]
OLD_RB = ("-- 3. public.documents_refresh_v1 is the documents-v1.sql function again, verbatim (deployed text on 2026-10-27," + NL
          + "--    prosrc md5 e96f6c35586d24c7a4917988decc38c1).")
NEW_RB = "-- 3. public.documents_refresh_v1 is the documents-v2-scope.sql function again, verbatim."
if OLD_RB in rb_head:
    rb_head = rb_head.replace(OLD_RB, NEW_RB)
assert NEW_RB in rb_head
LOC_DELETE = "delete from documents.documents where source_system = 'courtlistener-public-locator';" + NL
ORPHANS = ("do $orphans$" + NL + "begin" + NL
           + "  -- citations rows of the removed filings (the citations run never prunes a document row that is gone)" + NL
           + "  if to_regclass('citations.edges') is not null then" + NL
           + "    delete from citations.edges e where e.citing_type = 'document'" + NL
           + "       and not exists (select 1 from documents.documents d where d.id = e.citing_id);" + NL
           + "  end if;" + NL
           + "  if to_regclass('citations.document_links') is not null then" + NL
           + "    delete from citations.document_links l where not exists (select 1 from documents.documents d where d.id = l.document_id);" + NL
           + "  end if;" + NL + "end $orphans$;" + NL)
if ORPHANS not in rb_head:
    assert rb_head.count(LOC_DELETE) == 1
    rb_head = rb_head.replace(LOC_DELETE, LOC_DELETE + ORPHANS)
(ROOT / "database/contracts/documents-v2-sources.rollback.sql").write_text(rb_head + scope_refresh + GRANTS, encoding="utf-8", newline="\n")
print("ok", len(fwd))
