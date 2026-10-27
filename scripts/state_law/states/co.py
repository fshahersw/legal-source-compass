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
Re-checked 2026-10-27: leg.colorado.gov/laws/colorado-revised-statutes still links only LexisNexis; the OLLS agency
page and its Revisor of Statutes page on content.leg.colorado.gov link no olls.info page; olls.info resolves to
shared commercial hosting (DreamHost name servers), not the General Assembly's coleg.gov infrastructure; only
third-party sites attribute it to the OLLS. Held under the statute source rule (official publisher only), not
for caution: the publisher is unconfirmed (the Revisor of Statutes, OLLS, can confirm whether olls.info is theirs).
Unblocking: confirm olls.info as an OLLS publication (then a parser over the retained crs2026 title files, retained
mode), or a government-hosted current edition."""
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
    blocked=("Current text is linked by the General Assembly only on LexisNexis (commercial host, never fetched); the "
             "government host serves C.R.S. 2024 PDFs only (not current); olls.info's operator is unconfirmed — owner "
             "decision needed."),
)


def acquire(ctx: lib.RunContext) -> None:
    raise lib.Blocked(META.blocked)
