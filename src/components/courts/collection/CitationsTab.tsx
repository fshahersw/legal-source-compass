import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { int, listAnd } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { Kpi, Panel, Segmented } from "@/components/enforcement/parts";
import { longDate } from "@/components/courts/caseload/caseloadFormat";
import type { FlowsMap } from "@/lib/external/clbCollection.functions";
import { flowsMapQuery, notesQuery } from "./collectionQueries";
import { circuitName, circuitShort, NOT_RECORDED, pct, sharePct } from "./collectionFormat";
import { viewOf } from "./collectionSearch";
import { citationTakeaways } from "./collectionTakeaways";
import { HeatTable } from "./CitationHeatmap";
import { CitingCourtsView, EdgesView, FlowYearsView } from "./CitationTables";
import {
  Callout,
  KpiGrid,
  KpiSkeleton,
  NoteReference,
  QueryPanel,
  type TabProps,
} from "./CollectionParts";
import { CourtShareList } from "./CollectionVisuals";

/** The level CourtListener codes the courts of appeals under; the dataset says it includes the Supreme Court. */
const FEDERAL_APPELLATE = "Federal appellate";

const VIEWS = [
  { id: "map", label: "Court map" },
  { id: "courts", label: "Citing courts" },
  { id: "edges", label: "Court pairs" },
  { id: "years", label: "By year" },
] as const;

