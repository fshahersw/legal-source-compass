/**
 * The company Overview as a defendant dossier (analyst-console layout): what the company is exposed to in the MDLs its
 * own filings name it in, what it has booked and disclosed for litigation, and what it has to pay with, side by side.
 *
 * Grounding rules (AGENTS.md, exposure.ts):
 * - Exposure counts only tier A or B links read as defendant; pending actions are MDL-wide (shared with every
 *   co-defendant) and never shown as the company's own share.
 * - Litigation figures are the company-wide XBRL loss-contingency facts it filed, not MDL reserves.
 * - No settlement value or liability is modelled or estimated here. A ratio is shown only when both figures are filed
 *   for the same fiscal year; anything else is "Not recorded".
 */
import { Link } from "@tanstack/react-router";
import { Quote } from "lucide-react";
import { ChartFrame, RankedBars, type ChartSource, type TableSpec } from "@/components/charts";
import { KpiStrip } from "@/components/kit/KpiCard";
import { Card } from "@/components/kit/Card";
import { cn } from "@/lib/utils";
import {
  mdlTitle,
  money,
  NOT_RECORDED,
  pct,
  signedPct,
  TIER_LABEL,
  type CompanyDetail,
  type CompanyLink,
  type CompanySummary,
} from "./companyData";
import { latestValue, type LatestValue, type Statements } from "./companyStatements";
import { exposureSentence, uiExposure } from "./exposure";
import { TierBadge } from "./CompanyUi";

