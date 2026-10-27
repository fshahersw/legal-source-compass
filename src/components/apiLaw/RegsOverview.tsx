import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { BarTrend, ChartFrame, ChartLegend, metricFormatter, seriesVar } from "@/components/charts";
import type { PeriodAxis, TrendSeriesInput } from "@/components/charts/series";
import { Panel, StateNote } from "@/components/enforcement/parts";
import { getRegsOverview, type RegsOverview as Overview } from "@/lib/external/apiLaw.functions";
import { getDocketCommentCoverage } from "@/lib/law/regsCoverage.functions";

const fmtN = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("en-US") : "Not recorded";
const TYPES: [string, string][] = [
  ["proposed_rule", "Proposed rules"],
  ["rule", "Rules"],
  ["notice", "Notices"],
];
const SOURCES = [
  { label: "Regulations.gov API v4", url: "https://open.gsa.gov/api/regulationsgov/" },
  { label: "Regulations.gov", url: "https://www.regulations.gov/" },
];

const regsOverviewKey = ["regs-overview"] as const;

/**
 * Regulations.gov at a glance for the agencies held: documents posted per year by type, documents still open for
 * comment, the most-commented dockets and a per-agency table. Comment counts are what agencies have posted publicly;
 * "Not recorded" where a count has not been read.
 */
export function RegsOverview() {
  const fn = useServerFn(getRegsOverview);
  const q = useQuery({ queryKey: regsOverviewKey, queryFn: () => fn(), staleTime: 30 * 60 * 1000 });
  if (q.isLoading)
    return (
      <div
        className="h-64 animate-pulse rounded-md border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading the Regulations.gov overview"
      />
    );
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        }
      >
        The Regulations.gov overview could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return (
      <StateNote>
        The Regulations.gov overview appears once the collection and its read function
        (api_law_regs_overview_v1) are published. The documents and dockets lists below work as soon
        as the records are loaded.
      </StateNote>
    );
  return <OverviewBody o={q.data} />;
}

const pct = (n: number, of: number) =>
  of > 0
    ? `${((n / of) * 100).toLocaleString("en-US", { maximumFractionDigits: n / of < 0.01 ? 2 : 1 })}%`
    : "Not recorded";

