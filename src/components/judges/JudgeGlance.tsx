/**
 * "At a glance": the first section of a judge page. Up to six KPI tiles (JPML MDL load, CJRA docket flow, the
 * CourtListener collection, recorded expert rulings), then the docket-flow trend, the docket mix and, once published,
 * the recorded expert rulings, with an AI summary built only from the figures shown. Renders nothing when no source
 * holds anything for this judge (so the section drops out of the page).
 */
import { useQuery } from "@tanstack/react-query";
import {
  AiSummary,
  AskAiButton,
  KpiCard,
  KpiCardSkeleton,
  KpiGrid,
  buildSectionContext,
} from "@/components/kit";
import { JudgeDocketHealthCard } from "./JudgeDocketHealthCard";
import { JudgeDocketMixCard } from "./JudgeDocketMixCard";
import { JudgeExpertRulingsCard } from "./JudgeExpertRulingsCard";
import {
  GLANCE_QUESTIONS,
  glanceFigures,
  glanceHasData,
  glanceKpis,
  glanceScope,
  type GlanceInput,
} from "./judgeGlanceView";
import {
  judgeCjraQuery,
  judgeCourtListenerQuery,
  judgeCrossProfileQuery,
  judgeRulingsQuery,
} from "./judgeQueries";

export function JudgeGlance({ judgeId, name }: { judgeId: string; name: string }) {
  const cross = useQuery(judgeCrossProfileQuery(judgeId));
  const cl = useQuery(judgeCourtListenerQuery(judgeId));
  const cjra = useQuery(judgeCjraQuery(judgeId));
  const rulings = useQuery(judgeRulingsQuery(judgeId));
  const loading = cross.isPending || cl.isPending || cjra.isPending;
  if (loading)
    return (
      <KpiGrid columns={3} label="Loading judge figures">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <KpiCardSkeleton />
          </li>
        ))}
      </KpiGrid>
    );
  const crosswalk = cl.data?.crosswalk ?? null;
  const clPersonId = crosswalk?.linked ? crosswalk.clPersonId : null;
  const input: GlanceInput = {
    cross: cross.data ?? null,
    cjra: cjra.data ?? null,
    activity: crosswalk?.linked ? (cl.data?.activity ?? null) : null,
    clPersonId,
    rulings: rulings.data ? rulings.data.rulings.length : null,
  };
  const failed = [cross, cl, cjra].filter((q) => q.isError).length;
  if (!glanceHasData(input))
    return failed ? (
      <p role="alert" className="text-meta text-muted-foreground">
        Some figures for this judge could not be read just now.
      </p>
    ) : null;
  const kpis = glanceKpis(input);
  const context = buildSectionContext({
    id: "judge-glance",
    title: `${name}: docket and MDL figures`,
    scope: glanceScope(name),
    source: "JPML pending MDL report; U.S. Courts CJRA reports; CourtListener collection",
    figures: glanceFigures(kpis, input),
  });
  const dockets = input.activity?.dockets ?? null;
  return (
    <div className="space-y-4">
      <KpiGrid columns={kpis.length > 4 ? 3 : 4} label={`${name}: key figures`}>
        {kpis.map((k) => (
          <KpiCard
            key={k.id}
            as="li"
            size="sm"
            label={k.label}
            value={k.value}
            meta={k.meta}
            source={{ source: k.source, ...(k.period ? { period: k.period } : {}) }}
          />
        ))}
      </KpiGrid>
      {failed ? (
        <p role="alert" className="text-meta text-muted-foreground">
          Some figures could not be read just now; their tiles show Not recorded.
        </p>
      ) : null}
      <div className="flex flex-wrap items-start gap-3">
        <AiSummary context={context} className="min-w-0 flex-1" />
        <AskAiButton
          sectionId="judge-glance"
          title={`${name}: docket and MDL figures`}
          context={context}
          questions={GLANCE_QUESTIONS}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {input.cjra ? <JudgeDocketHealthCard cjra={input.cjra} cross={input.cross} /> : null}
        {dockets && clPersonId !== null ? (
          <JudgeDocketMixCard dockets={dockets} personId={clPersonId} />
        ) : null}
      </div>
      <JudgeExpertRulingsCard data={rulings.data} />
      <p className="text-meta text-muted-foreground">
        Recorded figures only. They describe dockets and reports as published and do not predict how
        this judge will rule.
      </p>
    </div>
  );
}
