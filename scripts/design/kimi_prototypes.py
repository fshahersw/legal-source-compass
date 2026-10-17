"""Ask Kimi K3 (Fireworks) for design prototypes of the court, judge and MDL pages.

Kimi only proposes the presentational component; data wiring, accessibility review and verification happen in the
repository. The key comes only from FIREWORKS_API_KEY. Output: private/kimi/<name>.tsx plus the raw response JSON.
Usage: FIREWORKS_API_KEY=... python3 scripts/design/kimi_prototypes.py [court judge mdl]
"""
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "private" / "kimi"
MODEL = "accounts/fireworks/models/kimi-k3"

SYSTEM = """You are a senior product designer-engineer producing one production-quality React 19 + TypeScript component
for a legal research workspace used by litigation attorneys at a mass-tort firm. Visual language: restrained, precise,
dense but breathable, legal-professional; strong typographic hierarchy; no gradients, no glassmorphism, no emoji, no
decorative AI sparkles, no marketing hero sections, no oversized cards. Think Bloomberg terminal clarity with the calm of
a well-set law review page.

Hard technical rules:
- Output ONLY one TSX file in a single ```tsx fenced block, nothing else.
- Imports allowed: react, lucide-react, recharts, and `import { Link } from "@tanstack/react-router"`.
- Style with Tailwind v4 utility classes using ONLY these theme tokens (never hex/rgb colors, never arbitrary color values):
  bg-background bg-surface bg-muted bg-card bg-primary bg-accent bg-secondary text-foreground text-muted-foreground
  text-primary text-primary-foreground text-success text-warning text-destructive border-border border-border-strong
  ring-ring font-sans font-display font-mono shadow-card rounded-md rounded-lg. Opacity modifiers like bg-primary/10 are fine.
  For recharts colors use CSS variables: "var(--primary)", "var(--muted-foreground)", "var(--border)", "var(--success)",
  "var(--warning)", "var(--destructive)", "var(--accent)".
- Text sizes: text-xs for metadata, text-sm body, text-base/lg for section titles, text-2xl max for the page title.
  Use tabular-nums for every number.
- The component receives fully loaded data as props; do not fetch. Handle empty arrays and null values gracefully with
  the literal text "Not recorded". Never invent data, never hardcode example numbers.
- Accessibility: semantic sections with aria-labels, real <table> for tabular data with <th scope>, visible focus styles,
  buttons for interactive controls, sufficient contrast through the tokens above.
- Responsive from 1024px to 1600px wide (the app shell already provides a 240px sidebar); single column below lg.
- Keep it to one file under ~550 lines, with small internal subcomponents. Use useMemo/useState only where needed.
- Every chart has isAnimationActive={false}.
"""

