import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import {
  daysBetween,
  getSettlementNotices,
  type SettlementNotice,
  type Verification,
} from "@/lib/external/settlementNotices.functions";
import { cn } from "@/lib/utils";
import { Kpi, LoadingBlock, MoreToggle, Panel, Segmented, StateNote } from "./parts";

export const settlementNoticesQuery = {
  queryKey: ["settlement-notices"],
  queryFn: () => getSettlementNotices(),
  staleTime: 10 * 60 * 1000,
};

const NOT_RECORDED = "Not recorded";
const fmt = (n: number) => n.toLocaleString("en-US");

export function SettlementNotices() {
  const q = useQuery(settlementNoticesQuery);
  if (q.isLoading) return <LoadingBlock label="Loading settlement notices" />;
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
        Settlement notices could not be loaded.
      </StateNote>
    );
  if (!q.data?.length) return <StateNote>No settlement notices have been published yet.</StateNote>;
  return <Body rows={q.data} />;
}

/** Every status except "Not verified" means the notice was compared with its official page. */
const wasCompared = (v: Verification) => v !== "Not verified";
const SUPPORTED: Verification[] = ["Verified", "Partially verified"];

function VerificationChip({ value }: { value: Verification }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] leading-4",
        value === "Contradicted"
          ? "border-destructive/50 text-destructive"
          : SUPPORTED.includes(value)
            ? "border-border bg-muted font-medium"
            : "border-border/70 text-muted-foreground",
      )}
      title={
        value === "Not verified"
          ? "Not compared with the official page"
          : value === "Matter only"
            ? "The official page confirms the matter but not the dates or amounts"
            : value === "Contradicted"
              ? "The official page states a different date or amount"
              : "Compared with the official page"
      }
    >
      {value}
    </span>
  );
}

type View = "ahead" | "all";

function Body({ rows }: { rows: SettlementNotice[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [view, setView] = useState<View>("ahead");
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const ahead = rows.filter((r) => r.deadline != null && r.deadline >= today);
  const soon = ahead.filter((r) => daysBetween(today, r.deadline!) <= 30);
  const checked = rows.filter((r) => wasCompared(r.verification)).length;
  const contradicted = rows.filter((r) => r.verification === "Contradicted").length;
  const needle = query.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (view === "ahead" ? r.deadline != null && r.deadline >= today : true))
    .filter((r) => (checkedOnly ? wasCompared(r.verification) : true))
    .filter((r) =>
      needle
        ? [r.title, r.type, r.states, r.officialSource, r.status].some((v) =>
            v?.toLowerCase().includes(needle),
          )
        : true,
    )
    .sort((a, b) =>
      view === "ahead"
        ? (a.deadline ?? "").localeCompare(b.deadline ?? "")
        : (b.deadline ?? "").localeCompare(a.deadline ?? ""),
    );
  const limit = 25;
  const shown = expanded ? filtered : filtered.slice(0, limit);

  return (
    <div className="space-y-3">
      <StateNote>
        Compiled records, not court, agency or administrator records. Deadlines, amounts and
        eligibility change: confirm on the official page before relying on a notice. Only notices
        marked Verified, Partially verified, Matter only or Contradicted were compared with their
        official page; the rest are Not verified.
      </StateNote>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Notices compiled" value={fmt(rows.length)} note="Each cites an official page" />
        <Kpi
          label="Deadline still ahead"
          value={fmt(ahead.length)}
          note={`Claim or opt-out date on or after ${today}; the status column is as compiled`}
        />
        <Kpi label="Closing within 30 days" value={fmt(soon.length)} />
        <Kpi
          label="Compared with the official page"
          value={fmt(checked)}
          note={`Of ${fmt(rows.length)}; the rest are Not verified`}
        />
        <Kpi
          label="Contradicted by the page"
          value={fmt(contradicted)}
          tone={contradicted ? "warning" : undefined}
          note="The official page states a different date or amount"
        />
      </div>

      <Panel
        title="Settlement notices"
        subtitle={
          view === "ahead"
            ? "Deadline still ahead, soonest first"
            : "All compiled notices, latest deadline first"
        }
        actions={
          <>
            <Segmented
              label="Window"
              value={view}
              options={[
                { id: "ahead", label: `Deadline ahead (${fmt(ahead.length)})` },
                { id: "all", label: `All (${fmt(rows.length)})` },
              ]}
              onChange={(v: View) => {
                setView(v);
                setExpanded(false);
              }}
            />
            <Segmented
              label="Verification"
              value={checkedOnly ? "checked" : "any"}
              options={[
                { id: "any", label: "Any" },
                { id: "checked", label: "Compared" },
              ]}
              onChange={(v: "any" | "checked") => {
                setCheckedOnly(v === "checked");
                setExpanded(false);
              }}
            />
          </>
        }
        footnote="Deadlines are dates the compiled record states; none is a legal deadline. A notice's states are as published, and Nationwide means no state limit was stated."
      >
        <div className="border-b border-border/60 px-3 py-2">
          <label className="relative block max-w-sm">
            <span className="sr-only">Search settlement notices</span>
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setExpanded(false);
              }}
              placeholder="Search name, type, state or site"
              className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </label>
        </div>
        {shown.length ? (
          <div className="overflow-x-auto" id="settlement-notices">
            <table className="w-full text-xs">
              <caption className="sr-only">Compiled settlement notices</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Settlement
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Deadline
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Status as compiled
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Official page
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Verification
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-72 truncate px-2 py-1" title={r.title}>
                      <Link
                        to="/records/$dataset/$id"
                        params={{ dataset: "settlement_notices", id: r.id }}
                        className="text-primary hover:underline"
                      >
                        {r.title}
                      </Link>
                    </td>
                    <td className="max-w-40 truncate px-2 py-1" title={r.type ?? NOT_RECORDED}>
                      {r.type ?? NOT_RECORDED}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 font-mono">
                      {r.deadline ?? NOT_RECORDED}
                      {r.deadline && r.deadline >= today ? (
                        <span className="ml-1 font-sans text-[11px] text-muted-foreground">
                          {(() => {
                            const d = daysBetween(today, r.deadline);
                            return d === 0 ? "today" : `in ${fmt(d)}d`;
                          })()}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1">{r.status ?? NOT_RECORDED}</td>
                    <td className="max-w-48 truncate px-2 py-1" title={r.sourceUrl}>
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {r.officialSource ?? r.sourceUrl}
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    </td>
                    <td className="px-2 py-1">
                      <VerificationChip value={r.verification} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 pb-1">
              <MoreToggle
                total={filtered.length}
                limit={limit}
                expanded={expanded}
                onToggle={() => setExpanded((v) => !v)}
                controls="settlement-notices"
                noun="notices"
              />
            </div>
          </div>
        ) : (
          <StateNote>
            {view === "ahead"
              ? "No compiled notice has a deadline ahead of today with these filters. Try All."
              : "No notice matches these filters."}
          </StateNote>
        )}
      </Panel>
    </div>
  );
}
