import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import {
  getJudgeCourtListener,
  type Crosswalk,
  type CrosswalkTier,
  type JudgeActivity,
} from "@/lib/external/judgeCourtListener.functions";
import { TrendGrid } from "@/components/trends/ProfileTrend";
import { JudgeClYearCard } from "./JudgeTrendCards";

const TIER_TEXT: Record<CrosswalkTier, string> = {
  exact_id: "Exact identifier: the FJC id on this record equals the CourtListener person's FJC id",
  parent_profile_link:
    "Exact identifier through the FJC-backed directory record this profile belongs to",
  exact_name_same_court:
    "Exact full name and a CourtListener judicial position at a court on this record; the only such person",
  exact_name_same_state:
    "Exact full name and a CourtListener judicial position in this state; the only such person there",
  compatible_name_same_court:
    "Possible match: same first and last name at a court on this record, middle name written differently",
  ambiguous: "Several CourtListener people fit this name and court, so none is linked",
  fjc_conflict: "The FJC ids on the two sides disagree, so no person is linked",
  date_conflict: "The service dates on the two sides do not overlap, so no person is linked",
  withheld_for_review: "The source bridge for this record is withheld for review",
  no_cl_person_for_fjc_id:
    "CourtListener has no person with this record's FJC id, and no exact name match was found",
  not_found:
    "CourtListener's people database has no judicial position for this name at the recorded courts or state",
};