TYPES = {
    "court": """
type NatureOfSuit = { category: string; filings: number; prior: number | null; change_pct: number | null };
type CourtMdl = { mdl: number; title: string; pending: number; total: number; judge: string | null; type: string | null };
type CourtAnalytics = {
  court_id: string; name: string; years: number[];              // e.g. [2021..2026], fiscal years ending June 30
  metrics: Record<string, (number | null)[]>;                     // keys: filings, terminations, pending, judgeships,
    // vacant_judgeship_months, per_judge_total, per_judge_civil, per_judge_felony, per_judge_pending,
    // per_judge_weighted_filings, per_judge_terminations, per_judge_trials, median_months_felony, median_months_civil,
    // median_months_civil_to_trial, civil_over_3y_count, civil_over_3y_pct  (arrays aligned with years)
  standing: Record<string, { us: number | null; circuit: number | null }>;   // national (of 94) and circuit rank
  percentile: Record<string, number>;   // 0-100, higher = faster / lighter workload (already direction-adjusted)
  nature_of_suit: NatureOfSuit[];       // civil filings by nature of suit with change vs prior year
  criminal: Record<string, number>; civil_total: number | null;
  mdls: CourtMdl[]; mdl_actions: number; mdl_as_of: string;
};
type CourtJudge = { nid: string; name: string; status: string; president: string; party: string; commission: string | null;
  mdls: number; mdlActions: number; profileId: string | null };
type NationalDistribution = Record<string, { min: number; median: number; max: number }>;
type Props = { title: string; system: string; state: string | null; court: CourtAnalytics; judges: CourtJudge[];
  distributions: NationalDistribution; sourceUrl: string };
export function CourtProfilePrototype(props: Props): JSX.Element
Links: judge -> <Link to="/judges/$id" params={{ id: profileId }}> when profileId; MDL -> <Link to="/records/$dataset/$id" params={{ dataset: "mdl_analytics", id: String(mdl) }}>.
""",
    "judge": """
type FjcService = { court: string; court_id: string | null; title: string; president: string; party: string;
  aba_rating: string | null; nomination: string | null; confirmation: string | null; vote: string | null;
  commission: string | null; chief_begin: string | null; chief_end: string | null; senior_status: string | null;
  termination: string | null; termination_date: string | null };
type FjcProfile = { nid: string; name: string; birth_year: number | null; birth_place: string | null; services: FjcService[];
  current_court_id: string | null; status: string; education: { school: string; degree: string | null; year: string | null }[];
  career: string | null;               // semicolon-separated career entries from the FJC directory
  other_federal_service: string[]; years_service: number | null; age: number | null;
  mdls: { mdl: number; title: string; pending: number; type: string | null }[];
  court_workload: Record<string, number | null> | null;   // same metric keys as a district court profile, latest year
  judge_profile_id: string | null; cl_person_id: string | null };
type Props = { profile: FjcProfile; fjcUrl: string };
export function JudgeProfilePrototype(props: Props): JSX.Element
Links: court -> <Link to="/courts/$id" params={{ id: court_id }}>; MDL -> <Link to="/records/$dataset/$id" params={{ dataset: "mdl_analytics", id: String(mdl) }}>.
""",
    "mdl": """
type MdlPoint = { date: string; pending: number; total: number };   // monthly JPML reports, ISO dates
type MdlRow = { mdl: number; title: string; type: string | null; massTort: boolean; status: "pending" | "terminated" | "no_longer_listed";
  district: string | null; judge: string | null; pending: number; total: number; change1m: number | null;
  change3m: number | null; change12m: number | null; new12m: number | null; resolved12m: number | null;
  ageYears: number | null; growth: string; dateTransferred: string | null; dateClosed: string | null; rank: number | null;
  sharePct: number | null; series: MdlPoint[] };
type Signal = { product: string; kind: "drug" | "device" | "food" | "cosmetic" | "vehicle"; source: string; caveat: string;
  eventTotal: number | null; eventsByYear: Record<string, number>; breakdown: Record<string, number>;
  topTerms: { term: string; count: number }[]; recallTotal: number | null;
  recentRecalls: { recall_number?: string | null; classification?: string | null; report_date?: string | null;
    recalling_firm?: string | null; reason_for_recall?: string | null }[] } | null;
type Props = { mdl: MdlRow; signal: Signal; peers: MdlRow[] /* other pending MDLs of the same type, for context */ };
export function MdlDossierPrototype(props: Props): JSX.Element
A "dossier" page for one MDL: litigation trajectory, momentum, position among peers, and (when present) the product
safety signal with its caveat shown verbatim. Links: peer MDL -> <Link to="/prototypes/mdl/$id" params={{ id: String(mdl) }}>.
""",
}

BRIEFS = {
    "court": "Design a federal district court profile page: identity header, a caseload 'vital signs' strip with national-range position markers, a six-year trend, a nature-of-suit breakdown emphasising personal injury/product liability, the court's pending MDLs, and its sitting judges.",
    "judge": "Design a federal judge profile page: identity and status, appointment record (president, party, ABA rating, confirmation vote), a service timeline across courts, education and career, the judge's pending MDL docket, and their court's workload context.",
    "mdl": "Design an MDL dossier page: header with status, judge and court; trajectory chart of pending vs total actions; momentum metrics (1/3/12-month change, new vs resolved); rank and share among peers with a compact peer comparison; and a product-safety signal panel (reports per year, outcomes, top terms, recent recalls) when signal is not null.",
}


def ask(name):
    body = {
        "model": MODEL, "max_tokens": 16362, "top_k": 40, "presence_penalty": 0, "frequency_penalty": 0,
        "reasoning_effort": "high",
        # Streamed so the connection carries bytes during long reasoning; idle connections are dropped upstream.
        "stream": True,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": f"{BRIEFS[name]}\n\nData contract (TypeScript):\n{TYPES[name]}"}],
    }
    request = urllib.request.Request(
        "https://api.fireworks.ai/inference/v1/chat/completions", data=json.dumps(body).encode(),
        headers={"Accept": "text/event-stream", "Content-Type": "application/json", "Authorization": f"Bearer {os.environ['FIREWORKS_API_KEY']}"},
        method="POST")
    parts, reasoning, usage = [], [], None
    with urllib.request.urlopen(request, timeout=1800) as response:
        for raw in response:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            chunk = json.loads(payload)
            usage = chunk.get("usage") or usage
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                parts.append(delta.get("content") or "")
                reasoning.append(delta.get("reasoning_content") or "")
    data = {"model": MODEL, "usage": usage, "reasoning": "".join(reasoning), "content": "".join(parts)}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.response.json").write_text(json.dumps(data, indent=1))
    content = data["content"]
    match = re.search(r"```tsx\s*(.*?)```", content, re.S)
    code = match.group(1) if match else content
    (OUT / f"{name}.tsx").write_text(code)
    return name, len(code), data.get("usage")


def main():
    names = sys.argv[1:] or list(BRIEFS)
    with ThreadPoolExecutor(max_workers=3) as pool:
        for name, size, usage in pool.map(ask, names):
            print(json.dumps({"page": name, "chars": size, "usage": usage}))


if __name__ == "__main__":
    main()
