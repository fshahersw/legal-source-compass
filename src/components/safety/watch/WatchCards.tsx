/**
 * Watch cards: one product each, its last 36 months of reports as a column strip with the two compared windows marked
 * (prior 12 months, last 12 months), the counts against expected, death reports, serious share, the fastest-rising
 * reaction terms the radar recorded, and flags that qualify a rise (rapid uptake, one month holding most reports, the
 * same reports under another name). Each card has its own Ask AI with the card's figures.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Gavel, Rocket } from "lucide-react";
import { Card } from "@/components/kit/Card";
import { AskAiButton, buildSectionContext } from "@/components/kit/ai";
import { chartTokens } from "@/components/charts/palette";
import { formatMonth } from "@/components/safety/products/productModel";
import { cn } from "@/lib/utils";
import { SIGNAL_LABEL, SOURCE_LABEL, STATUS_LABEL, tailMonths, type WatchCard } from "./watchModel";
import { STATUS_COLOR } from "./watchColors";

const n = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v).toLocaleString("en-US")
    : "Not recorded";
const ratioText = (v: number | null) =>
  v === null ? "Not rated" : v >= 10 ? `${v.toFixed(0)}×` : `${v.toFixed(2)}×`;
const pct = (v: number | null) => (v === null ? "Not recorded" : `${v.toFixed(1)}%`);

/** 36 monthly columns; the prior 12 and last 12 months are shaded so the comparison reads off the strip. */
export function LookbackStrip({ card, height = 56 }: { card: WatchCard; height?: number }) {
  const tail = card.tail;
  const months = tailMonths(card.end, tail.length);
  const max = Math.max(1, ...tail);
  const W = 300;
  const gap = 1;
  const bw = W / Math.max(tail.length, 1) - gap;
  const lastStart = tail.length - 12;
  const priorStart = tail.length - 24;
  return (
    <svg
      viewBox={`0 0 ${W} ${height + 14}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`${card.label}: reports per month, ${formatMonth(months[0] ?? card.end)} to ${formatMonth(card.end)}. Prior 12 months ${n(card.prior)}, last 12 months ${n(card.recent)}.`}
      style={chartTokens}
    >
      {priorStart >= 0 ? (
        <rect
          x={priorStart * (bw + gap)}
          y={0}
          width={12 * (bw + gap) - gap}
          height={height}
          fill="var(--chart-gridline)"
          opacity={0.7}
        />
      ) : null}
      <rect
        x={Math.max(0, lastStart) * (bw + gap)}
        y={0}
        width={12 * (bw + gap) - gap}
        height={height}
        fill="var(--chart-1)"
        opacity={0.07}
      />
      {tail.map((v, i) => {
        const h = Math.max(v > 0 ? 1.5 : 0, (v / max) * (height - 4));
        const inLast = i >= lastStart;
        const isPeak = card.peakMonth && months[i] === card.peakMonth.month;
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={Math.max(1, bw)}
            height={h}
            rx={1}
            fill={isPeak ? "var(--chart-2)" : inLast ? "var(--chart-1)" : "var(--chart-base)"}
          />
        );
      })}
      <line x1={0} x2={W} y1={height + 0.5} y2={height + 0.5} stroke="var(--chart-baseline)" />
      {priorStart >= 0 ? (
        <text x={priorStart * (bw + gap)} y={height + 11} fontSize={9.5} fill="var(--chart-axis)">
          Prior 12 · {n(card.prior)}
        </text>
      ) : null}
      <text
        x={W}
        y={height + 11}
        textAnchor="end"
        fontSize={9.5}
        fontWeight={600}
        fill="var(--chart-ink)"
      >
        Last 12 · {n(card.recent)}
      </text>
    </svg>
  );
}

function cardContext(c: WatchCard) {
  return buildSectionContext({
    title: `${c.label}: product watch`,
    scope: `${SOURCE_LABEL[c.source]} · ${STATUS_LABEL[c.status]}`,
    period: `12 months to ${formatMonth(c.end)} vs the 12 months before`,
    source:
      c.source === "faers"
        ? "FDA FAERS via openFDA"
        : c.source === "maude"
          ? "FDA MAUDE via openFDA"
          : "NHTSA complaints",
    figures: [
      { label: "Reports, last 12 months", value: c.recent, unit: "reports" },
      { label: "Reports, prior 12 months", value: c.prior, unit: "reports" },
      {
        label: "Expected after the source-wide change",
        value: c.expected === null ? null : Math.round(c.expected),
        unit: "reports",
      },
      { label: "Ratio to expected", value: c.ratio === null ? null : Number(c.ratio.toFixed(2)) },
      { label: "Death reports, last 12 months", value: c.deaths },
      { label: "Death reports, prior 12 months", value: c.deathsPrior },
      {
        label: "Serious share, last 12 months",
        value: c.severeShare === null ? null : Number(c.severeShare.toFixed(1)),
        unit: "%",
      },
      {
        label: "Serious share, prior 12 months",
        value: c.severeSharePrior === null ? null : Number(c.severeSharePrior.toFixed(1)),
        unit: "%",
      },
      ...c.terms.slice(0, 5).map((t) => ({
        label: `Reaction "${t.term}" reports (prior → recent window)`,
        value: `${n(t.prior)} → ${n(t.recent)}`,
      })),
      ...c.mdls.slice(0, 4).map((m) => ({
        label: `MDL ${m.mdl}${m.title ? `: ${m.title}` : ""}`,
        value: m.status,
      })),
      ...(c.peakMonth
        ? [
            {
              label: "Share of last-12 reports in one month",
              value: Number(c.peakMonth.share.toFixed(0)),
              unit: "%",
              period: c.peakMonth.month,
            },
          ]
        : []),
    ],
  });
}

const QUESTIONS = [
  "What could explain this rise, and what does it not show?",
  "Which reactions or problems are driving it?",
  "What would a litigation team check next?",
];

export function WatchCardTile({ card }: { card: WatchCard }) {
  const context = useMemo(() => cardContext(card), [card]);
  const deathsUp = card.deathsSignal === "sharp" || card.deathsSignal === "rising";
  const maxTerm = Math.max(1, ...card.terms.slice(0, 3).map((t) => Math.max(t.prior, t.recent)));
  return (
    <Card as="article" className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <Link
            to="/safety/products/$id"
            params={{ id: card.id }}
            className="line-clamp-2 text-label font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {card.label}
          </Link>
          <p className="mt-0.5 truncate text-meta text-muted-foreground">
            {card.brands.length ? `${card.brands.slice(0, 3).join(", ")} · ` : ""}
            {card.sponsors.length
              ? card.sponsors.slice(0, 2).join(", ")
              : SOURCE_LABEL[card.source]}
          </p>
        </div>
        <AskAiButton
          sectionId={`watch-${card.id}`}
          title={card.label}
          context={context}
          questions={QUESTIONS}
          size="icon"
        />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-2">
        <span className="text-kpi-sm tabular-nums">{ratioText(card.ratio)}</span>
        <span className="text-meta text-muted-foreground">
          {card.expected !== null
            ? `${n(card.recent)} reports vs ${n(card.expected)} expected`
            : `${n(card.recent)} reports, ${n(card.prior)} the year before`}
        </span>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
            card.signal === "sharp"
              ? "bg-[color-mix(in_srgb,var(--chart-2)_16%,transparent)] text-foreground"
              : "bg-muted text-foreground/80",
          )}
          style={chartTokens}
        >
          {SIGNAL_LABEL[card.signal]}
        </span>
      </div>
      <div className="px-4 pt-2">
        <LookbackStrip card={card} />
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 px-4 pt-2 text-meta">
        <div className="min-w-0">
          <dt className="text-muted-foreground">
            {card.source === "maude" ? "Death reports" : "Reports with a death"}
          </dt>
          <dd className={cn("m-0 tabular-nums", deathsUp && "font-semibold text-foreground")}>
            {n(card.deathsPrior)} → {n(card.deaths)}
            {deathsUp ? " (rising)" : ""}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">
            {card.source === "maude" ? "Injury share" : "Serious share"}
          </dt>
          <dd className="m-0 tabular-nums">
            {pct(card.severeSharePrior)} → {pct(card.severeShare)}
          </dd>
        </div>
      </dl>
      {card.terms.length ? (
        <div className="px-4 pt-2.5" style={chartTokens}>
          <p className="text-[11px] font-medium text-muted-foreground">Fastest-rising reactions</p>
          <ul className="m-0 mt-1 list-none space-y-1 p-0">
            {card.terms.slice(0, 3).map((t) => (
              <li key={t.term} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2">
                <span className="truncate text-[11.5px] text-foreground/85" title={t.term}>
                  {t.term.charAt(0) + t.term.slice(1).toLowerCase()}
                </span>
                <span
                  className="relative h-2.5"
                  aria-label={`${n(t.prior)} to ${n(t.recent)} reports`}
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-r-[2px]"
                    style={{
                      width: `${(100 * t.recent) / maxTerm}%`,
                      background: "var(--chart-1)",
                    }}
                  />
                  <span
                    className="absolute inset-y-[3px] left-0 rounded-r-[2px]"
                    style={{
                      width: `${(100 * t.prior) / maxTerm}%`,
                      background: "var(--chart-base)",
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5 px-4 pt-2.5">
        <span
          className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px]"
          title={
            card.mdls
              .map((m) => `MDL ${m.mdl}${m.title ? ` ${m.title}` : ""} (${m.status})`)
              .join("\n") || undefined
          }
        >
          <span
            className="size-2 rounded-full"
            style={{ background: STATUS_COLOR[card.status], ...chartTokens }}
            aria-hidden
          />
          <Gavel className="size-3 text-muted-foreground" aria-hidden />
          {STATUS_LABEL[card.status]}
          {card.mdls.length
            ? ` · ${card.mdls
                .slice(0, 3)
                .map((m) => m.mdl)
                .join(", ")}`
            : ""}
          {card.actionsPending !== null ? ` · ${n(card.actionsPending)} pending` : ""}
        </span>
        {card.uptake ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title={
              card.source === "faers"
                ? "The prior 12 months hold under a fifth of the last 12. Reports rise as use grows, so a launch or rapid uptake can look like a signal."
                : "The prior 12 months hold under a fifth of the last 12. A jump from a low base can come from a new reporting practice or one filer, not only from more events."
            }
          >
            <Rocket className="size-3" aria-hidden />
            {card.source === "faers" ? "Rapid uptake or new to market" : "Jump from a low base"}
          </span>
        ) : null}
        {card.peakMonth ? (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px]"
            title="One month holds a large share of the last 12 months. Manufacturers sometimes file many reports at once (a batch or retrospective filing), which reads as a spike."
          >
            <AlertTriangle className="size-3" aria-hidden />
            {card.peakMonth.share.toFixed(0)}% in {formatMonth(card.peakMonth.month)}
          </span>
        ) : null}
      </div>
      {card.aliases.length || card.near.length ? (
        <p className="px-4 pt-1.5 text-[11px] text-muted-foreground">
          Same reports{card.near.length ? " (or nearly)" : ""} also under:{" "}
          {[...card.aliases, ...card.near].slice(0, 3).join(", ")}
          {card.aliases.length + card.near.length > 3
            ? ` +${card.aliases.length + card.near.length - 3}`
            : ""}
        </p>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 px-4 pb-3 pt-3 text-meta text-muted-foreground">
        <span>To {formatMonth(card.end)}</span>
        <Link
          to="/safety/products/$id"
          params={{ id: card.id }}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open product
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}
