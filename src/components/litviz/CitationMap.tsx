/**
 * Citation map: which authorities an MDL's filings cite — as a network (authorities linked by the filings that cite
 * both), as an authority × MDL grid clustered by kind of authority, and side by side with a second MDL. Plus the grid
 * across the MDLs with the most citing filings (MDL index) and one filing's citations in their MDL context.
 *
 * Counts are filings whose text cites the authority by an exact citation resolved to one decision or provision; a
 * citation is a mention, never a statement about MDL membership.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChartFrame, type TableSpec } from "@/components/charts/ChartFrame";
import { Heatmap } from "@/components/charts/Heatmap";
import { Network } from "@/components/charts/Network";
import { metricFormatter } from "@/components/charts/format";
import { chartTokens } from "@/components/charts/palette";
import { SegmentedControl } from "@/components/matters/common";
import {
  CLASS_LABEL,
  clusterAuthorities,
  compareMdls,
  type Authority,
  type CitationGrid,
  type CitationMap as Map_,
} from "@/lib/litviz/citations";
import { citationGridQuery, citationMapQuery, filingCitationsQuery } from "./queries";

const count = metricFormatter("count");
const pct = metricFormatter("percent");
const SOURCES = [
  { label: "Court filings collected", url: "/litigation/documents" },
  { label: "Case law (CourtListener bulk data)", url: "/cases" },
];
const SHORT_CLASS: Record<string, string> = {
  scotus: "U.S.",
  federal_appellate: "C.A.",
  state_high: "State",
  other_court: "Court",
  usc: "U.S.C.",
  cfr: "C.F.R.",
};

/** Short node label: the case name (trimmed) or the provision. */
export function shortAuthority(a: Pick<Authority, "kind" | "label">): string {
  if (a.kind !== "case") return a.label;
  const t = a.label.replace(/,? (Inc|Corp|Co|Ltd|L\.L\.C|LLC)\.?(?=\b|$)/g, "");
  return t.length > 34 ? `${t.slice(0, 33)}…` : t;
}

export function authorityLine(a: Authority): string {
  return [a.cite, a.courtLabel, a.year ? String(a.year) : null, a.heading]
    .filter(Boolean)
    .join(" · ");
}

