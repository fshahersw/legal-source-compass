import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { int } from "@/components/analysis/analysisFormat";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import { MoreToggle, Panel, StateNote } from "@/components/enforcement/parts";
import type { RankEntry, ShareRow, WindowMix } from "@/lib/external/courtCaseload.functions";
import { cn } from "@/lib/utils";
import {
  barWidth,
  days,
  NOT_RECORDED,
  pct,
  rankChip,
  topShares,
  windowLabel,
} from "./caseloadFormat";

/** A search box that keeps its own draft and reports the settled text, so typing never fights the URL. */
export function SearchBox({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  label: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const push = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(text.trim() || undefined), 200);
  };
  return (
    <label className="relative block w-full min-w-40 max-w-xs flex-1">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          push(e.target.value);
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
      />
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  options: { id: string; label: string }[];
  allLabel: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 max-w-44 rounded-md border border-border bg-background px-1.5 text-xs focus-visible:outline-2 focus-visible:outline-ring"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <X className="size-3" aria-hidden />
      Clear filters
    </button>
  );
}

/** A scrollable table region that keyboard users can focus and scroll. */
export function TableScroll({
  label,
  maxHeight = "max-h-[26rem]",
  children,
}: {
  label: string;
  maxHeight?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("overflow-auto focus-visible:outline-2 focus-visible:outline-ring", maxHeight)}
    >
      {children}
    </div>
  );
}

/** FY-rank chips with the meaning of rank 1 as the tooltip. The ranks are for the latest complete year only. */
export function RankChips({ ranks, fy }: { ranks: readonly RankEntry[]; fy: number }) {
  if (!ranks.length)
    return (
      <p className="text-xs text-muted-foreground">Ranks are {NOT_RECORDED} for this court.</p>
    );
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`FY${fy} ranks among districts`}>
      {ranks.map((r) => {
        const chip = rankChip(r, fy);
        return (
          <li
            key={r.metric}
            title={chip.title}
            className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] leading-4"
          >
            {chip.text}
          </li>
        );
      })}
    </ul>
  );
}

/** Horizontal share bars for one mix list (jurisdiction, origin, dispositions). */
export function ShareList({
  rows,
  caption,
  limit = 8,
  countLabel,
  id,
}: {
  rows: readonly ShareRow[];
  caption: string;
  limit?: number;
  countLabel: string;
  id: string;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length)
    return (
      <StateNote>
        {caption} is {NOT_RECORDED}.
      </StateNote>
    );
  const ordered = topShares(rows, rows.length);
  const shown = all ? ordered : ordered.slice(0, limit);
  const max = Math.max(...ordered.map((r) => r.sharePct ?? 0), 0);
  return (
    <div className="p-3" id={id}>
      <ul className="space-y-1.5 text-xs" aria-label={caption}>
        {shown.map((r) => (
          <li
            key={r.key}
            className="grid grid-cols-[minmax(6rem,11rem)_minmax(2rem,1fr)_3rem_4rem] items-center gap-2"
          >
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
            <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
              <span
                className="block h-2.5 rounded-sm"
                style={{ width: `${barWidth(r.sharePct, max)}%`, background: FDA_COLORS[3] }}
              />
            </span>
            <span className="text-right font-mono">{pct(r.sharePct)}</span>
            <span className="text-right font-mono text-muted-foreground" title={countLabel}>
              {r.count == null ? NOT_RECORDED : int(r.count)}
            </span>
          </li>
        ))}
      </ul>
      <MoreToggle
        total={ordered.length}
        limit={limit}
        expanded={all}
        onToggle={() => setAll((v) => !v)}
        controls={id}
      />
    </div>
  );
}

