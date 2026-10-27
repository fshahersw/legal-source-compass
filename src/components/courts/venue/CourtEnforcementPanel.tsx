/**
 * Court page: federal enforcement tied to this district by year. SEC enforcement releases whose recorded court is
 * this district, and Justice Department press releases that name this court. A press release naming a court is not
 * a filed case; the current year is partial. DOJ years whose partition holds far fewer releases than a full year
 * (2009-2012) are not counted or drawn, so thin and full years are never compared. Renders nothing for a court that
 * is not a federal district or when neither source records anything for it.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendColumns, periodTable } from "@/components/charts/recharts";
import { AiSummary, AskAiButton, KpiCard, KpiGrid, buildSectionContext } from "@/components/kit";
import {
  dojCoverage,
  enforcementYears,
  lastCompleteYears,
} from "@/lib/courts/districtEnforcement";
import { SOURCES, districtEnforcementQuery, fmtInt, isFederalDistrict } from "./venueQueries";

/** SEC releases with a recorded court are counted from 1996 (1995 holds only part of a year). */
const SEC_FIRST_YEAR = 1996;
/** Used only when the DOJ partition sizes cannot be read. */
const DOJ_FALLBACK_FIRST_FULL = 2013;

export function CourtEnforcementPanel({
  courtId,
  courtName,
  system,
}: {
  courtId: string;
  courtName: string;
  /** The court's recorded system ("Federal", "State"); only federal district courts are read. */
  system: string;
}) {
  const enabled = isFederalDistrict(courtId, system);
  const q = useQuery({ ...districtEnforcementQuery(courtId), enabled });
  if (!enabled) return null;
  if (q.isPending)
    return (
      <div
        className="mb-6 h-48 animate-pulse rounded-lg border border-border bg-muted/40"
        aria-busy="true"
        aria-label="Loading federal enforcement in this district"
      />
    );
  if (q.isError)
    return (
      <p
        role="alert"
        className="mb-6 rounded-lg border border-border px-4 py-3 text-meta text-muted-foreground"
      >
        Federal enforcement for this district could not be loaded.{" "}
        <button type="button" className="text-primary underline" onClick={() => void q.refetch()}>
          Retry
        </button>
      </p>
    );
  const d = q.data;
  const cov = dojCoverage(new Map(d.dojTotals), d.asOfYear);
  const firstFull = cov.firstFull !== null ? Number(cov.firstFull) : DOJ_FALLBACK_FIRST_FULL;
  // DOJ counts only from full-coverage years; thin years read Not recorded and are never drawn.
  const dojFull = new Map(d.doj.filter(([y]) => Number(y) >= firstFull));
  const dojTotal = [...dojFull.values()].reduce((a, n) => a + n, 0);
  if (!d.secTotal && !dojTotal) return null;
  const all = enforcementYears(d.sec, dojFull, d.asOfYear, {
    first: SEC_FIRST_YEAR,
    last: d.asOfYear,
  });
  const rows = all.filter((r) => Number(r.year) >= firstFull);
  const last5Sec = lastCompleteYears(all, "sec", 5);
  const last5Doj = lastCompleteYears(all, "doj", 5);
  const thinNote = cov.thin.length
    ? `The DOJ collection holds far fewer releases for ${cov.thin[0]!.year}–${cov.thin.at(-1)!.year} (${cov.thin.map((t) => fmtInt(t.total)).join(", ")} a year) than for later years (typically ${fmtInt(cov.typical ?? 0)}), so DOJ counts and the chart start in ${firstFull}.`
    : null;
  const withCivil = d.sec.filter((s) => s.civilAction).length;
  const span = rows.length ? `${rows[0]!.year}–${rows.at(-1)!.year}` : undefined;
  const partial = rows.at(-1)?.partial
    ? `${rows.at(-1)!.year} is partial (read ${d.readAt.slice(0, 10)}).`
    : undefined;
  const context = buildSectionContext({
    id: `court-enforcement-${courtId}`,
    title: `Federal enforcement in ${courtName}`,
    scope: courtName,
    period: span,
    source: `${SOURCES.sec.label}; ${SOURCES.doj.label}`,
    figures: [
      {
        label: "SEC litigation releases recorded for this court",
        value: d.secTotal,
        period: "all years recorded",
      },
      { label: "SEC litigation releases with a civil action number", value: withCivil },
      ...(last5Sec
        ? [
            {
              label: "SEC litigation releases",
              value: last5Sec.total,
              period: `${last5Sec.from}-${last5Sec.to}`,
            },
          ]
        : []),
      ...(last5Doj
        ? [
            {
              label: "DOJ press releases naming this court",
              value: last5Doj.total,
              period: `${last5Doj.from}-${last5Doj.to}`,
            },
          ]
        : []),
      ...rows.slice(-6).flatMap((r) => [
        {
          label: "SEC litigation releases",
          value: r.sec,
          period: r.year,
          note: r.partial ? "partial year" : undefined,
        },
        {
          label: "DOJ press releases naming this court",
          value: r.doj,
          period: r.year,
          note: r.partial ? "partial year" : undefined,
        },
      ]),
    ],
    maxFigures: 18,
  });
  return (
    <div id="court-enforcement" className="mb-6 space-y-4">
      <KpiGrid columns={4} label={`Federal enforcement in ${courtName}`}>
        <KpiCard
          as="li"
          label="SEC litigation releases for this court"
          value={fmtInt(d.secTotal)}
          meta="All years recorded"
          source={{ source: { label: SOURCES.sec.label, href: SOURCES.sec.url } }}
        />
        <KpiCard
          as="li"
          label="SEC litigation releases, last 5 full years"
          value={last5Sec?.total != null ? fmtInt(last5Sec.total) : null}
          meta={last5Sec ? `${last5Sec.from}–${last5Sec.to}` : undefined}
        />
        <KpiCard
          as="li"
          label="DOJ releases naming this court"
          value={last5Doj?.total != null ? fmtInt(last5Doj.total) : null}
          meta={last5Doj ? `${last5Doj.from}–${last5Doj.to}` : undefined}
          source={{ source: { label: SOURCES.doj.label, href: SOURCES.doj.url } }}
        />
        <KpiCard
          as="li"
          label="With a civil action number"
          value={fmtInt(withCivil)}
          meta={`of ${fmtInt(d.secTotal)} · links to a filed case`}
        />
      </KpiGrid>
      <ChartCard
        title={`SEC and DOJ enforcement releases tied to ${courtName}, by year`}
        subtitle={`Releases per calendar year · ${span ?? ""}`}
        status={
          rows.length >= 2
            ? { kind: "ready" }
            : { kind: "empty", reason: "Not recorded for this period." }
        }
        sources={[SOURCES.sec, SOURCES.doj]}
        period={span}
        partial={partial}
        about={
          <ul className="list-disc space-y-1 pl-4">
            <li>
              SEC: litigation releases whose court was read from the release by an exact court-name
              map. Administrative proceedings carry no court and are not counted.
            </li>
            <li>
              The share of SEC releases with a recorded court changes from year to year, so part of
              a change between years can come from that rather than from enforcement.
            </li>
            <li>
              DOJ: press releases that name this court. Naming a court is not the same as a filed
              case, and a release can name several courts.
            </li>
            {thinNote ? <li>{thinNote}</li> : null}
            <li>The current year is partial and drawn hatched.</li>
          </ul>
        }
        table={periodTable(
          rows,
          "year",
          [
            { key: "sec", label: "SEC litigation releases" },
            { key: "doj", label: "DOJ releases naming the court" },
          ],
          fmtInt,
          {
            caption: `Enforcement releases tied to ${courtName}`,
            xLabel: "Year",
            partialKey: "partial",
          },
        )}
        actions={
          <>
            <Link
              to="/enforcement"
              className="rounded-md border border-border px-2 py-1 text-meta hover:bg-muted"
            >
              Enforcement
            </Link>
            <AskAiButton
              sectionId={`court-enforcement-${courtId}`}
              title={context.title}
              context={context}
              size="icon"
            />
          </>
        }
        minHeight={240}
      >
        <TrendColumns
          rows={rows}
          xKey="year"
          series={[
            { key: "sec", label: "SEC litigation releases" },
            { key: "doj", label: "DOJ releases naming the court" },
          ]}
          format={fmtInt}
          partialKey="partial"
          legend
          xTick={(v) => `’${v.slice(2)}`}
          ariaLabel={`SEC and DOJ enforcement releases tied to ${courtName}, by year`}
        />
      </ChartCard>
      <AiSummary context={context} />
    </div>
  );
}
