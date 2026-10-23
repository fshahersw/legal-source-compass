"""Fetch Federal Reserve structure/market pages considered for the stream (unchanged, with manifest)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regfin_http as h  # noqa: E402

FRB = "https://www.federalreserve.gov"
PAGES = {
    "pages/frb_lbr.html": FRB + "/releases/lbr/",
    "pages/frb_fhc.html": FRB + "/supervisionreg/fhc.htm",
    "pages/frb_ordersbhc.html": FRB + "/supervisionreg/ordersbhc.htm",
    "pages/frb_legal_developments.html": FRB + "/supervisionreg/legal-developments.htm",
    "pages/frb_resolution_plans.html": FRB + "/supervisionreg/resolution-plans.htm",
    "pages/frb_iba.html": FRB + "/releases/iba/default.htm",
    "pages/frb_suds.html": FRB + "/supervisionreg/suds.htm",
    "pages/sec_ia_stats_supporting.html": "https://www.sec.gov/data-research/statistics-data-visualizations/investment-adviser-statistics",
}

if __name__ == "__main__":
    for dest, url in PAGES.items():
        try:
            status, body = h.fetch(url, dest, refresh="--refresh" in sys.argv)
            print(status, len(body), url)
        except Exception as err:
            print("ERR", type(err).__name__, url, str(err)[:120])
