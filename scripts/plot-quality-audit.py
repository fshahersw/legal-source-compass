"""Export snapshot charts with explicit populations; requires matplotlib."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

root = Path("private/data/quality")
db = json.loads((root / "database-audit.json").read_text(encoding="utf-8"))
register = json.loads((root / "reference/federal-register-gap/manifest.json").read_text(encoding="utf-8"))
court = json.loads((root / "reference/uscourts-table-c-2025.json").read_text(encoding="utf-8"))
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, axes = plt.subplots(2, 2, figsize=(13, 9))
fig.patch.set_facecolor("#f6f5f1")
fig.suptitle("Legal Source Compass · evidence and update audit", fontsize=19, fontweight="bold", x=.06, ha="left")
fig.text(.06, .91, "Snapshot: October 2, 2026 UTC  |  Panels describe separate populations and periods", color="#4b5563")
format_count = FuncFormatter(lambda value, _: f"{int(value):,}")

ax = axes[0, 0]
counts = [db["totals"]["readyRecords"], db["totals"]["heldRecords"]]
bars = ax.barh(["Ready · 63 datasets", "Held · 8 datasets"], counts, color=["#21746b", "#bd7b2e"])
ax.bar_label(bars, labels=[f"{n:,}" for n in counts], padding=5)
ax.set_xlim(0, max(counts) * 1.28)
ax.xaxis.set_major_formatter(format_count)
ax.set_title("Imported database records by publication flag", loc="left", fontweight="bold")
ax.set_xlabel("5,272,705 imported rows; readiness is not an accuracy score", fontsize=9)

ax = axes[0, 1]
largest = sorted(db["datasets"], key=lambda r: r["actualRecords"], reverse=True)[:6][::-1]
bars = ax.barh([r["id"].replace("_", " ") for r in largest], [r["actualRecords"] for r in largest], color=["#21746b" if r["ready"] else "#bd7b2e" for r in largest])
ax.bar_label(bars, labels=[f'{r["actualRecords"]:,}' for r in largest], padding=5, fontsize=9)
ax.set_xlim(0, largest[-1]["actualRecords"] * 1.28)
ax.xaxis.set_major_formatter(format_count)
ax.set_title("Largest six imported collections", loc="left", fontweight="bold")
ax.set_xlabel("Rows can overlap in legal content; green ready / amber held", fontsize=9)

ax = axes[1, 0]
types = register["typeCounts"][::-1]
bars = ax.barh(["Final rule" if r["label"] == "Rule" else r["label"] for r in types], [r["count"] for r in types], color="#305d88")
ax.bar_label(bars, labels=[f'{r["count"]:,}' for r in types], padding=5)
ax.set_xlim(0, max(r["count"] for r in types) * 1.25)
ax.xaxis.set_major_formatter(format_count)
ax.set_title("Federal Register supplement · 3,045 entries", loc="left", fontweight="bold")
ax.set_xlabel("Published August 21–October 1, 2026; metadata index", fontsize=9)

ax = axes[1, 1]
x = list(range(3))
metrics = ["filed", "terminated", "pending"]
for shift, year, color in [(-.18, 2024, "#92a4b5"), (.18, 2025, "#305d88")]:
    bars = ax.bar([i + shift for i in x], [court["totals"][f"{key}{year}"] for key in metrics], width=.34, label=f"FY {year}", color=color)
    ax.bar_label(bars, labels=[f'{court["totals"][f"{key}{year}"]:,}' for key in metrics], fontsize=8, padding=4, rotation=90)
ax.set_xticks(x, ["Filed", "Terminated", "Pending at end"])
ax.set_ylim(0, max(court["totals"].values()) * 1.3)
ax.yaxis.set_major_formatter(format_count)
ax.legend(frameon=False, loc="upper left", ncol=2, fontsize=9)
ax.set_title("Official district court civil workload · Table C", loc="left", fontweight="bold")
ax.set_xlabel("94 districts; annual flows and end-period stock are not added", fontsize=9)

for ax in axes.flat:
    ax.set_facecolor("#f6f5f1")
    ax.grid(axis="x" if ax != axes[1, 1] else "y", alpha=.15)
    ax.set_axisbelow(True)
fig.subplots_adjust(left=.23, right=.96, top=.84, bottom=.14, wspace=.92, hspace=.54)
fig.text(.06, .045, "Sources: read-only corpus count audit; FederalRegister.gov API + GovInfo references; U.S. Courts Table C.\nSource bytes, qualifications, periods and reproducible pipelines are documented in corpus-audit-2026-10-02.md.", fontsize=9, color="#4b5563")
output = Path("docs/figures")
output.mkdir(parents=True, exist_ok=True)
for extension in ["png", "pdf"]:
    fig.savefig(output / f"corpus-quality-2026-10-02.{extension}", dpi=160, bbox_inches="tight")
print("Exported quality audit PNG and PDF")
