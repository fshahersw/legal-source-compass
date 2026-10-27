/**
 * Defendant disclosure radar on /companies/legal-proceedings: which tracked product torts companies name in their own
 * Form 10-K (Item 3 and the litigation notes), by fiscal year, and which companies named one for the first time. A
 * mention is not MDL membership and never counts toward exposure.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heatmap } from "@/components/charts/Heatmap";
import { metricFormatter } from "@/components/charts/format";
import { ChartCard } from "@/components/charts/recharts";
import {
  AiSummary,
  AskAiButton,
  BarList,
  buildSectionContext,
  DataDrawer,
  KpiCard,
  KpiGrid,
  Section,
} from "@/components/kit";
import { getDisclosureRadar } from "@/lib/external/companyDisclosure.functions";
import { TORT_TERMS } from "@/lib/external/companyDisclosure";

export const disclosureRadarQuery = {
  queryKey: ["company-disclosure-radar"],
  queryFn: () => getDisclosureRadar(),
  staleTime: 10 * 60 * 1000,
};

const SOURCE = {
  label: "SEC EDGAR Form 10-K, Item 3 and litigation notes (company_sec_legal_proceedings)",
  url: "https://www.sec.gov/edgar/search/",
};
const fmt = (v: number) => v.toLocaleString("en-US");
const LABEL = new Map(TORT_TERMS.map((t) => [t.id, t.label]));

export function DisclosureRadarSection() {
  const q = useQuery(disclosureRadarQuery);
  const d = q.data;
  const latest = d?.years.at(-1) ?? null;
  const readYear = d ? d.readAt.slice(0, 4) : null;
  const latestPartial = latest !== null && readYear !== null && latest >= readYear;
  const termsShown = useMemo(
    () =>
      d ? TORT_TERMS.filter((t) => d.cells.some((c) => c.term === t.id && c.companies > 0)) : [],
    [d],
  );
  const cell = (term: string, fy: string) => d?.cells.find((c) => c.term === term && c.fy === fy);
  const newLatest = useMemo(
    () => (d && latest ? d.firsts.filter((f) => f.fy === latest) : []),
    [d, latest],
  );
  const newTerms = new Set(newLatest.map((f) => f.term));
  const newMdls = d && latest ? d.newMdls.filter((m) => m.fy === latest) : [];
  const byTerm = [...newTerms]
    .map((t) => ({ id: t, n: newLatest.filter((f) => f.term === t).length }))
    .sort((a, b) => b.n - a.n);
  const period = d?.years.length ? `FY${d.years[0]}–FY${latest}` : undefined;
  const status = q.isPending
    ? ({ kind: "loading" } as const)
    : q.isError
      ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
      : !termsShown.length || !d?.years.length
        ? ({
            kind: "empty",
            reason: "No tracked term was found in the 10-K text held here.",
          } as const)
        : ({ kind: "ready" } as const);
  const context = useMemo(
    () =>
      d && latest
        ? buildSectionContext({
            title: "Defendant disclosure radar",
            scope: "Product torts named in companies' own 10-K Item 3 and litigation notes",
            period: period ?? null,
            source: SOURCE.label,
            figures: [
              { label: "10-K filings read", value: d.filings },
              { label: "Companies", value: d.companies },
              { label: "First-time disclosures", value: newLatest.length, period: `FY${latest}` },
              {
                label: "MDL numbers cited for the first time",
                value: newMdls.length,
                period: `FY${latest}`,
              },
              ...d.cells
                .filter((c) => c.companies > 0)
                .map((c) => ({
                  label: `Companies naming ${LABEL.get(c.term) ?? c.term}`,
                  value: c.companies,
                  period: `FY${c.fy}`,
                })),
              ...newLatest.slice(0, 15).map((f) => ({
                label: `First disclosure: ${f.company}, ${LABEL.get(f.term) ?? f.term}`,
                value: f.accession,
                period: `FY${f.fy}`,
              })),
            ],
            maxFigures: 80,
          })
        : null,
    [d, latest, period, newLatest, newMdls.length],
  );

  return (
    <Section
      id="radar"
      title="Which torts are defendants starting to disclose?"
      description="Product torts named in each company's own 10-K, and who named one for the first time."
      actions={<AskAiButton sectionId="radar" context={context} />}
    >
      <KpiGrid columns={4} label="Disclosure radar figures">
        <KpiCard
          as="li"
          label="10-K filings read"
          value={d ? fmt(d.filings) : null}
          meta={d ? `${fmt(d.companies)} companies` : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "SEC EDGAR 10-K", href: SOURCE.url } }}
        />
        <KpiCard
          as="li"
          label={latest ? `First-time disclosures, FY${latest}` : "First-time disclosures"}
          value={d ? fmt(newLatest.length) : null}
          meta="a tracked tort absent from the company's earlier 10-K here"
          partial={latestPartial ? `FY${latest} is still being filed.` : undefined}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "SEC EDGAR 10-K", href: SOURCE.url } }}
        />
        <KpiCard
          as="li"
          label={latest ? `Torts newly disclosed, FY${latest}` : "Torts newly disclosed"}
          value={d ? fmt(newTerms.size) : null}
          meta={`of ${TORT_TERMS.length} tracked terms`}
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "SEC EDGAR 10-K", href: SOURCE.url } }}
        />
        <KpiCard
          as="li"
          label={latest ? `MDL numbers cited first, FY${latest}` : "MDL numbers cited first"}
          value={d ? fmt(newMdls.length) : null}
          meta="by companies citing them for the first time"
          state={q.isPending ? "loading" : "ready"}
          source={{ source: { label: "SEC EDGAR 10-K", href: SOURCE.url } }}
        />
      </KpiGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartCard
          variant="editorial"
          title={
            byTerm[0] && latest
              ? `${LABEL.get(byTerm[0].id)} had the most first-time disclosures in FY${latest}`
              : "Companies naming each tort in their 10-K"
          }
          subtitle={`Companies whose 10-K names the tort · companies · ${period ?? ""}`}
          status={status}
          sources={[SOURCE]}
          period={period}
          partial={latestPartial ? `FY${latest} is still being filed.` : undefined}
          about={
            <>
              <p>
                Each cell counts the companies whose Form 10-K for that fiscal year names the tort
                in Item 3 or the litigation notes it points to. A mention is the company&rsquo;s own
                disclosure, not MDL membership, and never counts toward exposure.
              </p>
              <p className="mt-2">
                Fiscal years with fewer than 20 filings held are left out (the corpus holds few
                10-Ks before FY2023). Terms match whole words; &ldquo;NEC&rdquo; counts only next to
                formula, infant, preterm or premature. The tooltip shows how many companies named
                the tort for the first time that year.
              </p>
            </>
          }
          table={{
            caption: "Companies naming each tort, by fiscal year",
            columns: [
              { label: "Tort" },
              ...(d?.years ?? []).map((y) => ({ label: `FY${y}`, align: "right" as const })),
            ],
            rows: termsShown.map((t) => ({
              key: t.id,
              cells: [
                t.label,
                ...(d?.years ?? []).map((y) => {
                  const c = cell(t.id, y);
                  return c
                    ? `${fmt(c.companies)}${c.firsts ? ` (${c.firsts} new)` : ""}`
                    : "Not recorded";
                }),
              ],
            })),
          }}
        >
          <Heatmap
            rows={termsShown.map((t) => ({ id: t.id, label: t.label }))}
            columns={(d?.years ?? []).map((y) => ({ id: y, label: `FY${y}` }))}
            value={(r, c) => cell(r, c)?.companies ?? null}
            formatter={metricFormatter("count")}
            cellLabels
            cellNote={(r, c) => {
              const x = cell(r, c);
              return x?.firsts ? `${x.firsts} named it for the first time` : undefined;
            }}
            ariaLabel="Companies naming each tort in their 10-K, by fiscal year"
          />
        </ChartCard>

        <ChartCard
          variant="editorial"
          title={latest ? `New disclosures in FY${latest}, by tort` : "New disclosures, by tort"}
          subtitle="Companies naming the tort for the first time · companies"
          status={
            status.kind === "ready" && !byTerm.length
              ? {
                  kind: "empty",
                  reason: `No company named a tracked tort for the first time in FY${latest}.`,
                }
              : status
          }
          sources={[SOURCE]}
          period={latest ? `FY${latest}` : undefined}
          actions={
            d?.firsts.length ? (
              <DataDrawer
                title="First-time disclosures of a tracked tort"
                description="Verbatim words around the first mention, with the filing. A mention is not MDL membership."
                rows={d.firsts}
                rowKey={(f) => `${f.cik}-${f.term}-${f.fy}`}
                triggerLabel={`View all ${fmt(d.firsts.length)}`}
                searchable
                columns={[
                  { key: "fy", label: "Fiscal year", value: (f) => `FY${f.fy}` },
                  { key: "term", label: "Tort", value: (f) => LABEL.get(f.term) ?? f.term },
                  { key: "company", label: "Company (as filed)", value: (f) => f.company },
                  {
                    key: "prior",
                    label: "Earlier 10-K without it",
                    value: (f) => `FY${f.priorFy}`,
                  },
                  {
                    key: "filing",
                    label: "Filing",
                    value: (f) => f.accession,
                    render: (f) =>
                      f.url ? (
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {f.accession}
                        </a>
                      ) : (
                        f.accession
                      ),
                  },
                  { key: "excerpt", label: "Excerpt (verbatim)", value: (f) => f.excerpt },
                ]}
                source={{ source: { label: SOURCE.label, href: SOURCE.url } }}
              />
            ) : null
          }
        >
          <BarList
            ariaLabel="New disclosures by tort"
            items={byTerm.map((t) => ({
              id: t.id,
              label: LABEL.get(t.id) ?? t.id,
              value: t.n,
              display: fmt(t.n),
              note: newLatest
                .filter((f) => f.term === t.id)
                .map((f) => f.company)
                .slice(0, 3)
                .join("; "),
            }))}
          />
        </ChartCard>
      </div>
      <AiSummary context={context} className="mt-4" />
    </Section>
  );
}