/** Nature-of-suit groups of a window as a table with the share, count and median days of each. */
export function GroupMixTable({ window: w }: { window: WindowMix }) {
  const [all, setAll] = useState(false);
  const limit = 8;
  const rows = [...w.groups].sort((a, b) => (b.sharePct ?? -1) - (a.sharePct ?? -1));
  const shown = all ? rows : rows.slice(0, limit);
  const max = Math.max(...rows.map((r) => r.sharePct ?? 0), 0);
  return (
    <div className="overflow-x-auto" id="caseload-group-mix">
      <table className="w-full text-xs">
        <caption className="sr-only">Nature-of-suit groups, {windowLabel(w)}</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Group
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 text-right font-medium"
              title="Share of the window's filings"
            >
              Share
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Filed
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 text-right font-medium"
              title="Median days from filing to termination, cases terminated in the window"
            >
              Median days
            </th>
            <th
              scope="col"
              className="hidden px-2 py-1.5 text-right font-medium xl:table-cell"
              title="Share of the group's terminations coded settled"
            >
              Settled
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {shown.map((g) => (
            <tr key={g.group}>
              <td className="px-2 py-1">
                <span className="block max-w-56 truncate" title={g.label}>
                  {g.label}
                </span>
                <span className="mt-0.5 block h-1.5 rounded-sm bg-muted" aria-hidden>
                  <span
                    className="block h-1.5 rounded-sm"
                    style={{ width: `${barWidth(g.sharePct, max)}%`, background: FDA_COLORS[3] }}
                  />
                </span>
              </td>
              <td className="px-2 py-1 text-right font-mono">{pct(g.sharePct)}</td>
              <td className="px-2 py-1 text-right font-mono">
                {g.filings == null ? NOT_RECORDED : int(g.filings)}
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {days(g.medianDays).replace(" days", "")}
              </td>
              <td className="hidden px-2 py-1 text-right font-mono xl:table-cell">
                {pct(g.settledPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 pb-1">
        <MoreToggle
          total={rows.length}
          limit={limit}
          expanded={all}
          onToggle={() => setAll((v) => !v)}
          controls="caseload-group-mix"
          noun="groups"
        />
      </div>
    </div>
  );
}

/** The window's mix panels shared by the district and nature-of-suit drill-downs. */
export function MixPanels({
  window: w,
  showGroups,
  showTopNos,
  subject,
}: {
  window: WindowMix | null;
  showGroups: boolean;
  showTopNos: boolean;
  subject: string;
}) {
  if (!w)
    return (
      <StateNote>
        The case mix for {subject} is {NOT_RECORDED}.
      </StateNote>
    );
  const label = windowLabel(w);
  const dispositionDetail = w.dispositions;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {showGroups ? (
        <Panel
          title="What is filed"
          subtitle={`Nature-of-suit groups, ${label}: ${w.filings == null ? NOT_RECORDED : int(w.filings)} filings`}
          footnote="Groups are this project's grouping of the codebook's nature-of-suit codes, not FJC categories. Share is of the window's filings; median days and settled share are over cases terminated in the window."
        >
          {w.groups.length ? (
            <GroupMixTable window={w} />
          ) : (
            <StateNote>Groups are {NOT_RECORDED}.</StateNote>
          )}
        </Panel>
      ) : null}
      {showTopNos ? (
        <Panel
          title="Most-filed nature-of-suit codes"
          subtitle={`${label}, share of the window's filings`}
        >
          {w.topNos.length ? (
            <ShareList
              id="caseload-top-nos"
              caption="Most-filed nature-of-suit codes"
              countLabel="Filings in the window"
              limit={10}
              rows={w.topNos.map((n) => ({
                key: String(n.nos),
                label: `${n.nos} ${n.label}`,
                count: n.filings,
                sharePct: n.sharePct,
                group: null,
              }))}
            />
          ) : (
            <StateNote>Codes are {NOT_RECORDED}.</StateNote>
          )}
        </Panel>
      ) : null}
      <Panel
        title="How cases ended"
        subtitle={`Dispositions of cases terminated ${label}`}
        footnote="Share is of terminations in the window. The three groups are this project's grouping of the codebook's disposition codes: Dismissed includes the voluntary and settled codes, and Judgment includes the other closing codes (for example statistical closing). Open the code list for each."
      >
        <ShareList
          id="caseload-disposition-groups"
          caption="Disposition groups"
          countLabel="Terminations in the window"
          rows={w.dispositionGroups}
        />
        {dispositionDetail.length ? (
          <details className="border-t border-border/60 px-3 py-1.5">
            <summary className="cursor-pointer text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
              Each disposition code ({dispositionDetail.length})
            </summary>
            <ShareList
              id="caseload-dispositions"
              caption="Disposition codes"
              countLabel="Terminations in the window"
              limit={12}
              rows={dispositionDetail}
            />
          </details>
        ) : null}
      </Panel>
      <Panel
        title="Why they are in federal court"
        subtitle={`Basis of jurisdiction and origin of ${label} filings`}
        footnote="Origin codes are the AO's: original proceeding, removal, transfer, reopening, and the MDL codes (transferred in, or originating in the district from July 1, 2016)."
      >
        <ShareList
          id="caseload-jurisdiction"
          caption="Basis of jurisdiction"
          countLabel="Filings in the window"
          rows={w.jurisdiction}
        />
        <div className="border-t border-border/60">
          <ShareList
            id="caseload-origin"
            caption="Origin of the case"
            countLabel="Filings in the window"
            limit={6}
            rows={w.origin}
          />
        </div>
      </Panel>
    </div>
  );
}

export function RetryNote({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <StateNote
      tone="error"
      action={
        <button type="button" onClick={onRetry} className="underline">
          Retry
        </button>
      }
    >
      {children}
    </StateNote>
  );
}

/** A note that records were left out of a list because they could not be read, or the corpus holds more than were loaded. */
export function ListCoverage({
  loaded,
  total,
  dropped,
  noun,
}: {
  loaded: number;
  total: number | null;
  dropped: number;
  noun: string;
}) {
  const short = total != null && total > loaded + dropped;
  if (!dropped && !short) return null;
  return (
    <p
      className="border-t border-border/60 px-3 py-1.5 text-[11px] text-warning-foreground"
      role="status"
    >
      {dropped
        ? `${int(dropped)} ${noun} could not be read and ${dropped === 1 ? "is" : "are"} left out. `
        : ""}
      {short
        ? `Only ${int(loaded + dropped)} of ${int(total!)} ${noun} were returned by the source. `
        : ""}
      Counts and ranks on this page cover the {noun} shown.
    </p>
  );
}

/** A sortable column header with a tooltip for the denominator, sticky inside a scrolling table region. */
export function SortTh({
  label,
  title,
  active,
  desc,
  onSort,
  align = "right",
}: {
  label: string;
  title?: string;
  active: boolean;
  desc: boolean;
  onSort: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      title={title}
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      className={cn(
        "sticky top-0 z-10 bg-surface px-1.5 py-1.5 font-medium shadow-[inset_0_-1px_0_var(--border)]",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? (
          desc ? (
            <ArrowDown className="size-3" aria-hidden />
          ) : (
            <ArrowUp className="size-3" aria-hidden />
          )
        ) : null}
      </button>
    </th>
  );
}
