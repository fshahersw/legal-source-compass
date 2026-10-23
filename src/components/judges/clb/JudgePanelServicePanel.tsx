import { useQuery } from "@tanstack/react-query";
import { yearSpan } from "@/components/courts/clb/clbRestFormat";
import { Kpi, SourceLink } from "@/components/enforcement/parts";
import { CollapsibleSection } from "@/components/courts/clb/ClbParts";
import {
  CourtName,
  MiniTable,
  PanelError,
  PanelLoading,
  PanelShell,
  PersonName,
} from "@/components/courts/clb/ClbRestParts";
import { fmtInt, NOT_RECORDED } from "@/components/courts/clb/clbFormat";
import { JUDGE_ID } from "@/lib/external/judgeCourtListener.functions";
import { getClbJudgePanels, type JudgePanels } from "@/lib/external/clbAppellate.functions";
import { JudgeClYearCard } from "../JudgeTrendCards";

/**
 * Panels a judge is recorded on in CourtListener's opinion clusters, with the judges they sat with most (dataset
 * clb_appellate_panels, judge records). Reached through the judge crosswalk; renders nothing when the page is not linked to
 * exactly one CourtListener person or that person sat on fewer than five recorded panels.
 */
export function JudgePanelServicePanel({ judgeId }: { judgeId: string }) {
  const enabled = JUDGE_ID.test(judgeId);
  const q = useQuery({
    queryKey: ["clb-judge-panels", judgeId],
    queryFn: () => getClbJudgePanels({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
  if (!enabled) return null;
  if (q.isLoading) return <PanelLoading label="Loading recorded panels" height="h-24" />;
  if (q.isError)
    return (
      <PanelError text="Recorded panels could not be loaded." onRetry={() => void q.refetch()} />
    );
  if (!q.data) return null;
  return <Body p={q.data} />;
}

function Body({ p }: { p: JudgePanels }) {
  const rows = p.byYear.map((y) => ({ label: String(y.yr), bar: y.panels }));
  return (
    <PanelShell
      title="Recorded panels"
      subtitle={
        <>
          Opinion clusters that list this judge on the panel in CourtListener ·{" "}
          {yearSpan(p.firstFiled, p.lastFiled) ?? "years not recorded"}
        </>
      }
      record={{ dataset: "clb_appellate_panels", id: `judge:${p.personId}` }}
      aside={
        <SourceLink href={`https://www.courtlistener.com/person/${p.personId}/`}>
          CourtListener person page
        </SourceLink>
      }
    >
      <div className="grid grid-cols-2 gap-2 px-3 pb-2 md:grid-cols-4">
        <Kpi label="Recorded panels" value={fmtInt(p.panels)} note="opinion clusters" />
        <Kpi
          label="Courts"
          value={fmtInt(p.courts.length)}
          note={p.courts[0] ? `mostly ${p.courts[0].name}` : undefined}
        />
        <Kpi
          label="Co-panelists"
          value={fmtInt(p.coPanelistsCount)}
          note="distinct judges sat with"
        />
        <Kpi
          label="Opinions recorded as joined"
          value={fmtInt(p.joinedByOpinions)}
          note="the joined-by table is sparse"
        />
      </div>
      <CollapsibleSection
        title="Sat most often with"
        summary={p.coPanelists
          .slice(0, 3)
          .map((c) => c.name)
          .join(" · ")}
        defaultOpen
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <MiniTable
            caption="Co-panelists"
            rows={p.coPanelists}
            rowKey={(c) => String(c.personId)}
            limit={8}
            columns={[
              {
                key: "n",
                label: "Judge",
                render: (c) => (
                  <PersonName name={c.name} personId={c.personId} statsRecord={c.statsRecord} />
                ),
              },
              {
                key: "p",
                label: "Panels together",
                numeric: true,
                render: (c) => fmtInt(c.panels),
              },
            ]}
            note="Counts are clusters listing both judges; people are CourtListener person ids, never matched by name."
          />
          <MiniTable
            caption="Courts"
            rows={p.courts}
            rowKey={(c) => c.courtId}
            columns={[
              {
                key: "c",
                label: "Court",
                render: (c) => <CourtName name={c.name} courtId={c.courtId} link={c.link} />,
              },
              { key: "p", label: "Panels", numeric: true, render: (c) => fmtInt(c.panels) },
            ]}
          />
        </div>
      </CollapsibleSection>
      {rows.length > 1 ? (
        <CollapsibleSection title="By year" summary={`${rows.length} years`} defaultOpen>
          <div className="max-w-md">
            <JudgeClYearCard
              kind="panels"
              personId={p.personId}
              rows={p.byYear.map((y) => ({ yr: y.yr, n: y.panels }))}
              total={p.panels}
            />
          </div>
        </CollapsibleSection>
      ) : null}
      <p className="px-3 pb-3 text-[11px] leading-4 text-muted-foreground">
        Most opinion clusters list no panel, so these counts cover only the clusters where
        CourtListener recorded one; they are not a count of cases heard.
        {p.firstFiled ? "" : ` Filing years: ${NOT_RECORDED}.`}
      </p>
    </PanelShell>
  );
}