/** Static column classes so the tile grid has no empty cells (Tailwind needs literal class names). */
const KPI_COLS: Record<number, string> = {
  0: "",
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "Not recorded" : n.toLocaleString("en-US");

/** CourtListener person crosswalk and activity for a judge page. Renders a single quiet line when no person is linked. */
export function JudgeCourtListenerPanel({ judgeId }: { judgeId: string }) {
  const q = useQuery({
    queryKey: ["judge-courtlistener", judgeId],
    queryFn: () => getJudgeCourtListener({ data: { id: judgeId } }),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isLoading)
    return (
      <div
        className="mb-5 h-24 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading activity"
      />
    );
  if (q.isError)
    return (
      <p role="alert" className="mb-5 text-xs text-muted-foreground">
        Source activity could not be loaded.
      </p>
    );
  const data = q.data;
  if (!data) return null;
  const { crosswalk: c, activity } = data;
  if (c.linked && c.clPersonId !== null) return <Linked c={c} a={activity} />;
  if (c.needsReview && c.clPersonId !== null) return <Review c={c} />;
  return (
    <p className="mb-5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">CourtListener: </span>
      not linked. {TIER_TEXT[c.tier]}.
    </p>
  );
}

function Linked({ c, a }: { c: Crosswalk; a: JudgeActivity | null }) {
  const d = a?.dockets ?? null;
  const o = a?.opinions ?? null;
  const kpis: [string, string, string | undefined][] = [];
  if (d) {
    kpis.push([
      "Assigned dockets",
      fmt(d.assigned),
      d.firstYear && d.lastYear ? `filed ${d.firstYear}–${d.lastYear}` : undefined,
    ]);
    kpis.push([
      "Terminated",
      d.terminatedPct === null ? "Not recorded" : `${d.terminatedPct}%`,
      "termination date recorded",
    ]);
    kpis.push([
      "Median days, civil",
      d.medianDaysCivil === null ? "Not recorded" : fmt(Math.round(d.medianDaysCivil)),
      d.medianDaysN ? `n = ${fmt(d.medianDaysN)} with both dates` : "shown when n ≥ 30",
    ]);
  }
  if (a?.referred) kpis.push(["Referred dockets", fmt(a.referred), "as magistrate judge"]);
  if (o) {
    kpis.push([
      "Opinions authored",
      fmt(o.authored),
      o.firstFiled && o.lastFiled
        ? `${o.firstFiled.slice(0, 4)}–${o.lastFiled.slice(0, 4)}`
        : undefined,
    ]);
    if (o.timesCitedTotal !== null)
      kpis.push([
        "Times cited",
        fmt(o.timesCitedTotal),
        o.clustersWithLeadOpinion ? `${fmt(o.clustersWithLeadOpinion)} lead opinions` : undefined,
      ]);
  }
  return (
    <section
      className="mb-5 rounded-xl border border-border bg-card shadow-xs"
      aria-label="Source activity"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h2 className="text-heading font-semibold text-foreground">
          CourtListener{" "}
          <span className="font-normal text-muted-foreground">
            · {c.clName ?? `person ${c.clPersonId}`}
          </span>
        </h2>
        <a
          href={`https://www.courtlistener.com/person/${c.clPersonId}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Person page <ExternalLink className="size-3" aria-hidden />
        </a>
      </header>
      {kpis.length ? (
        <dl
          className={`grid grid-cols-2 gap-px bg-border/60 text-sm ${KPI_COLS[Math.min(kpis.length, 6)]}`}
        >
          {kpis.map(([label, value, note]) => (
            <div key={label} className="bg-surface px-4 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono font-semibold tabular-nums">{value}</dd>
              {note ? <dd className="text-[11px] text-muted-foreground">{note}</dd> : null}
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          No assigned dockets or authored opinions for this person in the collection.
        </p>
      )}
      {c.clPersonId !== null && (d?.byYear.length || o?.byYear.length) ? (
        <div className="border-t border-border/70 p-3">
          <TrendGrid columns={2} className="xl:grid-cols-2">
            {d?.byYear.length ? (
              <JudgeClYearCard
                kind="dockets"
                personId={c.clPersonId}
                rows={d.byYear}
                total={d.assigned}
              />
            ) : null}
            {o?.byYear.length ? (
              <JudgeClYearCard
                kind="opinions"
                personId={c.clPersonId}
                rows={o.byYear}
                total={o.authored}
              />
            ) : null}
          </TrendGrid>
        </div>
      ) : null}
      {d?.courts.length || o?.courts.length ? (
        <div
          className={`grid gap-4 border-t border-border/70 px-4 py-2.5 text-xs ${d?.courts.length && o?.courts.length ? "md:grid-cols-2" : "md:max-w-xl"}`}
        >
          {d?.courts.length ? (
            <CourtList title="Courts of assigned dockets" rows={d.courts} />
          ) : null}
          {o?.courts.length ? (
            <CourtList title="Courts of authored opinions" rows={o.courts} />
          ) : null}
        </div>
      ) : null}
      <footer className="space-y-1 border-t border-border/70 px-4 py-2 text-[11px] leading-4 text-muted-foreground">
        <p>
          <span className="font-medium text-foreground/80">Match: </span>
          {TIER_TEXT[c.tier]}.
        </p>
        {o?.timesCitedTotal !== null && o ? (
          <p>
            Times cited is the citation_count of the clusters where this person wrote
 the lead, combined, unanimous, plurality or on-the-merits opinion; it is not a measure
 of quality or of good-law status.
          </p>
        ) : null}
        {o?.excludedOutsideLifespan ? (
          <p>
            {fmt(o.excludedOutsideLifespan)} opinions CourtListener credits to this person are dated
            outside their recorded lifespan and are left out.
          </p>
        ) : null}
        <p>
          Counts describe CourtListener's collection (snapshot Sept 30, 2026), not a complete
          caseload.{" "}
          {c.clDocketsRecord ? (
            <Link
              to="/records/$dataset/$id"
              params={{ dataset: "clb_judge_dockets", id: String(c.clPersonId) }}
              className="text-primary hover:underline"
            >
              Full record
            </Link>
          ) : null}
          {c.clRecord ? (
            <>
              {" · "}
              <Link
                to="/records/$dataset/$id"
                params={{ dataset: "cl_people", id: `cl:people:${c.clPersonId}` }}
                className="text-primary hover:underline"
              >
                Source people record
              </Link>
            </>
          ) : null}
        </p>
      </footer>
    </section>
  );
}

function Review({ c }: { c: Crosswalk }) {
  return (
    <section
      className="mb-5 rounded-lg border border-dashed border-border bg-surface px-4 py-2.5 text-xs"
      aria-label="Possible source match"
    >
      <p>
        <span className="font-medium">Possible source match, needs review: </span>
        {c.clName ?? `person ${c.clPersonId}`}
        {c.positions.length ? (
          <span className="text-muted-foreground">
            {" "}
            (
            {c.positions
              .slice(0, 2)
              .map((p) => `${p.court}${p.start ? `, from ${p.start.slice(0, 4)}` : ""}`)
              .join("; ")}
            )
          </span>
        ) : null}
        .{" "}
        <a
          href={`https://www.courtlistener.com/person/${c.clPersonId}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          Compare at the source <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {TIER_TEXT[c.tier]}. It is not treated as the same person, and no figures are shown.
      </p>
    </section>
  );
}

function CourtList({
  title,
  rows,
}: {
  title: string;
  rows: { courtId: string; name: string; n: number; link: string | null }[];
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {rows.slice(0, 4).map((r) => (
          <li key={r.courtId} className="flex items-baseline justify-between gap-3">
            {r.link ? (
              <Link
                to="/courts/$id"
                params={{ id: r.courtId }}
                className="truncate text-primary hover:underline"
                title={r.name}
              >
                {r.name}
              </Link>
            ) : (
              <span className="truncate" title={r.name}>
                {r.name}
              </span>
            )}
            <span className="shrink-0 font-mono tabular-nums">{fmt(r.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