function AuthorityLink({ a, short = false }: { a: Authority; short?: boolean }) {
  const text = short ? shortAuthority(a) : a.label;
  return a.href ? (
    <Link to={a.href as never} className="text-primary underline-offset-2 hover:underline">
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
}

function coverageNote(m: Map_["meta"], distinct: number, shown: number): string[] {
  if (!m) return [];
  const out = [
    `${count.full(m.citing)} of ${count.full(m.withText)} filings with searchable text cite at least one authority resolved exactly; ${count.full(distinct)} distinct authorities, the ${count.full(shown)} most cited shown.`,
  ];
  if (m.citesUnresolved || m.citesAmbiguous)
    out.push(
      `${count.full(m.citesUnresolved)} case citations matched no decision held and ${count.full(m.citesAmbiguous)} matched more than one; they are not shown.`,
    );
  if (m.filings > m.withText)
    out.push(
      `${count.full(m.filings - m.withText)} listed filings have no searchable text and cannot be read for citations.`,
    );
  return out;
}

function authorityTable(
  list: readonly (Authority & { filings: number; mentions?: number })[],
  caption: string,
): TableSpec {
  return {
    caption,
    columns: [
      { label: "Authority" },
      { label: "Kind", align: "left" },
      { label: "Citation", align: "left" },
      { label: "Filings citing", align: "right" },
      { label: "Mentions", align: "right" },
    ],
    rows: list.map((a) => ({
      key: a.key,
      cells: [
        <AuthorityLink key="l" a={a} />,
        CLASS_LABEL[a.class],
        authorityLine(a) || "Not recorded",
        count.full(a.filings),
        a.mentions !== undefined ? count.full(a.mentions) : "Not recorded",
      ],
    })),
  };
}

type View = "network" | "grid" | "compare";

export function CitationMap({ mdl }: { mdl: string }) {
  const [view, setView] = useState<View>("network");
  const [other, setOther] = useState<string>("");
  const map = useQuery(citationMapQuery(mdl, 30));
  const top = useQuery(citationGridQuery(null, 30));
  const options = (top.data?.available ? top.data.data.mdls : []).filter((m) => m.mdl !== mdl);
  const compareTo = other || options[0]?.mdl || "";
  const gridMdls =
    view === "grid"
      ? [mdl, ...options.slice(0, 7).map((m) => m.mdl)]
      : compareTo
        ? [mdl, compareTo]
        : [mdl];
  const grid = useQuery({ ...citationGridQuery(gridMdls, 30), enabled: view !== "network" });

  const m = map.data?.available ? map.data.data : null;
  const notBuilt = map.data && !map.data.available;
  const status = map.isPending
    ? ({ kind: "loading" } as const)
    : map.isError
      ? ({
          kind: "error",
          message: "The citation map could not be read just now.",
          onRetry: () => void map.refetch(),
        } as const)
      : notBuilt
        ? ({
            kind: "empty",
            reason: "Citation counts for this MDL's filings are not published yet.",
          } as const)
        : !m?.authorities.length
          ? ({
              kind: "empty",
              reason: `No filing of MDL No. ${mdl} cites an authority that could be resolved exactly.`,
            } as const)
          : ({ kind: "ready" } as const);

  return (
    <ChartFrame
      title={`Authorities cited in MDL No. ${mdl} filings`}
      unit="filings citing"
      sources={SOURCES}
      status={status}
      minHeight={320}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Citation view"
            value={view}
            options={[
              { value: "network", label: "Network" },
              { value: "grid", label: "Grid" },
              { value: "compare", label: "Compare" },
            ]}
            onChange={setView}
          />
          {view === "compare" && options.length ? (
            <label className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
              with
              <select
                value={compareTo}
                onChange={(e) => setOther(e.target.value)}
                className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-[12px]"
              >
                {options.map((o) => (
                  <option key={o.mdl} value={o.mdl}>
                    MDL {o.mdl}
                    {o.title ? ` · ${o.title.replace(/^IN RE:?\s*/i, "").slice(0, 40)}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      }
      notes={[
        "Network: each circle is an authority sized by the filings citing it; a line joins two authorities cited together by two or more filings, thicker when more. Position carries no meaning beyond grouping.",
        "Grid: rows are authorities grouped by kind (Supreme Court, courts of appeals, state high courts, U.S. Code, C.F.R.); each cell is the share of an MDL's citing filings that cite the authority.",
        "Compare: the authorities either MDL cites, shared ones first, as a share of each MDL's citing filings.",
      ]}
      footnotes={m ? coverageNote(m.meta, m.distinct, m.authorities.length) : undefined}
      table={
        m ? authorityTable(m.authorities, `Authorities cited in MDL No. ${mdl} filings`) : undefined
      }
    >
      {m ? (
        view === "network" ? (
          <Network
            nodes={m.authorities.map((a) => ({
              id: a.key,
              label: shortAuthority(a),
              weight: a.filings,
            }))}
            edges={m.edges.map(([a, b, n]) => ({ a, b, weight: n }))}
            formatter={count}
            nodeUnit="filings citing"
            edgeUnit="filings citing both"
            ariaLabel={`Network of the ${m.authorities.length} authorities most cited in MDL No. ${mdl} filings. Use the arrow keys to read each authority and the ones cited with it.`}
            height={420}
          />
        ) : (
          <GridOrCompare
            view={view}
            mdl={mdl}
            other={compareTo}
            grid={grid.data?.available ? grid.data.data : null}
            loading={grid.isPending}
          />
        )
      ) : null}
    </ChartFrame>
  );
}

function GridOrCompare({
  view,
  mdl,
  other,
  grid,
  loading,
}: {
  view: View;
  mdl: string;
  other: string;
  grid: CitationGrid | null;
  loading: boolean;
}) {
  if (!grid)
    return (
      <p role="status" className="py-6 text-[12px] text-muted-foreground">
        {loading ? "Loading the comparison…" : "The comparison is not available just now."}
      </p>
    );
  if (view === "compare") return <CompareTable grid={grid} a={mdl} b={other} />;
  return <AuthorityGrid grid={grid} />;
}

/** Authority × MDL heatmap, rows clustered by kind of authority. */
export function AuthorityGrid({ grid }: { grid: CitationGrid }) {
  const clusters = clusterAuthorities(grid.authorities);
  const rows = clusters.flatMap((c) =>
    c.items.map((a) => ({ id: a.key, label: `${SHORT_CLASS[a.class]} · ${shortAuthority(a)}` })),
  );
  const cols = grid.mdls.map((m) => ({ id: m.mdl, label: `MDL ${m.mdl}` }));
  const cell = useMemo(
    () => new Map(grid.cells.map((c) => [`${c[0]}#${c[1]}`, c[2]] as const)),
    [grid],
  );
  const citing = new Map(grid.mdls.map((m) => [m.mdl, m.citing] as const));
  return (
    <Heatmap
      rows={rows}
      columns={cols}
      value={(r, c) => {
        const n = citing.get(c);
        if (!n) return null;
        return (100 * (cell.get(`${r}#${c}`) ?? 0)) / n;
      }}
      formatter={pct}
      cellHeight={18}
      ariaLabel={`Share of each MDL's citing filings that cite each authority: ${rows.length} authorities by ${cols.length} MDLs.`}
      cellNote={(r, c) => {
        const n = citing.get(c);
        return n
          ? `${count.full(cell.get(`${r}#${c}`) ?? 0)} of ${count.full(n)} citing filings`
          : "No citing filings held for this MDL";
      }}
    />
  );
}

function CompareTable({ grid, a, b }: { grid: CitationGrid; a: string; b: string }) {
  const rows = compareMdls(grid, a, b);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.shareA ?? 0, r.shareB ?? 0)));
  const ca = grid.mdls.find((m) => m.mdl === a);
  const cb = grid.mdls.find((m) => m.mdl === b);
  const Bar = ({ share, slot }: { share: number | null; slot: 1 | 2 }) => (
    <span className="flex items-center justify-end gap-1.5">
      <span className="tabular-nums">{share === null ? "Not recorded" : pct.full(share)}</span>
      <svg width={72} height={8} aria-hidden className="hidden shrink-0 sm:block">
        <rect width={72} height={8} rx={2} fill="var(--muted)" />
        {share ? (
          <rect
            width={Math.max(2, (72 * share) / max)}
            height={8}
            rx={2}
            fill={`var(--chart-${slot})`}
          />
        ) : null}
      </svg>
    </span>
  );
  if (!rows.length)
    return (
      <p className="py-6 text-[12px] text-muted-foreground">
        Neither MDL's filings cite an authority among the most cited.
      </p>
    );
  return (
    <div className="max-h-[440px] overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <caption className="sr-only">
          Authorities cited by MDL {a} and MDL {b}, as a share of each MDL's citing filings
        </caption>
        <thead className="sticky top-0 bg-surface text-[11px] text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-2 py-1 text-left font-medium">
              Authority
            </th>
            <th scope="col" className="px-2 py-1 text-right font-medium">
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-[2px]"
                  style={{ background: "var(--chart-1)" }}
                />
                MDL {a} (
                {ca?.citing !== null && ca?.citing !== undefined
                  ? `${count.full(ca.citing)} citing filings`
                  : "Not recorded"}
                )
              </span>
            </th>
            <th scope="col" className="px-2 py-1 text-right font-medium">
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-[2px]"
                  style={{ background: "var(--chart-2)" }}
                />
                MDL {b} (
                {cb?.citing !== null && cb?.citing !== undefined
                  ? `${count.full(cb.citing)} citing filings`
                  : "Not recorded"}
                )
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/50">
              <th scope="row" className="px-2 py-1 text-left font-normal">
                <AuthorityLink a={r.authority} />
                <span className="block text-[11px] text-muted-foreground">
                  {CLASS_LABEL[r.authority.class]}
                  {authorityLine(r.authority) ? ` · ${authorityLine(r.authority)}` : ""}
                  {r.both ? " · cited in both" : ""}
                </span>
              </th>
              <td className="px-2 py-1">
                <Bar share={r.shareA} slot={1} />
              </td>
              <td className="px-2 py-1">
                <Bar share={r.shareB} slot={2} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The grid across the MDLs with the most citing filings (MDL index). */
export function CitationGridOverview() {
  const q = useQuery(citationGridQuery(null, 30));
  const g = q.data?.available ? q.data.data : null;
  return (
    <ChartFrame
      title="Authorities cited across MDLs"
      unit="share of each MDL's citing filings"
      sources={SOURCES}
      minHeight={320}
      status={
        q.isPending
          ? { kind: "loading" }
          : q.isError
            ? {
                kind: "error",
                message: "The citation grid could not be read just now.",
                onRetry: () => void q.refetch(),
              }
            : q.data && !q.data.available
              ? { kind: "empty", reason: "Citation counts across MDLs are not published yet." }
              : !g?.authorities.length
                ? {
                    kind: "empty",
                    reason: "No MDL filing cites an authority that could be resolved exactly.",
                  }
                : { kind: "ready" }
      }
      notes={[
        "Columns are the MDLs whose filings cite the most resolved authorities; rows are the authorities those filings cite most, grouped by kind.",
        "A cell is the share of that MDL's citing filings that cite the authority; hover or use the arrow keys for the count.",
      ]}
      table={
        g
          ? {
              caption: "Authorities cited across MDLs: filings citing, per MDL",
              columns: [
                { label: "Authority" },
                ...g.mdls.map((m) => ({ label: `MDL ${m.mdl}`, align: "right" as const })),
              ],
              rows: g.authorities.map((a) => ({
                key: a.key,
                cells: [
                  <AuthorityLink key="l" a={a} />,
                  ...g.mdls.map((m) =>
                    count.full(g.cells.find((c) => c[0] === a.key && c[1] === m.mdl)?.[2] ?? 0),
                  ),
                ],
              })),
            }
          : undefined
      }
      footnotes={
        g
          ? [`MDLs: ${g.mdls.map((m) => `${m.mdl} (${m.citing ?? 0} citing filings)`).join(", ")}.`]
          : undefined
      }
    >
      {g ? <AuthorityGrid grid={g} /> : null}
    </ChartFrame>
  );
}

/** One filing's citations, each with how many filings of its MDL (and of every MDL) cite the same authority. */
export function FilingCitationContext({ document }: { document: string }) {
  const q = useQuery(filingCitationsQuery(document));
  if (q.isPending)
    return (
      <p role="status" className="text-[12px] text-muted-foreground">
        Reading the citation context…
      </p>
    );
  if (q.isError)
    return (
      <p role="alert" className="text-[12px] text-muted-foreground">
        The citation context could not be read.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!q.data.available)
    return (
      <p className="text-[12px] text-muted-foreground">Citation context is not published yet.</p>
    );
  const f = q.data.data;
  if (!f.authorities.length)
    return (
      <p className="text-[12px] text-muted-foreground">
        This filing cites no authority that could be resolved exactly.
      </p>
    );
  const total = f.mdlCiting ?? 0;
  return (
    <ul
      className="space-y-1 text-[12px]"
      style={chartTokens}
      aria-label="Authorities this filing cites, with their use in the MDL"
    >
      {f.authorities.slice(0, 12).map((a) => {
        const share = total && a.mdlFilings !== null ? a.mdlFilings / total : null;
        return (
          <li key={a.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
            <span className="min-w-0 truncate">
              <AuthorityLink a={a} />
              <span className="text-muted-foreground">
                {" "}
                · {a.mentions} mention{a.mentions === 1 ? "" : "s"}
                {a.firstPage ? `, first on p. ${a.firstPage}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <svg width={48} height={6} aria-hidden>
                <rect width={48} height={6} rx={2} fill="var(--muted)" />
                {share ? (
                  <rect width={Math.max(2, 48 * share)} height={6} rx={2} fill="var(--chart-1)" />
                ) : null}
              </svg>
              <span className="tabular-nums">
                {a.mdlFilings !== null && total
                  ? `${count.full(a.mdlFilings)} of ${count.full(total)} MDL filings`
                  : "Not recorded"}
              </span>
            </span>
          </li>
        );
      })}
      {f.authorities.length > 12 ? (
        <li className="text-[11px] text-muted-foreground">and {f.authorities.length - 12} more</li>
      ) : null}
    </ul>
  );
}
