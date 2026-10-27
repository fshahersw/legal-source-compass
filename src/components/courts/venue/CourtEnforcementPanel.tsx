/**
 * Court page: federal enforcement tied to this district by year. SEC enforcement releases whose recorded court is
 * this district, and Justice Department press releases that name this court. A press release naming a court is not
 * a filed case; the current year is partial. Renders nothing for a court that is not a federal district or when
 * neither source records anything for it.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, TrendColumns, periodTable } from "@/components/charts/recharts";
import { AiSummary, AskAiButton, KpiCard, KpiGrid, buildSectionContext } from "@/components/kit";
import { enforcementYears, lastCompleteYears } from "@/lib/courts/districtEnforcement";
import { DISTRICT_ID, SOURCES, districtEnforcementQuery, fmtInt } from "./venueQueries";

/** The chart starts where both sources cover full years (DOJ yearly releases from 2009; SEC from 1996). */
const FIRST_CHART_YEAR = 2009;
const SEC_YEARS = { first: 1995, last: 2100 };

export function CourtEnforcementPanel({
  courtId,
  courtName,
}: {
  courtId: string;
  courtName: string;
}) {
  const enabled = DISTRICT_ID.test(courtId);
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
  const dojTotal = d.doj.reduce((a, [, n]) => a + n, 0);
  if (!d.secTotal && !dojTotal) return null;
  const all = enforcementYears(d.sec, new Map(d.doj), d.asOfYear, {
    first: SEC_YEARS.first,
    last: d.asOfYear,
  });
  const rows = all.filter((r) => Number(r.year) >= FIRST_CHART_YEAR);
  const last5Sec = lastCompleteYears(all, "sec", 5);
  const last5Doj = lastCompleteYears(all, "doj", 5);
  const litigation = d.sec.filter((s) => s.type === "litigation_release").length;
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
        label: "SEC enforcement releases recorded for this court",
        value: d.secTotal,
        period: "1995 onward",
      },
      { label: "SEC litigation releases", value: litigation },
      { label: "SEC releases with a civil action number", value: withCivil },
      ...(last5Sec
        ? [
            {
              label: "SEC releases",
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
          label: "SEC releases",
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
          label="SEC releases for this court"
          value={fmtInt(d.secTotal)}
          meta="All years recorded (1995 onward)"
          source={{ source: { label: SOURCES.sec.label, href: SOURCES.sec.url } }}
        />
        <KpiCard
          as="li"
          label="SEC releases, last 5 full years"
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
          label="SEC releases with a civil action number"
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
              SEC: litigation releases and administrative proceedings whose court was read from the
              release by an exact court-name map.
            </li>
            <li>
              DOJ: press releases that name this court. Naming a court is not the same as a filed
              case, and a release can name several courts.
            </li>
            <li>
              The chart starts in {FIRST_CHART_YEAR}, the first year of the DOJ release collection.
              The current year is partial and drawn hatched.
            </li>
          </ul>
        }
        table={periodTable(
          rows,
          "year",
          [
            { key: "sec", label: "SEC releases" },
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
            { key: "sec", label: "SEC releases" },
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
