import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import {
  getEnforcementSources,
  type EnforcementSource,
} from "@/lib/external/settlementNotices.functions";
import { Kpi, LoadingBlock, MoreToggle, Panel, Segmented, StateNote } from "./parts";

export const enforcementSourcesQuery = {
  queryKey: ["enforcement-data-sources"],
  queryFn: () => getEnforcementSources(),
  staleTime: 10 * 60 * 1000,
};

const NOT_RECORDED = "Not recorded";
const fmt = (n: number) => n.toLocaleString("en-US");

type Level = "all" | "federal" | "state" | "local";
const levelOf = (s: EnforcementSource): Level => {
  const l = (s.level ?? "").toLowerCase();
  if (l.startsWith("federal")) return "federal";
  if (l.startsWith("state")) return "state";
  return "local";
};

/** Short label plus the full wording shown as a tooltip. */
const CHECK_LABEL: Record<string, { short: string; long: string }> = {
  OK: { short: "Loads", long: "The page loaded when we checked" },
  restricted: {
    short: "Blocks bots",
    long: "The page refused automated access when we checked; it may open in a browser",
  },
  unreachable: { short: "No response", long: "The page did not respond when we checked" },
  error: { short: "Error", long: "The page returned an error when we checked" },
  "not fetched": { short: "Not checked", long: "We did not check this page" },
};

export function EnforcementSources() {
  const q = useQuery(enforcementSourcesQuery);
  if (q.isLoading) return <LoadingBlock label="Loading enforcement data sources" />;
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
        The enforcement data source catalog could not be loaded.
      </StateNote>
    );
  if (!q.data?.length) return <StateNote>The source catalog has not been published yet.</StateNote>;
  return <Body rows={q.data} />;
}

function Body({ rows }: { rows: EnforcementSource[] }) {
  const [level, setLevel] = useState<Level>("all");
  const [query, setQuery] = useState("");
  const [uncoveredOnly, setUncoveredOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const federal = rows.filter((r) => levelOf(r) === "federal").length;
  const jurisdictions = new Set(rows.map((r) => r.jurisdiction).filter(Boolean)).size;
  const covered = rows.filter((r) => (r.datasetCount ?? 0) > 0).length;
  const reachable = rows.filter((r) => r.urlCheck === "OK").length;
  const needle = query.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (level === "all" ? true : levelOf(r) === level))
    .filter((r) => (uncoveredOnly ? (r.datasetCount ?? 0) === 0 : true))
    .filter((r) =>
      needle
        ? [r.agency, r.jurisdiction, r.covers, r.sourceType, r.host].some((v) =>
            v?.toLowerCase().includes(needle),
          )
        : true,
    );
  const limit = 25;
  const shown = expanded ? filtered : filtered.slice(0, limit);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Agency sources listed" value={fmt(rows.length)} note="One per agency page" />
        <Kpi label="Federal" value={fmt(federal)} note="Agencies and self-regulatory bodies" />
        <Kpi label="Jurisdictions" value={fmt(jurisdictions)} note="Federal plus states and DC" />
        <Kpi
          label="Already in our data"
          value={fmt(covered)}
          note={`Another ${fmt(rows.length - covered)} have no dataset from the same site yet`}
        />
        <Kpi
          label="Page loaded when checked"
          value={fmt(reachable)}
          note="Our check on the date in each record"
        />
      </div>

      <Panel
        title="Where agencies publish enforcement actions"
        subtitle="Each row links the agency's own page; this list holds no penalty or case data"
        actions={
          <>
            <Segmented
              label="Level"
              value={level}
              options={[
                { id: "all", label: "All" },
                { id: "federal", label: "Federal" },
                { id: "state", label: "State" },
                { id: "local", label: "Local and regional" },
              ]}
              onChange={(v: Level) => {
                setLevel(v);
                setExpanded(false);
              }}
            />
            <Segmented
              label="Coverage"
              value={uncoveredOnly ? "gap" : "any"}
              options={[
                { id: "any", label: "Any" },
                { id: "gap", label: "Not yet in our data" },
              ]}
              onChange={(v: "any" | "gap") => {
                setUncoveredOnly(v === "gap");
                setExpanded(false);
              }}
            />
          </>
        }
        footnote="Compiled from agency enforcement-data pages. Datasets counts corpus datasets whose records come from the same site. Agencies that publish only on request are not listed."
      >
        <div className="border-b border-border/60 px-3 py-2">
          <label className="relative block max-w-sm">
            <span className="sr-only">Search agency sources</span>
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
              placeholder="Search agency, state or topic"
              className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
          </label>
        </div>
        {shown.length ? (
          <div className="overflow-x-auto" id="enforcement-sources">
            <table className="w-full text-xs">
              <caption className="sr-only">Agency enforcement data sources</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Agency
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Jurisdiction
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Covers
                  </th>
                  <th scope="col" className="whitespace-nowrap px-2 py-1.5 text-right font-medium">
                    Datasets
                  </th>
                  <th scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">
                    Link check
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-64 truncate px-2 py-1" title={r.agency}>
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {r.agency}
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {r.jurisdiction ?? NOT_RECORDED}
                    </td>
                    <td className="max-w-56 truncate px-2 py-1" title={r.covers ?? NOT_RECORDED}>
                      {r.covers ?? NOT_RECORDED}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {r.datasetCount == null ? NOT_RECORDED : fmt(r.datasetCount)}
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-1 text-muted-foreground"
                      title={r.urlCheck ? CHECK_LABEL[r.urlCheck]?.long : undefined}
                    >
                      {r.urlCheck ? (CHECK_LABEL[r.urlCheck]?.short ?? r.urlCheck) : NOT_RECORDED}
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
                controls="enforcement-sources"
                noun="sources"
              />
            </div>
          </div>
        ) : (
          <StateNote>No source matches these filters.</StateNote>
        )}
      </Panel>
    </div>
  );
}