export function CitationsTab({ search, onSearch }: TabProps) {
  const map = useQuery(flowsMapQuery);
  const notes = useQuery(notesQuery);
  const note = notes.data?.flows ?? null;
  const view = viewOf("citations", search.view) ?? "map";
  const takeaways = useMemo(() => citationTakeaways(map.data ?? null), [map.data]);
  return (
    <div className="space-y-3">
      <CitationKpis query={map} />
      <Callout id="citations-scope">
        <strong className="font-semibold text-foreground">
          The citation map is CourtListener&apos;s extraction from opinion text, not a census of
          citations.
        </strong>{" "}
        {map.data ? <ExcludedSentence map={map.data} /> : null}
        {note?.caveats.find((c) => /coverage/i.test(c)) ?? ""} Courts are linked only where the
        record carries a court link.
      </Callout>
      <KeyTakeaways
        items={takeaways}
        scope={longDate(note?.snapshot) ? `Citation map · ${longDate(note?.snapshot)}` : undefined}
        note="Computed from the citation map. Shares name the links they are a share of."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Citation view"
          value={view}
          options={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
          onChange={(id) =>
            onSearch({
              view: id,
              q: undefined,
              sort: undefined,
              sel: undefined,
              level: undefined,
              to: undefined,
              flow: undefined,
            })
          }
        />
        <span className="text-[11px] text-muted-foreground">
          {view === "map"
            ? "Links among the courts of appeals and the Supreme Court, and among court levels"
            : view === "courts"
              ? "Whom each court cites, and how old its cited opinions are"
              : view === "edges"
                ? "The largest court-to-court pairs"
                : "Links by the year of the citing opinion"}
        </span>
      </div>
      {view === "map" ? (
        <MapView
          query={map}
          measure={search.measure}
          onMeasure={(measure) => onSearch({ measure })}
        />
      ) : view === "courts" ? (
        <CitingCourtsView search={search} onSearch={onSearch} map={map} />
      ) : view === "edges" ? (
        <EdgesView search={search} onSearch={onSearch} map={map} />
      ) : (
        <FlowYearsView span={search.span} onSpan={(span) => onSearch({ span })} />
      )}
      <NoteReference note={note} title="How to read the citation figures" />
    </div>
  );
}

function ExcludedSentence({ map }: { map: FlowsMap }) {
  const o = map.overview;
  if (o.excluded == null || o.mapLinks == null) return null;
  const parts = [
    o.notInOpinionTable != null
      ? `an opinion is not in the opinion table (${int(o.notInOpinionTable)})`
      : null,
    o.sameDecisionLinks != null
      ? `both opinions are of the same decision (${int(o.sameDecisionLinks)})`
      : null,
    o.unresolved != null ? `a court could not be resolved (${int(o.unresolved)})` : null,
  ].filter((x): x is string => x != null);
  return (
    <>
      {int(o.resolved)} links resolve to a court on both sides and are the base of every share here;{" "}
      {int(o.excluded)} of the map&apos;s {int(o.mapLinks)} rows (
      {pct(sharePct(o.excluded, o.mapLinks), 2)}) are left out because {parts.join(", or ")}. A
      repeat citation inside one opinion counts once.{" "}
    </>
  );
}

function CitationKpis({ query }: { query: UseQueryResult<FlowsMap | null> }) {
  if (query.isLoading) return <KpiSkeleton n={4} />;
  const m = query.data;
  if (query.isError || !m)
    return (
      <QueryPanel
        query={query}
        label="Loading citation totals"
        errorText="The citation totals could not be loaded."
        emptyText="The citation totals are not recorded."
      >
        {() => null}
      </QueryPanel>
    );
  const o = m.overview;
  const excluded = o.excluded;
  return (
    <KpiGrid id="citations-kpis" label="Citation totals" cols={4}>
      <Kpi
        label="Citation links resolved to a court"
        value={int(o.resolved)}
        note={o.mapLinks != null ? `of ${int(o.mapLinks)} rows in the citation map` : undefined}
      />
      <Kpi
        label="Within the same court"
        value={o.sameCourt == null ? NOT_RECORDED : pct(sharePct(o.sameCourt, o.resolved))}
        note={
          o.sameCourt == null
            ? undefined
            : `${int(o.sameCourt)} of ${int(o.resolved)} resolved links`
        }
      />
      <Kpi
        label="Left out of the map"
        value={excluded == null ? NOT_RECORDED : int(excluded)}
        note={
          excluded == null
            ? undefined
            : `${int(o.notInOpinionTable ?? 0)} opinion not in the table; ${int(o.sameDecisionLinks ?? 0)} same decision; ${int(o.unresolved ?? 0)} court unresolved`
        }
      />
      <Kpi
        label="Appellate dockets with an appeal-from court"
        value={o.appealDockets == null ? NOT_RECORDED : int(o.appealDockets)}
        note="A minority of appellate dockets record one"
      />
    </KpiGrid>
  );
}

function MapView({
  query,
  measure,
  onMeasure,
}: {
  query: UseQueryResult<FlowsMap | null>;
  measure: "count" | undefined;
  onMeasure: (m: "count" | undefined) => void;
}) {
  const m: "share" | "count" = measure === "count" ? "count" : "share";
  const toggle = (
    <Segmented
      label="Cell values"
      value={m}
      options={[
        { id: "share", label: "Row share %" },
        { id: "count", label: "Links" },
      ]}
      onChange={(id) => onMeasure(id === "count" ? "count" : undefined)}
    />
  );
  return (
    <QueryPanel
      query={query}
      label="Loading the citation map"
      errorText="The citation map could not be loaded."
      emptyText="The citation map is not recorded."
      skeleton={
        <div
          className="h-96 animate-pulse rounded-md border border-border bg-muted/50"
          aria-busy="true"
        />
      }
    >
      {(map) => (
        <div className="space-y-3">
          <Panel
            id="citations-circuits"
            title="Courts of appeals citing each other and the Supreme Court"
            subtitle="Each row is the citing court; each column is the court cited"
            actions={toggle}
            footnote={
              <>
                Each row&apos;s shares add to 100% of the links that court makes to the thirteen
                courts of appeals and the Supreme Court, not of all its citations: the last two
                columns say how much of the court&apos;s resolved links this table holds. Tint and
                bar scale with the share (the diagonal, a court citing itself, is outlined and not
                used to set the scale). Courts are not linked here because the matrix record carries
                no court links.
              </>
            }
          >
            {map.circuits ? (
              <HeatTable
                matrix={{
                  ...map.circuits,
                  rows: map.circuits.rows.map((r) => ({ ...r, label: circuitName(r.label) })),
                }}
                measure={m}
                caption="Citation links from each court of appeals to each court of appeals and the Supreme Court"
                corner="Citing court ↓  Cited court →"
                shortHeader={circuitShort}
                withCourtTotals
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                The circuit matrix is {NOT_RECORDED}.
              </p>
            )}
          </Panel>
          <Panel
            id="citations-levels"
            title="Court levels citing each other"
            subtitle="Each row is the level of the citing court; each column is the level cited"
            actions={toggle}
            footnote={map.levels ? <LevelsFootnote map={map} /> : undefined}
          >
            {map.levels ? (
              <HeatTable
                matrix={{
                  ...map.levels,
                  rows: map.levels.rows.map((r) => ({
                    ...r,
                    label: r.key === FEDERAL_APPELLATE ? `${r.label}*` : r.label,
                  })),
                }}
                measure={m}
                caption="Citation links from each court level to each court level (ten levels shown; the table is not complete)"
                corner="Citing level ↓  Cited level →"
                shortHeader={(k) => (k === FEDERAL_APPELLATE ? `${k}*` : k)}
                withCourtTotals
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                The level matrix is {NOT_RECORDED}.
              </p>
            )}
          </Panel>
          <Panel
            id="citations-scotus"
            title="Courts that cite the U.S. Supreme Court most"
            subtitle={
              map.scotus
                ? `${int(map.scotus.total)} citation links point at Supreme Court opinions; share is of those links`
                : "Citation links to Supreme Court opinions"
            }
          >
            {map.scotus ? (
              <CourtShareList
                id="citations-scotus-list"
                caption="Courts citing the Supreme Court most"
                countLabel="Citation links to Supreme Court opinions"
                shareLabel="Share of all links to Supreme Court opinions"
                limit={10}
                rows={map.scotus.citers.map((c) => ({
                  courtId: c.courtId,
                  name: c.name,
                  href: c.href,
                  count: c.count,
                  sharePct: c.sharePct ?? sharePct(c.count, map.scotus!.total),
                }))}
              />
            ) : (
              <p className="p-3 text-xs text-muted-foreground">
                The Supreme Court citers are {NOT_RECORDED}.
              </p>
            )}
          </Panel>
        </div>
      )}
    </QueryPanel>
  );
}

function LevelsFootnote({ map }: { map: FlowsMap }) {
  const m = map.levels!.meta;
  const total = m?.totalLinks ?? map.overview.resolved;
  const shown = m?.shownLinks ?? map.levels!.cells.flat().reduce<number>((a, c) => a + (c ?? 0), 0);
  const hasGap = map.levels!.cells.flat().some((c) => c == null);
  return (
    <div className="space-y-1">
      <p>
        <strong className="font-semibold text-foreground">This table is not complete.</strong>{" "}
        {hasGap
          ? ""
          : `It holds ${int(shown)} of the ${int(total)} resolved links (${pct(sharePct(shown, total))}). `}
        {m?.omittedLevels.length
          ? `${int(total - shown)} links involve ${int(m.omittedLevels.length)} other levels that are not shown (${listAnd(m.omittedLevels)}). `
          : ""}
        Each row&apos;s shares add to 100% of the links from that level to the levels shown; the
        last columns give all the links the level makes.
      </p>
      <p>
        * Federal appellate includes the U.S. Supreme Court as CourtListener codes it
        {m?.federalAppellateCitedScotusPct != null
          ? `: ${pct(m.federalAppellateCitedScotusPct)} of the links cited to that level point to the Supreme Court`
          : ""}
        . The table of the courts of appeals above separates the two.
      </p>
    </div>
  );
}
