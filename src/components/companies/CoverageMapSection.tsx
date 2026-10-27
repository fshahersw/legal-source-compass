/**
 * Products-liability MDL defendant coverage: for every pending products-liability MDL (each counted once), is there a
 * public-company defendant whose own SEC filing acknowledges it (tier A or B), only subject-level evidence (tier C,
 * requires review), a filer that names it without stating its role, or no SEC filer at all? A sunburst partitions the
 * pending actions exactly by those groups and MDLs; a ranked list shows the largest MDLs no SEC filer names.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sunburst } from "@/components/charts/d3/charts";
import { ChartCard } from "@/components/charts/recharts";
import type { TreeNode } from "@/components/charts/d3/maths";
import { chartTokens, seriesVar } from "@/components/charts/palette";
import {
  AiSummary,
  AskAiButton,
  BarList,
  buildSectionContext,
  DataDrawer,
  Section,
} from "@/components/kit";
import { count, mdlTitle, type CompaniesData } from "./companyData";
import {
  COVERAGE_GROUP_LABEL,
  coverageMap,
  coverageTotals,
  type CoverageGroup,
  type CoverageMdl,
} from "./exposure";

const GROUPS: CoverageGroup[] = ["ab", "c", "unclear", "none"];
const SLOT: Record<CoverageGroup, number> = { ab: 0, c: 2, unclear: 3, none: 1 };
const SOURCES = [
  { label: "JPML pending MDL report (mdl_analytics)", url: "https://www.jpml.uscourts.gov/pending-mdls-0" },
  { label: "SEC EDGAR filings (company_sec_mdl_links)", url: "https://efts.sec.gov/LATEST/search-index?q=%22MDL%20No.%22" },
];
const short = (r: CoverageMdl) => {
  const t = mdlTitle(r.title, r.titleTruncated, r.mdl).replace(/ (Products|Marketing|Sales).*$/i, "");
  return `MDL ${r.mdl} · ${t.length > 48 ? `${t.slice(0, 46).trimEnd()}…` : t}`;
};

export function CoverageMapSection({ data }: { data: CompaniesData }) {
  const o = data.overview;
  const change = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const [k, v] of Object.entries(data.mdlChange ?? {})) m.set(Number(k), v);
    return m;
  }, [data.mdlChange]);
  const { rows, noCount } = useMemo(() => coverageMap(o.coverage, change), [o.coverage, change]);
  const totals = useMemo(() => coverageTotals(rows), [rows]);
  const [focus, setFocus] = useState<string | null>(null);
  const root: TreeNode = useMemo(
    () => ({
      name: "Pending products-liability MDLs",
      children: GROUPS.filter((g) => totals.groups[g].mdls).map((g) => ({
        name: COVERAGE_GROUP_LABEL[g],
        slot: SLOT[g],
        children: rows.filter((r) => r.group === g).map((r) => ({ name: short(r), value: r.pending })),
      })),
    }),
    [rows, totals],
  );
  const unlinked = rows.filter((r) => r.group === "none");
  const asOf = o.jpmlAsOf ?? undefined;
  const share = (n: number) =>
    totals.pending ? `${((n / totals.pending) * 100).toFixed(0)}%` : "Not recorded";
  const context = useMemo(
    () =>
      buildSectionContext({
        title: "Products-liability MDL defendant coverage",
        scope: "Pending products-liability MDLs, each counted once",
        period: asOf ? `JPML report ${asOf}` : null,
        source: "JPML pending MDL report; SEC EDGAR filings",
        figures: [
          { label: "Pending products-liability MDLs", value: totals.mdls },
          { label: "Pending actions in them (MDL-wide)", value: totals.pending },
          ...GROUPS.flatMap((g) => [
            { label: `MDLs: ${COVERAGE_GROUP_LABEL[g]}`, value: totals.groups[g].mdls },
            { label: `Pending actions: ${COVERAGE_GROUP_LABEL[g]}`, value: totals.groups[g].pending },
          ]),
          ...unlinked.slice(0, 10).map((r) => ({
            label: `No SEC filer: MDL ${r.mdl} pending actions`,
            value: r.pending,
          })),
        ],
      }),
    [totals, unlinked, asOf],
  );
  if (!rows.length) return null;
  return (
    <Section
      id="coverage"
      title="Which MDL dockets have a public-company defendant?"
      description="Pending products-liability MDLs by the strongest SEC-filing evidence that a registrant is a defendant."
      actions={<AskAiButton sectionId="coverage" context={context} />}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <ChartCard
          variant="editorial"
          title={`${share(totals.groups.ab.pending)} of pending products-liability actions sit in MDLs a public filer acknowledges`}
          subtitle={`Pending actions by evidence group and MDL · actions · ${totals.mdls} MDLs`}
          sources={SOURCES}
          asOf={asOf}
          about={
            <>
              <p>
                Each pending products-liability MDL is counted once, in the group of its strongest
                evidence: a registrant&rsquo;s own filing cites the MDL number or caption and reads
                it as a defendant (tier A or B); only a subject-level description (tier C, requires
                review and never counted); a filer names it without stating its role; or no SEC
                filer names it. Rings partition the pending actions exactly.
              </p>
              <p className="mt-2">
                &ldquo;No SEC filer names it&rdquo; means no qualifying filing was found, not that
                no defendant is public. Pending actions are the whole docket, shared by every
                co-defendant.
                {noCount ? ` ${noCount} MDLs with no pending count are left out.` : ""}
              </p>
            </>
          }
          table={{
            caption: "Pending products-liability MDLs by evidence group",
            columns: [
              { label: "Evidence group" },
              { label: "MDLs", align: "right" },
              { label: "Pending actions", align: "right" },
              { label: "Share of actions", align: "right" },
            ],
            rows: GROUPS.map((g) => ({
              key: g,
              cells: [
                COVERAGE_GROUP_LABEL[g],
                count(totals.groups[g].mdls),
                count(totals.groups[g].pending),
                share(totals.groups[g].pending),
              ],
            })),
          }}
        >
          <Sunburst
            root={root}
            focus={focus}
            onFocusChange={setFocus}
            centerLabel={(v) => `${v.toLocaleString("en-US")} actions`}
          />
          <ul className="mt-3 grid gap-1 text-meta">
            {GROUPS.map((g) => (
              <li key={g} className="flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  onMouseEnter={() => setFocus(COVERAGE_GROUP_LABEL[g])}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(COVERAGE_GROUP_LABEL[g])}
                  onBlur={() => setFocus(null)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ ...chartTokens, background: seriesVar(SLOT[g]) }}
                  />
                  <span className="truncate">{COVERAGE_GROUP_LABEL[g]}</span>
                </button>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {count(totals.groups[g].mdls)} MDLs · {count(totals.groups[g].pending)}
                </span>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard
          variant="editorial"
          title={
            unlinked[0]
              ? `${count(unlinked.length)} pending MDLs have no SEC filer naming them; the largest holds ${count(unlinked[0].pending)} actions`
              : "Every pending products-liability MDL has an SEC filer naming it"
          }
          subtitle="Pending MDLs no SEC filer names, by pending actions · 12-month change · MDL-wide"
          sources={SOURCES}
          asOf={asOf}
          status={
            unlinked.length
              ? { kind: "ready" }
              : { kind: "empty", reason: "No pending products-liability MDL lacks an SEC filer." }
          }
          about={
            <p>
              Defendants here may be private, foreign or non-filers, or their filings may not cite
              the MDL. Collectability and settlement capacity cannot be read from SEC filings for
              these dockets. Never inferred from a caption.
            </p>
          }
          actions={
            <DataDrawer
              title="Pending products-liability MDLs and the SEC filers that name them"
              rows={rows}
              rowKey={(r) => String(r.mdl)}
              triggerLabel={`View all ${rows.length}`}
              searchable
              columns={[
                {
                  key: "mdl",
                  label: "MDL",
                  value: (r) => r.mdl,
                  render: (r) => (
                    <Link
                      to="/records/$dataset/$id"
                      params={{ dataset: "mdl_analytics", id: String(r.mdl) }}
                      className="text-primary hover:underline"
                    >
                      {r.mdl}
                    </Link>
                  ),
                },
                { key: "title", label: "Litigation", value: (r) => mdlTitle(r.title, r.titleTruncated, r.mdl) },
                { key: "pending", label: "Pending actions", align: "right", value: (r) => r.pending },
                { key: "change", label: "12-month change", align: "right", value: (r) => r.change12m },
                { key: "group", label: "Evidence", value: (r) => COVERAGE_GROUP_LABEL[r.group] },
                {
                  key: "filers",
                  label: "SEC filers (tier, role)",
                  value: (r) =>
                    r.companies.map((c) => `${c.name} (${c.tier}, ${c.role})`).join("; ") || null,
                },
              ]}
              source={{
                source: SOURCES.map((s) => ({ label: s.label, href: s.url })),
                ...(asOf ? { asOf } : {}),
              }}
            />
          }
        >
          <BarList
            ariaLabel="Largest pending MDLs with no SEC filer naming them"
            items={unlinked.slice(0, 10).map((r) => ({
              id: String(r.mdl),
              label: short(r),
              value: r.pending,
              display: count(r.pending),
              note:
                r.change12m === null
                  ? "12-month change not recorded"
                  : `${r.change12m >= 0 ? "+" : ""}${r.change12m.toLocaleString("en-US")} in 12 months`,
              to: `/records/mdl_analytics/${r.mdl}`,
            }))}
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}