const XBRL: ChartSource = {
  label: "SEC XBRL company facts",
  url: "https://www.sec.gov/edgar/sec-api-documentation",
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** a ÷ b × 100 when both are filed for the same fiscal year and b is positive. */
function sameYearPct(
  a: { value: number; fy: number } | null,
  b: { value: number; fy: number } | null,
): number | null {
  if (!a || !b || a.fy !== b.fy || !finite(a.value) || !finite(b.value) || b.value <= 0)
    return null;
  return (a.value / b.value) * 100;
}

type Figure = { value: number; fy: number; unit: string | null };

function fromLatest(v: LatestValue | null): Figure | null {
  return v && v.period.q == null ? { value: v.value, fy: v.period.fy, unit: v.unit } : null;
}

function annual(s: Statements | null, key: string): Figure | null {
  return s ? fromLatest(latestValue(s, key, "annual")) : null;
}

/** The annual value of a statement line for one fiscal year (null when not filed for that year). */
function annualAt(s: Statements | null, key: string, fy: number): number | null {
  if (!s) return null;
  const line = s.lines[key];
  if (!line) return null;
  const i = s.annualPeriods.findIndex((p) => p.fy === fy && p.q == null);
  const c = i >= 0 ? line.annual[i] : null;
  return c ? c.v : null;
}

export type DossierFigures = {
  fy: number | null;
  unit: string | null;
  liquidity: number | null;
  fcf: number | null;
  shareholderReturns: number | null;
  longTermDebt: number | null;
  accrual: Figure | null;
  possibleLoss: Figure | null;
  legalPayments: Figure | null;
  revenue: Figure | null;
};

/** The latest annual figures the dossier compares, all for the fiscal year of the latest filed cash balance. */
export function dossierFigures(
  s: Statements | null,
  summary: CompanySummary | null,
): DossierFigures {
  const cash = annual(s, "cash");
  const fy = cash?.fy ?? summary?.latest.cash?.fy ?? null;
  const unit = cash?.unit ?? summary?.currency ?? null;
  const sti = fy != null ? annualAt(s, "short_term_investments", fy) : null;
  const cashValue = cash?.value ?? summary?.latest.cash?.value ?? null;
  const liquidity = cashValue != null ? cashValue + (sti ?? 0) : null;
  const fcf = fy != null ? annualAt(s, "fcf", fy) : null;
  const div = fy != null ? annualAt(s, "dividends", fy) : null;
  const buy = fy != null ? annualAt(s, "buybacks", fy) : null;
  const shareholderReturns =
    div != null || buy != null ? Math.abs(div ?? 0) + Math.abs(buy ?? 0) : null;
  const longTermDebt = fy != null ? annualAt(s, "long_term_debt", fy) : null;
  const pick = (k: "litigation_accrual" | "possible_loss" | "legal_payments" | "revenue") => {
    const p = summary?.latest[k];
    return p ? { value: p.value, fy: p.fy, unit: p.unit } : null;
  };
  return {
    fy,
    unit,
    liquidity,
    fcf,
    shareholderReturns,
    longTermDebt,
    accrual: pick("litigation_accrual"),
    possibleLoss: pick("possible_loss"),
    legalPayments: pick("legal_payments"),
    revenue: pick("revenue"),
  };
}

/** The exposure row: what the company's own filings tie it to, and what it booked for litigation. */
export function ExposureStrip({ summary }: { summary: CompanySummary }) {
  const ui = uiExposure(summary.mdls);
  const acc = summary.latest.litigation_accrual;
  const pl = summary.latest.possible_loss;
  const lp = summary.latest.legal_payments;
  const items = [
    {
      key: "mdls",
      label: "Pending MDLs naming it",
      value: String(ui.namedPendingMdls),
      meta: ui.strongestTier ? `Strongest evidence: tier ${ui.strongestTier}` : "No counted MDL",
    },
    {
      key: "actions",
      label: "Pending actions in those MDLs",
      value: ui.namedPendingActions != null ? ui.namedPendingActions.toLocaleString("en-US") : null,
      meta: "MDL-wide, shared with co-defendants",
      delta:
        ui.change12m != null
          ? {
              value: ui.change12m,
              kind: "absolute" as const,
              text: `${ui.change12m > 0 ? "+" : ui.change12m < 0 ? "−" : ""}${Math.abs(ui.change12m).toLocaleString("en-US")}`,
              detail: "in 12 months",
            }
          : null,
    },
    {
      key: "accrual",
      label: "Litigation accrual",
      value: acc ? money(acc.value, acc.unit) : null,
      meta: acc
        ? `FY${acc.fy} · ${summary.accrualCurrent ? `YoY ${signedPct(summary.accrualYoyPct)}` : "not current"}`
        : "Not tagged in XBRL",
    },
    {
      key: "accrual-pct",
      label: "Accrual % of revenue",
      value: summary.accrualCurrent ? pct(summary.accrualPctRevenue, 2) : null,
      meta: "Same fiscal year and unit",
    },
    {
      key: "possible",
      label: "Disclosed possible loss",
      value: pl ? money(pl.value, pl.unit) : null,
      meta: pl ? `FY${pl.fy} · estimate the company filed` : "No estimate tagged",
    },
    {
      key: "payments",
      label: "Legal settlement payments",
      value: lp ? money(lp.value, lp.unit) : null,
      meta: lp ? `FY${lp.fy}` : "Not tagged in XBRL",
    },
  ];
  return <KpiStrip label="Litigation exposure" items={items} />;
}

/**
 * Ability to pay: the company's resources against the litigation figures it filed, on one scale, for the fiscal year
 * of its latest cash balance (litigation figures carry their own year in the table).
 */
export function AbilityToPay({
  statements,
  summary,
}: {
  statements: Statements | null;
  summary: CompanySummary | null;
}) {
  const f = dossierFigures(statements, summary);
  const unit = f.unit;
  const fyLabel = f.fy != null ? `FY${f.fy}` : "latest fiscal year";
  const rows: {
    id: string;
    label: string;
    value: number | null;
    fy: number | null;
    group: string;
  }[] = [
    {
      id: "liq",
      label: "Cash and short-term investments",
      value: f.liquidity,
      fy: f.fy,
      group: "Resources",
    },
    { id: "fcf", label: "Free cash flow", value: f.fcf, fy: f.fy, group: "Resources" },
    {
      id: "ret",
      label: "Dividends and buybacks",
      value: f.shareholderReturns,
      fy: f.fy,
      group: "Resources",
    },
    {
      id: "acc",
      label: "Litigation accrual",
      value: f.accrual?.value ?? null,
      fy: f.accrual?.fy ?? null,
      group: "Litigation",
    },
    {
      id: "pl",
      label: "Disclosed possible loss",
      value: f.possibleLoss?.value ?? null,
      fy: f.possibleLoss?.fy ?? null,
      group: "Litigation",
    },
    {
      id: "pay",
      label: "Legal settlement payments",
      value: f.legalPayments?.value ?? null,
      fy: f.legalPayments?.fy ?? null,
      group: "Litigation",
    },
  ];
  const liq = f.liquidity != null && f.fy != null ? { value: f.liquidity, fy: f.fy } : null;
  const fcf = f.fcf != null && f.fy != null ? { value: f.fcf, fy: f.fy } : null;
  const ratios = [
    { label: "Accrual ÷ cash and short-term investments", value: sameYearPct(f.accrual, liq) },
    { label: "Accrual ÷ free cash flow", value: sameYearPct(f.accrual, fcf) },
    { label: "Settlement payments ÷ free cash flow", value: sameYearPct(f.legalPayments, fcf) },
    {
      label: "Possible loss ÷ cash and short-term investments",
      value: sameYearPct(f.possibleLoss, liq),
    },
  ];
  const recorded = rows.filter((r) => r.value != null && r.value > 0);
  const table: TableSpec = {
    caption: "Resources and litigation figures the company filed",
    columns: [
      { label: "Figure", align: "left" },
      { label: "Group", align: "left" },
      { label: "Fiscal year", align: "left" },
      { label: "Value" },
    ],
    rows: rows.map((r) => ({
      key: r.id,
      cells: [r.label, r.group, r.fy != null ? `FY${r.fy}` : NOT_RECORDED, money(r.value, unit)],
    })),
  };
  const fmt = {
    full: (v: number | null | undefined) => money(v, unit),
    tick: (v: number) => money(v, unit),
    delta: (d: number) => money(d, unit),
  };
  return (
    <ChartFrame
      title="Ability to pay: resources against booked and disclosed litigation"
      subtitle={`${unit ?? "Reported unit"} · resources for ${fyLabel}; litigation figures as filed, company-wide`}
      sources={[XBRL]}
      status={
        recorded.length >= 2
          ? { kind: "ready" }
          : {
              kind: "empty",
              reason: "Fewer than two of these figures are tagged in this company's XBRL facts.",
            }
      }
      table={table}
      notes={[
        "Litigation accrual and possible loss are the company's total loss-contingency figures, not reserves for a particular MDL.",
        "Ratios are shown only when both figures are filed for the same fiscal year. Nothing here models a settlement value.",
        "Dividends and buybacks show cash the company chose to return to shareholders in the year.",
      ]}
      minHeight={250}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <RankedBars
          items={recorded.map((r) => ({
            id: r.id,
            label: r.label,
            value: r.value,
            note: r.fy != null ? `FY${r.fy}` : undefined,
          }))}
          formatter={fmt}
          ariaLabel="Company resources against its litigation figures"
        />
        <dl className="m-0 grid content-start gap-2">
          {ratios.map((r) => (
            <div key={r.label} className="rounded-lg border border-border bg-muted/50 px-3 py-2">
              <dt className="text-meta text-muted-foreground">{r.label}</dt>
              <dd className="m-0 text-kpi-sm text-foreground">
                {r.value == null ? (
                  <span className="text-[13px] font-medium text-muted-foreground">
                    Not recorded
                  </span>
                ) : (
                  `${r.value < 10 ? r.value.toFixed(1) : Math.round(r.value).toLocaleString("en-US")}%`
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </ChartFrame>
  );
}

/** The pending MDLs the company's filings name it in, largest docket first, each with its evidence tier. */
export function NamedMdls({ d }: { d: CompanyDetail }) {
  const links = [...d.links]
    .filter((l) => l.status === "pending")
    .sort((a, b) => (b.pending ?? -1) - (a.pending ?? -1));
  const terminated = d.links.length - links.length;
  const max = Math.max(0, ...links.map((l) => l.pending ?? 0));
  return (
    <Card as="section" aria-labelledby="named-mdls" className="flex h-full flex-col">
      <div className="px-3.5 pt-3 pb-2">
        <h3 id="named-mdls" className="text-label text-foreground">
          Pending MDLs its filings name
        </h3>
        <p className="mt-0.5 text-meta text-muted-foreground">
          {exposureSentence(uiExposure(d.summary.mdls))}
          {terminated > 0 ? ` · ${terminated} terminated or no longer listed` : ""}
        </p>
      </div>
      {links.length ? (
        <ul
          className="m-0 flex-1 list-none space-y-0.5 overflow-y-auto px-2 pb-2"
          style={{ maxHeight: 360 }}
        >
          {links.map((l) => (
            <NamedRow key={l.mdl} l={l} max={max} />
          ))}
        </ul>
      ) : (
        <p className="px-3.5 pb-4 text-[13px] text-muted-foreground">
          No pending MDL is named in this company&rsquo;s filings.
        </p>
      )}
    </Card>
  );
}

function NamedRow({ l, max }: { l: CompanyLink; max: number }) {
  const counted = l.countsTowardExposure;
  const w = l.pending != null && max > 0 ? Math.max(2, (l.pending / max) * 100) : 0;
  return (
    <li>
      <Link
        to="/matters/lens/$mdl"
        params={{ mdl: String(l.mdl) }}
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-1.5 hover:bg-muted/70",
          !counted && "opacity-70",
        )}
        title={counted ? TIER_LABEL[l.tier] : `${TIER_LABEL[l.tier]}; not counted toward exposure`}
      >
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-foreground">
            {mdlTitle(l.title, l.titleTruncated, l.mdl).replace(/^IN RE:\s*/i, "")}
          </span>
          <span className="block font-mono text-[11px] text-muted-foreground">
            MDL {l.mdl}
            {l.district ? ` · ${l.district}` : ""}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[12.5px] font-semibold tabular-nums">
            {l.pending != null ? l.pending.toLocaleString("en-US") : NOT_RECORDED}
          </span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">
            {l.change12m != null
              ? `${l.change12m > 0 ? "+" : l.change12m < 0 ? "−" : ""}${Math.abs(l.change12m).toLocaleString("en-US")} 12 mo`
              : "—"}
          </span>
        </span>
        <span className="col-span-2 flex items-center gap-2">
          <span aria-hidden className="block h-1 flex-1 rounded-full bg-muted">
            <span
              className={cn(
                "block h-full rounded-full",
                counted ? "bg-brand" : "bg-muted-foreground/40",
              )}
              style={{ width: `${w}%` }}
            />
          </span>
          <TierBadge tier={l.tier} />
        </span>
      </Link>
    </li>
  );
}

const LITIGATION_WORDS =
  /\b(MDL|multi-?district|litigation|plaintiffs?|claims?|lawsuits?|settle\w*|accru\w*|verdicts?|product liability)\b/i;

/**
 * The excerpt as filed, with the filing's paragraph marks (¶) turned into breaks and, when the excerpt runs across
 * unrelated paragraphs (cover-page listings, headings), only the paragraphs that speak about the litigation kept,
 * joined by an ellipsis. Words are never changed.
 */
export function quoteText(excerpt: string): string {
  const parts = excerpt
    .split(/\s*¶\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => LITIGATION_WORDS.test(p));
  return (kept.length ? kept : parts).join(" … ");
}

/**
 * What the company tells investors: the newest evidence excerpts from its own filings (quoted as the filing prints
 * them), one per MDL, counted links first.
 */
export function DisclosureQuotes({ d, limit = 3 }: { d: CompanyDetail; limit?: number }) {
  const seen = new Set<string>();
  const quotes = [...d.links]
    .sort(
      (a, b) =>
        Number(b.countsTowardExposure) - Number(a.countsTowardExposure) ||
        (b.pending ?? -1) - (a.pending ?? -1),
    )
    .flatMap((l) => {
      const v = [...l.verified]
        .filter((f) => f.excerpt && f.excerpt.trim().length > 40)
        .sort((a, b) => b.fileDate.localeCompare(a.fileDate))[0];
      if (!v || seen.has(v.excerpt!)) return [];
      seen.add(v.excerpt!);
      return [{ link: l, filing: v }];
    })
    .slice(0, limit);
  if (!quotes.length) return null;
  return (
    <Card as="section" aria-labelledby="disclosures" className="px-3.5 pt-3 pb-3.5">
      <h3 id="disclosures" className="text-label text-foreground">
        What the company tells investors
      </h3>
      <p className="mt-0.5 text-meta text-muted-foreground">
        Excerpts from its own SEC filings, as filed; the role reading beside each is a phrase rule
        and needs review.
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {quotes.map(({ link, filing }) => (
          <figure
            key={`${link.mdl}-${filing.adsh}`}
            className="m-0 min-w-0 border-l-[3px] border-border pl-3"
          >
            <p className="eyebrow m-0 flex items-center gap-1.5">
              <Quote className="size-3" aria-hidden />
              Form {filing.form} · filed {filing.fileDate}
            </p>
            <blockquote className="m-0 mt-1.5 line-clamp-[9] font-display text-[13.5px] leading-[1.55] text-foreground/85">
              {quoteText(filing.excerpt!)}
            </blockquote>
            <figcaption className="mt-1.5 text-[11.5px] text-muted-foreground">
              <Link
                to="/matters/lens/$mdl"
                params={{ mdl: String(link.mdl) }}
                className="font-medium text-foreground hover:text-primary hover:underline"
              >
                MDL {link.mdl}
              </Link>{" "}
              ·{" "}
              <a
                href={filing.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Open filing
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </Card>
  );
}
