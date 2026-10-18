import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { int, NOT_RECORDED, pct } from "@/components/analysis/analysisFormat";
import { LoadingBlock, Panel, Segmented, StateNote } from "@/components/enforcement/parts";
import {
  getNeissInjuries,
  NEISS_DIMENSIONS,
  type NeissDimension,
  type NeissInjuries,
  type NeissInjuryRow,
} from "@/lib/external/neiss.functions";
import { cn } from "@/lib/utils";
import { ShowMore } from "../ShowMore";
import { NeissBadge } from "./parts";
import { neissInjuriesQuery } from "./queries";
import {
  figureNote,
  figureText,
  NEISS_LABEL,
  orderInjuryRows,
  POOLED_LABEL,
  withheldReasons,
} from "./neissView";

const STEP = 12;

export function InjuryExplorer() {
  const q = useQuery(neissInjuriesQuery);
  if (q.isLoading) return <LoadingBlock label="Loading the NEISS injury explorer" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        The NEISS injury explorer could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return <StateNote>The NEISS injury breakdowns have not been published yet.</StateNote>;
  return <Explorer data={q.data} />;
}

function Explorer({ data }: { data: NeissInjuries }) {
  const available = NEISS_DIMENSIONS.filter((d) => data.rows.some((r) => r.dimension === d.id));
  const [dimension, setDimension] = useState<NeissDimension>(available[0]?.id ?? "body_part");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(STEP);
  const rows = useMemo(
    () => orderInjuryRows(data.rows.filter((r) => r.dimension === dimension)),
    [data.rows, dimension],
  );
  const dimLabel = NEISS_DIMENSIONS.find((d) => d.id === dimension)?.label ?? dimension;
  const maxShare = Math.max(1, ...rows.map((r) => r.pooledSharePct ?? 0));
  const year = data.latestYear;
  return (
    <Panel
      id="neiss-injuries"
      title="Injury explorer"
      subtitle={`${NEISS_LABEL}: all consumer-product injuries by ${dimLabel.toLowerCase()}, each value with its own interval`}
      actions={
        <>
          <NeissBadge />
          <Segmented
            label="Breakdown"
            value={dimension}
            options={available.map((d) => ({ id: d.id, label: d.label }))}
            onChange={(d) => {
              setDimension(d);
              setOpen(null);
              setLimit(STEP);
            }}
          />
        </>
      }
      footnote={`${year ?? "Latest"} figures are single-year weighted estimates; ${POOLED_LABEL.toLowerCase()} are five-year totals built within two sample-design periods, so their CV is an upper bound. Values withheld by CPSC's unstable rule show only the unweighted sample count. Aggregates only: no case-level record exists in this view.`}
    >
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              NEISS injury estimates by {dimLabel.toLowerCase()}
            </caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  {dimLabel}
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {year ?? ""} estimate (95% interval; CV)
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {POOLED_LABEL} (95% interval; CV)
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Share of all injuries, 2021–2025
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Admitted to hospital (95% interval)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.slice(0, limit).map((r) => (
                <ExplorerRow
                  key={r.id}
                  r={r}
                  maxShare={maxShare}
                  open={open === r.id}
                  onToggle={() => setOpen((o) => (o === r.id ? null : r.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StateNote>No {dimLabel.toLowerCase()} estimates are published.</StateNote>
      )}
      <ShowMore
        shown={Math.min(limit, rows.length)}
        total={rows.length}
        step={STEP}
        onMore={() => setLimit((l) => l + STEP)}
        onAll={() => setLimit(rows.length)}
        noun="values"
      />
    </Panel>
  );
}

function admittedText(r: NeissInjuryRow): { text: string; note: string | null } {
  if (r.admittedPct === "na")
    return { text: "Not applicable", note: "This breakdown is by outcome" };
  if (!r.admittedPct) return { text: NOT_RECORDED, note: null };
  return {
    text: pct(r.admittedPct.pct, 1),
    note: `(${pct(r.admittedPct.ciLow, 1)} to ${pct(r.admittedPct.ciHigh, 1)})`,
  };
}

function ExplorerRow({
  r,
  maxShare,
  open,
  onToggle,
}: {
  r: NeissInjuryRow;
  maxShare: number;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = `neiss-injury-${r.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const admitted = admittedText(r);
  const canOpen = r.topProducts.length > 0;
  return (
    <Fragment>
      <tr>
        <td className="max-w-72 px-2 py-1">
          {canOpen ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={onToggle}
              className="flex max-w-full items-center gap-1 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
              title={r.label}
            >
              <ChevronRight
                className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
                aria-hidden
              />
              <span className="truncate">{r.label}</span>
            </button>
          ) : (
            <span className="block truncate pl-4" title={r.label}>
              {r.label}
            </span>
          )}
        </td>
        <td className="px-2 py-1 text-right">
          <span
            className={cn("font-mono", r.latest?.state !== "estimate" && "text-muted-foreground")}
          >
            {figureText(r.latest)}
          </span>
          {figureNote(r.latest, { label: false }) ? (
            <span
              className="block text-[11px] text-muted-foreground"
              title={withheldReasons(r.latest) ?? undefined}
            >
              {figureNote(r.latest, { label: false })}
            </span>
          ) : null}
        </td>
        <td className="px-2 py-1 text-right">
          <span
            className={cn("font-mono", r.pooled?.state !== "estimate" && "text-muted-foreground")}
          >
            {figureText(r.pooled)}
          </span>
          {figureNote(r.pooled, { label: false }) ? (
            <span
              className="block text-[11px] text-muted-foreground"
              title={withheldReasons(r.pooled) ?? undefined}
            >
              {figureNote(r.pooled, { label: false })}
            </span>
          ) : null}
        </td>
        <td className="px-2 py-1">
          {r.pooledSharePct != null ? (
            <span className="grid grid-cols-[1fr_3.25rem] items-center gap-2">
              <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
                <span
                  className="block h-2.5 rounded-sm bg-primary/60"
                  style={{ width: `${Math.max(1, (r.pooledSharePct / maxShare) * 100)}%` }}
                />
              </span>
              <span className="text-right font-mono">{pct(r.pooledSharePct, 1)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{NOT_RECORDED}</span>
          )}
        </td>
        <td className="px-2 py-1 text-right">
          <span className={cn("font-mono", r.admittedPct === "na" && "text-muted-foreground")}>
            {admitted.text}
          </span>
          {admitted.note ? (
            <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
              {admitted.note}
            </span>
          ) : null}
        </td>
      </tr>
      {open && canOpen ? (
        <tr id={detailId} className="bg-muted/30">
          <td colSpan={5} className="px-3 py-2">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Products most often involved, {POOLED_LABEL.toLowerCase()} (reliable estimates;
              products overlap and are not additive)
            </p>
            <ul
              className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2"
              aria-label={`Top products for ${r.label}`}
            >
              {r.topProducts.map((p) => (
                <li key={p.code} className="flex items-baseline justify-between gap-2">
                  <Link
                    to="/records/$dataset/$id"
                    params={{ dataset: "neiss_product_estimates", id: p.code }}
                    className="min-w-0 truncate text-primary hover:underline"
                    title={p.label}
                  >
                    {p.label}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px]">
                    {int(p.estimate)}
                    <span className="ml-1 text-muted-foreground">CV {pct(p.cvPct, 0)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
