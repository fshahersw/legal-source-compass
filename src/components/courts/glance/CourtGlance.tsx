/**
 * The court profile's answer strip: up to four headline figures (filings, pending cases, pending MDLs, sitting
 * judges) read from the same queries as the panels below (React Query shares them, so nothing is fetched twice),
 * with an AI summary and Ask AI grounded in exactly these figures. A figure the sources do not record for this court
 * is left out of the strip; the strip is not drawn when none is recorded.
 */
import { useQuery } from "@tanstack/react-query";
import { KpiStrip } from "@/components/kit/KpiCard";
import type { KpiCardProps } from "@/components/kit/KpiCard";
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { buildSectionContext, type FigureInput } from "@/components/kit/ai/buildSectionContext";
import { getCourtAnalytics } from "@/lib/external/courtAnalytics.functions";
import { getCourtSittingJudges, getCourtVacancies } from "@/lib/external/judiciary.functions";
import { latestWithYear } from "./courtGlance";

const FCMS = {
  label: "U.S. Courts, Federal Court Management Statistics",
  href: "https://www.uscourts.gov/data-news/reports/statistical-reports/federal-court-management-statistics/federal-court-management-statistics-june-2026",
};
const JPML = {
  label: "JPML pending MDL report",
  href: "https://www.jpml.uscourts.gov/pending-mdl-reports-archive",
};
const FJC = {
  label: "Federal Judicial Center, Biographical Directory",
  href: "https://www.fjc.gov/history/judges/biographical-directory-article-iii-federal-judges-export",
};

const fmt = (v: number) => v.toLocaleString("en-US");
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

export function CourtGlance({ courtId, courtName }: { courtId: string; courtName: string }) {
  const analytics = useQuery({
    queryKey: ["court-analytics", courtId],
    queryFn: () => getCourtAnalytics({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  const judges = useQuery({
    queryKey: ["court-sitting-judges", courtId],
    queryFn: () => getCourtSittingJudges({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  const vacancies = useQuery({
    queryKey: ["judiciary-court-vacancies", courtId],
    queryFn: () => getCourtVacancies({ data: { id: courtId } }),
    staleTime: 10 * 60 * 1000,
  });
  const loading = analytics.isPending || judges.isPending || vacancies.isPending;
  const court = analytics.data?.court ?? null;
  const filings = court ? latestWithYear(court.years, court.metrics["filings"]) : null;
  const pending = court ? latestWithYear(court.years, court.metrics["pending"]) : null;
  const sitting = judges.data?.length ? judges.data.length : null;
  const current = vacancies.data
    ? vacancies.data.open.length + vacancies.data.announced.length
    : null;

  const items: (KpiCardProps & { key: string })[] = [];
  const figures: FigureInput[] = [];
  if (filings) {
    const period = `12 months to June 30, ${filings.year}`;
    items.push({
      key: "filings",
      label: "Cases filed",
      value: fmt(filings.value),
      meta: period,
      delta:
        filings.changePct == null
          ? null
          : {
              value: filings.changePct,
              text: signed(filings.changePct),
              detail: `vs ${filings.year - 1}`,
            },
      source: { source: FCMS },
    });
    figures.push({ label: "Cases filed", value: filings.value, unit: "cases", period });
    if (filings.changePct != null)
      figures.push({
        label: "Cases filed, change on the year before",
        value: filings.changePct,
        unit: "%",
        decimals: 1,
      });
  }
  if (pending) {
    const period = `June 30, ${pending.year}`;
    items.push({
      key: "pending",
      label: "Cases pending",
      value: fmt(pending.value),
      meta: period,
      source: { source: FCMS },
    });
    figures.push({ label: "Cases pending", value: pending.value, unit: "cases", period });
  }
  if (court?.mdls.length) {
    items.push({
      key: "mdls",
      label: "Pending MDLs",
      value: fmt(court.mdls.length),
      meta: `${fmt(court.mdl_actions)} actions · JPML ${court.mdl_as_of}`,
      source: { source: JPML },
    });
    figures.push(
      { label: "Pending MDLs", value: court.mdls.length, unit: "MDLs", period: court.mdl_as_of },
      {
        label: "Actions pending in those MDLs",
        value: court.mdl_actions,
        unit: "actions",
        period: court.mdl_as_of,
      },
    );
  }
  if (sitting != null) {
    items.push({
      key: "judges",
      label: "Sitting Article III judges",
      value: fmt(sitting),
      meta:
        current != null
          ? `${fmt(current)} current or announced vacanc${current === 1 ? "y" : "ies"}`
          : undefined,
      source: { source: FJC },
    });
    figures.push({ label: "Sitting Article III judges", value: sitting, unit: "judges" });
    if (current != null)
      figures.push({ label: "Current or announced vacancies", value: current, unit: "vacancies" });
  }

  if (loading)
    return (
      <div
        className="h-28 animate-pulse rounded-xl border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading headline figures"
      />
    );
  if (!items.length) return null;

  const context = buildSectionContext({
    id: "court-glance",
    title: `${courtName}: headline figures`,
    scope: courtName,
    source: [
      filings || pending ? FCMS.label : null,
      court?.mdls.length ? JPML.label : null,
      sitting != null ? FJC.label : null,
    ]
      .filter(Boolean)
      .join("; "),
    figures,
  });

  return (
    <div className="space-y-3" id="court-glance">
      <KpiStrip
        items={items}
        label={`${courtName} headline figures`}
        cellBasis="basis-[calc(50%-1px)] xl:basis-[calc(25%-1px)]"
      />
      <AiSummary
        context={context}
        actions={
          <AskAiButton
            sectionId="court-glance"
            title={`${courtName}: headline figures`}
            context={context}
            questions={[
              "How busy is this court compared with a year earlier?",
              "Which MDLs are pending here?",
              "What should I know about this court's bench?",
            ]}
          />
        }
      />
    </div>
  );
}
