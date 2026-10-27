"""Colorado — BLOCKED pending an owner decision.

The Office of Legislative Legal Services (OLLS) edits and publishes the Colorado Revised Statutes. Checked 2026-10-23:
- leg.colorado.gov/laws/colorado-revised-statutes says "Click here to access the Colorado Revised Statutes hosted by
  LexisNexis." and the OLLS page links "C.R.S. Online" to advance.lexis.com — a commercial host this project never
  fetches.
- The government host still serves the per-title PDFs of C.R.S. 2024
  (leg.colorado.gov/sites/default/files/images/olls/crs2024-title-13.pdf: 200, application/pdf); the 2025 and 2026
  paths return 404. C.R.S. 2024 predates the 2025 and 2026 sessions, so it is not current text.
- olls.info/crs/crs2026-title-NN.htm (HTML per title) is widely cited as the OLLS's own site, and this project holds
  a capture of it (47 title files, 2026-10). No government page found links to olls.info, so its operator is not
  confirmed, and the host reset connections when probed; it is not used until the owner confirms it is OLLS-operated.
Unblocking: confirm olls.info as an OLLS publication (then a parser over the retained crs2026 title files, retained
mode), or a government-hosted current edition.

Re-checked 2026-10-27 (release-state-codes-staged-not-projected):
- The operator question is answered. The General Assembly's own OLLS page
  content.leg.colorado.gov/agencies/office-legislative-legal-services/2026-crs-titles-download ("2026 CRS Titles for
  Download", "Current with the changes made by amendments, additions, and repeals to Colorado Revised Statutes by the
  Seventy-fifth General Assembly at its Second Regular Session in 2026.") links every title as
  olls.info/crs/crs2026-title-NN.{htm,pdf,docx} and the whole set as olls.info/crs/crs2026-htm.zip. olls.info is the
  OLLS distribution host, so the retained capture is the official publisher's text.
- What still holds it is the publisher's own terms, not provenance: the CRS page offers those copies "for personal
  use", and its "Colorado Revised Statutes Data" page says section 2-5-118, C.R.S. requires anyone seeking to
  publish, reprint, or distribute the statutes using the official statutory database to submit a statement to the
  Committee on Legal Services (no fee and no copyright claim since March 4, 2016; republication must be accurate and
  must not claim to be the official statutes). Next step is the owner's: file that statement (Revisor of Statutes),
  or request the SGML data set; then add a parser over the crs2026 HTM titles (retained mode) and load."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from state_law import lib  # noqa: E402

META = lib.StateMeta(
    state="CO", code_name="Colorado Revised Statutes", publisher="Colorado General Assembly — Office of Legislative Legal Services",
    publisher_url="https://leg.colorado.gov/laws/colorado-revised-statutes", official_source=True, access="blocked",
    hosts=(), parser="co-blocked/1",
    codes=(lib.Code("CRS", "Colorado Revised Statutes", "Colo. Rev. Stat. § {n}",
                    lib.alias_patterns(["Colo. Rev. Stat. Ann.", "Colo. Rev. Stat.", "C.R.S.", "CRS"])),),
    blocked=("olls.info is confirmed as the OLLS host (linked from content.leg.colorado.gov '2026 CRS Titles for "
             "Download'), but the publisher offers those copies 'for personal use' and section 2-5-118, C.R.S. asks "
             "republishers to file a statement with the Committee on Legal Services; owner step, then a crs2026 HTM "
             "parser. No commercial host is used."),
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