function OverviewBody({ o }: { o: NonNullable<Overview> }) {
  const coverage = useQuery({
    queryKey: ["regs-docket-comment-coverage"],
    queryFn: () => getDocketCommentCoverage(),
    staleTime: 60 * 60 * 1000,
  });
  const docketAgencies = o.agencies.filter((a) => (a.dockets ?? 0) > 0).length;
  const docAgencies = o.agencies.filter((a) => a.rules + a.proposed_rules + a.notices > 0).length;
  const years = useMemo(
    () => [...new Set(o.by_year.map((r) => r.year))].filter((y) => /^\d{4}$/.test(y)).sort(),
    [o.by_year],
  );
  const thisYear = o.as_of.slice(0, 4);
  const series: TrendSeriesInput[] = TYPES.map(([type, label]) => ({
    id: type,
    label,
    points: years.map((y) => ({
      key: y,
      // A year x type cell the read function does not return is not recorded, never drawn as 0.
      value: o.by_year.find((r) => r.year === y && r.type === type)?.n ?? null,
      partial: y === thisYear,
    })),
  }));
  const axis: PeriodAxis = {
    keys: years,
    label: (y) => y,
    // every year while they fit; past a dozen years, every fifth
    tick: (y) => (years.length <= 12 || y.endsWith("0") || y.endsWith("5") ? y : ""),
  };
  const totals = o.agencies.reduce(
    (a, r) => ({
      docs: a.docs + r.rules + r.proposed_rules + r.notices,
      open: a.open + r.open_documents,
    }),
    { docs: 0, open: 0 },
  );
  return (
    <div className="space-y-4">
      <ChartFrame
        title={`Documents posted on Regulations.gov, by year and type (${docAgencies} agencies)`}
        unit="documents"
        period={years.length ? `${years[0]}–${years[years.length - 1]}` : undefined}
        asOf={o.as_of}
        sources={SOURCES}
        status={
          years.length
            ? { kind: "ready" }
            : { kind: "empty", reason: "No dated documents are held yet." }
        }
        notes={[
          "Each bar counts the Rules, Proposed Rules and Notices the agencies posted that year (Eastern-time posting date).",
          `${thisYear} is still in progress and is drawn hatched.`,
        ]}
        footnotes={[
          `${fmtN(totals.docs)} documents held; ${fmtN(totals.open)} have a comment period ending ${o.as_of} or later.`,
          "That open count includes a few documents whose printed end date is a far-future placeholder (for example 2050-02-21); the mass-tort tracker on the Rulemaking page counts those as having no fixed close date.",
        ]}
        table={{
          caption: "Documents posted per year",
          columns: [
            { label: "Year" },
            ...TYPES.map(([, l]) => ({ label: l, align: "right" as const })),
          ],
          rows: years.map((y) => ({
            key: y,
            cells: [
              y,
              ...TYPES.map(([t]) => fmtN(o.by_year.find((r) => r.year === y && r.type === t)?.n)),
            ],
          })),
        }}
      >
        <ChartLegend
          mark="swatch"
          items={TYPES.map(([type, label], i) => ({ id: type, label, color: seriesVar(i) }))}
        />
        <BarTrend
          series={series}
          axis={axis}
          formatter={metricFormatter("count")}
          unit="documents"
          ariaLabel="Documents posted per year by type"
          stacked
          height={180}
        />
      </ChartFrame>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel
          title="Open for comment"
          subtitle={`Comment period ends ${o.as_of} or later (Eastern time), soonest first`}
        >
          {o.open_for_comment.length ? (
            <ol className="m-0 max-h-96 list-none divide-y divide-border/70 overflow-y-auto p-0">
              {o.open_for_comment.map((d) => (
                <li key={d.id} className="px-3 py-1.5 text-[12.5px]">
                  <Link
                    to={`/records/regulations_gov_documents/${encodeURIComponent(d.id)}` as never}
                    className="break-words text-primary hover:underline"
                  >
                    {d.title}
                  </Link>
                  <p className="m-0 text-[11.5px] text-muted-foreground">
                    {[
                      d.agency,
                      labelOf(d.type),
                      `ends ${d.comment_end}`,
                      d.posted != null
                        ? `${fmtN(d.posted)} ${d.posted === 1 ? "comment" : "comments"} posted`
                        : "comments not recorded",
                    ].join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
              No held document has an open comment period.
            </p>
          )}
        </Panel>
        <Panel
          title="Most-commented dockets"
          subtitle="Among dockets whose comment count has been read; not a ranking of all dockets"
          footnote={
            coverage.data
              ? `Comment counts have been read for ${fmtN(coverage.data.counted)} of ${fmtN(coverage.data.dockets)} dockets (${pct(coverage.data.counted, coverage.data.dockets)}), so most heavily commented dockets are not in this list.`
              : "Comment counts have been read for only a small share of dockets, so most heavily commented dockets are not in this list."
          }
        >
          {o.most_commented_dockets.length ? (
            <ol className="m-0 max-h-96 list-none divide-y divide-border/70 overflow-y-auto p-0">
              {o.most_commented_dockets.map((d) => (
                <li
                  key={d.id}
                  className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12.5px]"
                >
                  <span className="min-w-0">
                    <Link
                      to={`/law/rulemaking/dockets/${encodeURIComponent(d.id)}` as never}
                      className="break-words text-primary hover:underline"
                    >
                      {d.title}
                    </Link>
                    <span className="block text-[11.5px] text-muted-foreground">
                      {[d.id, d.agency, d.docket_type].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">{fmtN(d.posted)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
              No docket comment counts have been read yet.
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title="By agency"
        subtitle="Documents held, dockets, and public comments posted on proposed rules"
        footnote={`Comments on proposed rules sums the counts read so far; the column shows how many proposed rules have a count. Dockets are held for ${docketAgencies} of the ${docAgencies} agencies with documents.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="text-left text-[11.5px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Agency
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Proposed rules
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Rules
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Notices
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Dockets (rulemaking)
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Open for comment
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Comments on proposed rules
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {o.agencies.map((a) => (
                <tr key={a.agency}>
                  <th scope="row" className="px-3 py-1.5 text-left font-medium">
                    <Link
                      to={"/law/rulemaking/documents" as never}
                      search={{ f: { agency: a.agency } } as never}
                      className="text-primary hover:underline"
                    >
                      {a.agency}
                    </Link>
                  </th>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(a.proposed_rules)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(a.rules)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(a.notices)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {a.dockets == null
                      ? "Not recorded"
                      : `${fmtN(a.dockets)} (${fmtN(a.rulemaking_dockets)})`}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(a.open_documents)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {a.proposed_rules_counted
                      ? `${fmtN(a.comments_on_proposed_rules)} (${fmtN(a.proposed_rules_counted)} of ${fmtN(a.proposed_rules)} counted)`
                      : "Not recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function labelOf(type: string) {
  return TYPES.find(([t]) => t === type)?.[1].replace(/s$/, "") ?? type;
}
