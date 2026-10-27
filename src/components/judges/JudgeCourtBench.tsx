/**
 * Same-court comparison on /judges/analytics: the district judges listed in a court's latest CJRA report, side by side
 * with the court median, on docket-flow measures only. Nothing leads a row and nothing is sorted by value: it is
 * context for one court, not a ranking, and never covers ruling outcomes.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BenchMatrix, ChartCard } from "@/components/charts/recharts";
import { AiSummary, AskAiButton, DataDrawer, buildSectionContext } from "@/components/kit";
import { CJRA_SOURCE } from "@/lib/external/judgeCjra.functions";
import { benchMeasures, benchModel } from "./judgeBenchView";
import { judgeCrossQuery } from "./judgeCrossQuery";
import { shortDate } from "./judgeGlanceView";
import { courtBenchQuery } from "./judgeQueries";

export function JudgeCourtBench() {
  const cross = useQuery(judgeCrossQuery);
  const districts = useMemo(
    () =>
      [...(cross.data?.national?.rows ?? [])]
        .filter((r) => /^[a-z0-9]{2,12}$/.test(r.courtId))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [cross.data],
  );
  const fallback = useMemo(
    () =>
      [...districts].sort(
        (a, b) => b.pendingActions - a.pendingActions || a.name.localeCompare(b.name),
      )[0]?.courtId ?? null,
    [districts],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const court = picked ?? fallback;
  const q = useQuery({ ...courtBenchQuery(court ?? "none"), enabled: !!court });
  const bench = q.data ?? null;
  const period = bench?.period ? shortDate(bench.period) : null;
  const model = bench && bench.judges.length ? benchModel(bench, period) : null;
  const courtName = districts.find((d) => d.courtId === court)?.name ?? bench?.court ?? court ?? "";
  const context = model
    ? buildSectionContext({
        id: "court-bench",
        title: `Same-court docket flow: ${courtName}`,
        scope: `${courtName} · district judges in the latest CJRA report · context, not a ranking or a prediction`,
        ...(period ? { period } : {}),
        source: "U.S. Courts CJRA reports; CourtListener collection",
        figures: [
          { label: "District judges listed", value: bench!.judges.length },
          ...benchMeasures(period).map((m) => ({
            label: `Court median: ${m.label}`,
            value: model.medians[m.key].value,
            note: `${model.medians[m.key].n} judges with a value`,
            ...(m.key === "productShare" ? { unit: "%", decimals: 1 } : {}),
          })),
        ],
      })
    : null;
  const status =
    cross.isPending || (court && q.isPending)
      ? ({ kind: "loading" } as const)
      : q.isError || cross.isError
        ? ({ kind: "error", onRetry: () => void q.refetch() } as const)
        : !model
          ? ({
              kind: "empty",
              reason: "No district judge of this court is listed in the latest CJRA report.",
            } as const)
          : ({ kind: "ready" } as const);
  return (
    <section
      id="court-bench"
      aria-labelledby="court-bench-title"
      className="scroll-mt-16 space-y-3"
    >
      <h2 id="court-bench-title" className="text-title font-semibold">
        Same-court comparison
      </h2>
      <ChartCard
        variant="editorial"
        title={`Docket flow of the district judges in ${courtName || "one court"}, beside the court median`}
        subtitle={`Counts and medians · ${courtName}${period ? ` · CJRA report of ${period}` : ""} · no row is ranked`}
        status={status}
        sources={[
          { label: CJRA_SOURCE.label, url: bench?.sourceUrl ?? CJRA_SOURCE.url },
          {
            label: "CourtListener, bulk data",
            url: "https://www.courtlistener.com/help/api/bulk-data/",
          },
        ]}
        {...(period ? { period } : {})}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-meta text-muted-foreground" htmlFor="court-bench-court">
              Court
            </label>
            <select
              id="court-bench-court"
              className="rounded-md border border-border bg-surface px-2 py-1 text-meta"
              value={court ?? ""}
              onChange={(e) => setPicked(e.target.value || null)}
            >
              {districts.map((d) => (
                <option key={d.courtId} value={d.courtId}>
                  {d.name}
                </option>
              ))}
            </select>
            <AskAiButton sectionId="court-bench" context={context} size="icon" />
          </div>
        }
        about={
          <div className="space-y-2">
            <p>
              Judges listed as district judges in the court&apos;s latest CJRA report, in surname
              order. CJRA counts are judge-reported lists of motions and cases pending past a
              threshold, not a measure of speed or quality. Civil cases over three years include MDL
              member cases, which districts report differently.
            </p>
            <p>
              Median days and product share come from the CourtListener collection, only for judges
              linked to a person there by an exact crosswalk tier; they are not a complete caseload.
              A court median needs at least three values. No row says which value leads, and ruling
              outcomes are never compared here.
            </p>
          </div>
        }
      >
        {model ? (
          <BenchMatrix
            columns={model.columns}
            groups={model.groups}
            ariaLabel={`Docket-flow measures of the district judges in ${courtName}, with the court median`}
          />
        ) : null}
      </ChartCard>
      {model && bench ? (
        <div className="flex flex-wrap items-start gap-3">
          <AiSummary context={context} className="min-w-0 flex-1" />
          <DataDrawer
            title={`District judges in ${courtName}: docket flow`}
            rows={bench.judges}
            rowKey={(j) => j.recordId}
            columns={[
              {
                key: "name",
                label: "Judge",
                value: (j) => j.name,
                render: (j) =>
                  j.profileId ? (
                    <Link
                      to="/judges/$id"
                      params={{ id: j.profileId }}
                      className="text-primary hover:underline"
                    >
                      {j.name}
                    </Link>
                  ) : (
                    j.name
                  ),
              },
              { key: "m6", label: "Motions > 6 months", align: "right", value: (j) => j.motions6m },
              { key: "c3", label: "Civil > 3 years", align: "right", value: (j) => j.civil3y },
              {
                key: "days",
                label: "Median days, civil",
                align: "right",
                value: (j) => j.medianDaysCivil,
              },
              { key: "dn", label: "n (days)", align: "right", value: (j) => j.medianDaysN },
              { key: "ps", label: "Product share %", align: "right", value: (j) => j.productShare },
            ]}
            source={{
              source: [{ label: CJRA_SOURCE.label, href: bench.sourceUrl ?? CJRA_SOURCE.url }],
              ...(period ? { period } : {}),
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
