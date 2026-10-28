/**
 * The product watch line on a product's page: is this product's reporting rising faster than its source, against what
 * expectation, with which MDL status, plus the 36-month strip and an Ask AI with the same figures. Shows nothing for a
 * product that is not on the watch.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight } from "lucide-react";
import { Card } from "@/components/kit/Card";
import { AskAiButton, buildSectionContext } from "@/components/kit/ai";
import { chartTokens } from "@/components/charts/palette";
import { formatMonth } from "@/components/safety/products/productModel";
import { getProductWatchCard } from "@/lib/external/productWatch.functions";
import { LookbackStrip } from "./WatchCards";
import { STATUS_COLOR } from "./watchColors";
import { SIGNAL_LABEL, SOURCE_LABEL, STATUS_LABEL } from "./watchModel";

const n = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(v).toLocaleString("en-US")
    : "Not recorded";

export function WatchSignal({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["product-watch-card", id],
    queryFn: () => getProductWatchCard({ data: { id } }),
    staleTime: 5 * 60_000,
  });
  const c = q.data ?? null;
  const context = useMemo(
    () =>
      c
        ? buildSectionContext({
            title: `${c.label}: watch signal`,
            scope: `${SOURCE_LABEL[c.source]} · ${STATUS_LABEL[c.status]}`,
            period: `12 months to ${formatMonth(c.end)} vs the 12 months before`,
            source: c.source === "maude" ? "FDA MAUDE via openFDA" : "FDA FAERS via openFDA",
            figures: [
              { label: "Reports, last 12 months", value: c.recent },
              { label: "Reports, prior 12 months", value: c.prior },
              {
                label: "Expected after the source-wide change",
                value: c.expected === null ? null : Math.round(c.expected),
              },
              {
                label: "Ratio to expected",
                value: c.ratio === null ? null : Number(c.ratio.toFixed(2)),
              },
              { label: "Signal", value: SIGNAL_LABEL[c.signal] },
              { label: "Death reports, last 12 months", value: c.deaths },
              { label: "Death reports, prior 12 months", value: c.deathsPrior },
              ...c.mdls.slice(0, 4).map((m) => ({ label: `MDL ${m.mdl}`, value: m.status })),
            ],
          })
        : null,
    [c],
  );
  if (!c) return null;
  const rising = c.signal === "sharp" || c.signal === "rising";
  return (
    <Card as="section" aria-label="Product watch" className="overflow-hidden">
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:items-center">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
            <Activity className="size-3.5 text-brand" aria-hidden />
            <span className="font-medium text-foreground">Product watch</span>
            <span>· 12 months to {formatMonth(c.end)}</span>
          </p>
          <p className="mt-1 text-label font-semibold text-foreground">
            {c.ratio !== null
              ? `${SIGNAL_LABEL[c.signal]}: ${n(c.recent)} reports against ${n(c.expected)} expected (${c.ratio >= 10 ? c.ratio.toFixed(0) : c.ratio.toFixed(2)}×)`
              : `${SIGNAL_LABEL[c.signal]}: ${n(c.recent)} reports in the last 12 months, ${n(c.prior)} the year before`}
          </p>
          <p
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground"
            style={chartTokens}
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: rising ? STATUS_COLOR[c.status] : "var(--chart-base)" }}
                aria-hidden
              />
              {STATUS_LABEL[c.status]}
              {c.mdls.length
                ? ` (MDL ${c.mdls
                    .slice(0, 3)
                    .map((m) => m.mdl)
                    .join(", ")})`
                : ""}
            </span>
            <span>
              Death reports {n(c.deathsPrior)} → {n(c.deaths)}
            </span>
            {c.peakMonth ? (
              <span>
                {c.peakMonth.share.toFixed(0)}% of the year in {formatMonth(c.peakMonth.month)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="min-w-0">
          <LookbackStrip card={c} height={44} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-meta">
        <span className="text-muted-foreground">
          Expected = prior 12 months × the change in all {c.source === "maude" ? "MAUDE" : "FAERS"}{" "}
          reports
        </span>
        <span className="flex items-center gap-2">
          <AskAiButton
            sectionId="product-watch"
            title={`${c.label} watch signal`}
            context={context}
            size="icon"
          />
          <Link
            to="/safety/products"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Open the watch
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </span>
      </div>
    </Card>
  );
}
