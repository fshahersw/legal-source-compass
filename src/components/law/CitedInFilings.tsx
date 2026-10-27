/**
 * USC and CFR section pages: the court filings in this atlas that cite the section (citations layer, resolved to this
 * exact record), by MDL and by filing year, with the authorities most often cited beside it. MDL is the docket's own
 * MDL as the docket source assigns it, never inferred. Renders nothing when the layer is not published or no filing
 * cites the section.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  RankBars,
  TrendColumns,
  periodTable,
  rankTakeaway,
  trendTakeaway,
} from "@/components/charts/recharts";
import { Button } from "@/components/ui/button";
import {
  AiSummary,
  AskAiButton,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
  buildSectionContext,
} from "@/components/kit";
import { getAuthorityProfile, getCitedBy } from "@/lib/citations/citations.functions";
import type { CitedBy } from "@/lib/citations/graph";
import {
  CITED_BY_PAGE,
  CITED_BY_MAX_PAGES,
  citationYears,
  citingListLabel,
} from "@/lib/law/citedIn";

/** The court-filings layer of this atlas (several docket sources), listed on its own documents page. */
const SOURCE = {
  label: "Court filings in this atlas (citations extracted from filing text)",
  url: "/litigation/documents",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const ID = "cited-in-filings";
type Citing = CitedBy["list"][number];

/** Every citing filing (newest first), read page by page through the cited-by read; capped at the page limit. */
async function readAllCiting(
  dataset: "us_code_sections" | "ecfr_sections_full",
  id: string,
  total: number,
): Promise<Citing[]> {
  const out: Citing[] = [];
  const pages = Math.min(Math.ceil(total / CITED_BY_PAGE), CITED_BY_MAX_PAGES);
  for (let page = 1; page <= pages; page++) {
    const r = await getCitedBy({ data: { key: null, dataset, id, page, limit: CITED_BY_PAGE } });
    if (!r.available || !r.value) break;
    out.push(...r.value.list);
    if (r.value.list.length < CITED_BY_PAGE) break;
  }
  return out;
}

export function CitedInFilings({
  dataset,
  id,
  citation,
}: {
  dataset: "us_code_sections" | "ecfr_sections_full";
  id: string;
  citation: string;
}) {
  const q = useQuery({
    queryKey: ["law", "cited-in", dataset, id],
    queryFn: () => getAuthorityProfile({ data: { key: null, dataset, id } }),
    staleTime: 10 * 60 * 1000,
  });
  const p = q.data && q.data.available ? q.data.value : null;
  const [wantAll, setWantAll] = useState(false);
  const all = useQuery({
    queryKey: ["law", "cited-in-all", dataset, id],
    queryFn: () => readAllCiting(dataset, id, p?.documents ?? 0),
    enabled: wantAll && !!p && p.documents > p.list.length,
    staleTime: 10 * 60 * 1000,
  });
  if (!p || p.documents <= 0) return null;
  const listRows: Citing[] = all.data ?? p.list;
  const listLabel = citingListLabel(listRows.length, p.documents, all.isFetching);
  const years = citationYears(p.byYear);
  const mdls = p.byMdl.map(([m, n]) => ({ id: m, label: `MDL ${m}`, value: n }));
  const period =
    p.firstFiled && p.lastFiled
      ? `${p.firstFiled.slice(0, 4)}–${p.lastFiled.slice(0, 4)}`
      : undefined;
  const context = buildSectionContext({
    id: ID,
    title: `Court filings citing ${citation}`,
    scope: "Court filings in this atlas",
    period: period ?? null,
    source: SOURCE.label,
    figures: [
      { label: "Filings citing the section", value: p.documents },
      { label: "Mentions in those filings", value: p.mentions },
      { label: "MDLs with a citing filing", value: p.byMdl.length },
      ...mdls.slice(0, 6).map((m) => ({ label: `Filings in ${m.label}`, value: m.value })),
      ...p.coCited.slice(0, 4).map((c) => ({
        label: `Also cited with: ${c.label}`,
        value: c.documentsTogether,
        unit: "filings",
      })),
    ],
  });
  return (
    <Section
      id={ID}
      title="Cited in court filings"
      description={`Filings in this atlas that cite ${citation}.`}
      actions={
        <AskAiButton
          sectionId={ID}
          title={`Filings citing ${citation}`}
          context={context}
          size="icon"
        />
      }
    >
      <KpiGrid columns={4} label="Filings citing this section">
        <KpiCard
          as="li"
          size="sm"
          label="Filings"
          value={fmt(p.documents)}
          meta={period}
          source={{ source: SOURCE }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Mentions"
          value={fmt(p.mentions)}
          meta="Full and short cites"
          source={{ source: SOURCE }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="MDLs"
          value={fmt(p.byMdl.length)}
          meta={mdls[0] ? `Most: ${mdls[0].label}` : undefined}
          source={{ source: SOURCE }}
        />
        <KpiCard
          as="li"
          size="sm"
          label="Latest citing filing"
          value={p.lastFiled}
          meta={p.undated ? `${fmt(p.undated)} undated` : undefined}
          source={{ source: SOURCE }}
        />
      </KpiGrid>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          variant="editorial"
          title={
            rankTakeaway(mdls, fmt, { verb: "has the most citing filings," }) ??
            "Citing filings by MDL"
          }
          subtitle="Filings citing the section, by the MDL their docket belongs to"
          sources={[SOURCE]}
          period={period}
          about={
            <p>
              Counts cover only filings held in this atlas&apos;s court-filings layer, not every
              filing in these cases. A filing&apos;s MDL is the one its docket source assigns.
            </p>
          }
          table={{
            caption: `Filings citing ${citation} by MDL`,
            columns: [{ label: "MDL" }, { label: "Filings" }],
            rows: mdls.map((m) => ({ key: m.id, cells: [m.label, m.value] })),
          }}
          actions={
            <DataDrawer
              title={`Filings citing ${citation}`}
              description={`${listLabel} First page and pinpoints as extracted.`}
              trigger={
                <Button variant="outline" size="sm" onClick={() => setWantAll(true)}>
                  <Table2 />
                  {`View data (${fmt(p.documents)})`}
                </Button>
              }
              filename={`filings-citing-${citation.replace(/\W+/g, "-")}`}
              rows={listRows}
              rowKey={(d) => d.id}
              searchable
              source={{ source: SOURCE }}
              columns={[
                { key: "filed", label: "Filed", value: (d) => d.filedDate },
                { key: "title", label: "Filing", value: (d) => d.title ?? "Untitled filing" },
                { key: "court", label: "Court", value: (d) => d.courtId },
                {
                  key: "mdl",
                  label: "MDL",
                  value: (d) => d.mdl,
                  render: (d) =>
                    d.mdl ? (
                      <Link
                        to="/litigation/documents"
                        search={{ mdl: d.mdl }}
                        className="text-primary hover:underline"
                      >
                        {d.mdl}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Not recorded</span>
                    ),
                },
                { key: "mentions", label: "Mentions", align: "right", value: (d) => d.mentions },
                { key: "page", label: "First page", align: "right", value: (d) => d.firstPage },
                {
                  key: "pins",
                  label: "Pinpoints",
                  value: (d) => (d.pins.length ? d.pins.join("; ") : null),
                },
              ]}
            />
          }
        >
          <RankBars
            items={mdls}
            format={fmt}
            limit={10}
            ariaLabel={`Filings citing ${citation} by MDL`}
          />
        </ChartCard>
        <ChartCard
          variant="editorial"
          title={
            trendTakeaway(
              "Citing filings",
              years.map((y) => ({
                label: y.year,
                value: y.filings,
                partial: y.year === String(new Date().getUTCFullYear()),
              })),
              fmt,
            ) ?? "Citing filings per year"
          }
          subtitle="Citing filings per filing year"
          sources={[SOURCE]}
          period={period}
          table={periodTable(years, "year", [{ key: "filings", label: "Filings" }], fmt, {
            caption: `Filings citing ${citation} per year`,
            xLabel: "Year",
          })}
          footnotes={
            p.coCited.length
              ? [
                  `Also cited with: ${p.coCited
                    .slice(0, 5)
                    .map((c) => `${c.label} (${fmt(c.documentsTogether)})`)
                    .join("; ")}.`,
                ]
              : undefined
          }
        >
          {years.length > 1 ? (
            <TrendColumns
              rows={years}
              xKey="year"
              series={[{ key: "filings", label: "Filings" }]}
              format={fmt}
              height={200}
              ariaLabel={`Filings citing ${citation} per year`}
            />
          ) : (
            <p className="text-meta text-muted-foreground">
              All dated citing filings fall in one year.
            </p>
          )}
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-3" />
    </Section>
  );
}
