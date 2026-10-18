import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { int, NOT_RECORDED, pct, shareOf, signedPct } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import { numTick } from "@/components/enforcement/listDisplay";
import {
  axisTick,
  Kpi,
  LoadingBlock,
  Panel,
  Segmented,
  SourceLink,
  StateNote,
  tooltipStyle,
} from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getSaferProductsReports,
  type SaferProductsReports as ReportsData,
} from "@/lib/external/saferProducts.functions";
import { cn } from "@/lib/utils";
import { Sparkline } from "../Sparkline";
import { ReportsByCompany } from "./ReportsByCompany";
import { saferProductsReportsQuery } from "./queries";
import { UnverifiedBadge, UnverifiedNotice } from "./parts";
import {
  partialYearNote,
  pointsFromLargest,
  pointsText,
  severitySegments,
  spTakeaways,
  UNVERIFIED,
  yearBars,
  yearLabel,
  type YearBar,
} from "./saferProductsView";

const color = (i: number) => FDA_COLORS[i] ?? "var(--primary)";
const SERIES_COLOR = color(0);
const SEVERITY_COLORS: Record<string, string> = {
  death: "var(--destructive)",
  injury: color(2),
  incidentNoInjury: color(1),
  noIncident: color(3),
  unspecified: color(5),
};

const MEASURES: Measure[] = [
  {
    term: "Report",
    means:
      "One submission published on SaferProducts.gov after CPSC's minimum-information checks. Submitters include consumers, health-care professionals, public-safety and government agencies; consumers file most.",
    caveat:
      "CPSC does not verify every report. A report is not a finding of defect, causation or incidence, and the manufacturer may comment.",
  },
  {
    term: "Publication year",
    means:
      "The year CPSC published the report, the default axis. “Submitted” uses the report date the submitter filed.",
    caveat:
      "The newest months are understated because reports take weeks to be published (median 25 days).",
  },
  {
    term: "Partial year",
    means:
      "A year the export does not fully cover, drawn hatched and marked with an asterisk. A partial year is compared with the same dates of other years, never with a full year.",
  },
  {
    term: "Severity",
    means:
      "The primary victim's severity as filed. Injury groups six levels of care, from no first aid to hospital admission.",
    caveat: "Counts reports, not persons.",
  },
  {
    term: "Not in the export",
    means:
      "Incident date (the report date is when it was filed), victim identity, sex, race, city, ZIP, serial numbers and free text. None of these appears here.",
  },
  {
    term: "Why counts move",
    means:
      "Publicity, recalls, litigation and one filer submitting many reports change the counts; a single manufacturer string can account for a large part of a year.",
    caveat: "Read trends with that context, not as changes in real-world incidence.",
  },
  {
    term: "Category change",
    means:
      "Reports published in the three latest complete years against the three before, ranked only when both windows hold at least 30 reports.",
    caveat: "Categories with fewer are shown as not ranked.",
  },
];

export function SaferProductsReports() {
  return (
    <div className="space-y-3">
      <UnverifiedNotice />
      <ReportsOverview />
      <ReportsByCompany />
    </div>
  );
}

function ReportsOverview() {
  const q = useQuery(saferProductsReportsQuery);
  if (q.isLoading) return <LoadingBlock label="Loading SaferProducts.gov report aggregates" />;
  if (q.isError)
    return (
      <StateNote
        tone="error"
        action={
          <button type="button" onClick={() => void q.refetch()} className="underline">
            Retry
          </button>
        }
      >
        The SaferProducts.gov report aggregates could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return (
      <StateNote>The SaferProducts.gov report aggregates have not been published yet.</StateNote>
    );
  return <Body data={q.data} />;
}

type Basis = "published" | "submitted";

function Body({ data }: { data: ReportsData }) {
  const [basis, setBasis] = useState<Basis>("published");
  const lc = data.latestComplete;
  const lp = data.latestPartial;
  const ytd = lp?.ytd ?? null;
  const ex = ytd?.excludingLargest ?? null;
  const points = pointsFromLargest(ytd);
  const bars = yearBars(data.yearlyPublished, data.yearlyReported, basis);
  const takeaways = spTakeaways(data);
  const partialNote = partialYearNote(data.yearlyPublished, data.publicationWindow);
  const windowText = data.publicationWindow
    ? `Published ${data.publicationWindow.first} to ${data.publicationWindow.last}`
    : "Publication window not recorded";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Published reports (unverified)"
          value={int(data.total)}
          note={`${windowText}; counts are reports, not incidents`}
        />
        <Kpi
          label={
            lc ? `${lc.year} reports (unverified), latest complete year` : "Latest complete year"
          }
          value={lc ? int(lc.reports) : NOT_RECORDED}
          note={
            lc
              ? `${signedPct(lc.yoyPct)} on ${lc.year - 1}; ${signedPct(lc.changeVs2019Pct)} on 2019`
              : undefined
          }
        />
        <Kpi
          label={
            lp && ytd
              ? `${lp.year} to ${ytd.through} against ${lp.year - 1} (unverified)`
              : "Year to date"
          }
          value={ytd ? signedPct(ytd.changePct) : NOT_RECORDED}
          note={
            ytd && lp
              ? `${int(ytd.reports)} reports against ${int(ytd.priorYearSameWindow)} in the same window of ${lp.year - 1}`
              : undefined
          }
        />
        <Kpi
          label={
            ex ? `Same, without ${ex.company}` : "Same, without the largest manufacturer string"
          }
          value={ex ? signedPct(ex.changePct) : NOT_RECORDED}
          note={
            ex && ytd
              ? `${int(ex.reports)} against ${int(ex.priorYearSameWindow)}; removes ${int(ex.removedReports)} reports from the largest manufacturer string${points != null ? ` (about ${pointsText(points)})` : ""}`
              : undefined
          }
        />
        <Kpi
          label="Death reports (unverified)"
          value={data.severity ? int(data.severity.death) : NOT_RECORDED}
          note={
            data.severity
              ? `Reports whose primary victim has this severity, not persons; ${int(data.severity.injury)} injury reports`
              : undefined
          }
        />
        <Kpi
          label="Median days to publication"
          value={data.lag?.median != null ? int(data.lag.median) : NOT_RECORDED}
          note={
            data.lag?.p90 != null
              ? `90th percentile ${int(data.lag.p90)} days; the newest months are understated`
              : "The newest months are understated"
          }
        />
      </div>

      <KeyTakeaways
        items={takeaways}
        scope={`${UNVERIFIED} · ${data.publicationWindow ? `${data.publicationWindow.first} to ${data.publicationWindow.last}` : "SaferProducts.gov"}`}
      />
      <HowToRead
        measures={MEASURES}
        notes={
          <>
            CPSC&apos;s terms: information publicly posted on SaferProducts.gov is public
            information and may be distributed or copied, and CPSC does not guarantee its accuracy,
            completeness or adequacy. {data.caveats[2] ?? ""}{" "}
            <SourceLink href="https://www.saferproducts.gov/About">
              About SaferProducts.gov
            </SourceLink>
          </>
        }
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          id="sp-yearly"
          title={
            basis === "published" ? "Reports per publication year" : "Reports per submission year"
          }
          subtitle={
            basis === "published"
              ? "Reports by the year CPSC published them"
              : "Reports by the year the submitter filed them"
          }
          actions={
            <>
              <UnverifiedBadge />
              <Segmented
                label="Year basis"
                value={basis}
                options={[
                  { id: "published", label: "Published" },
                  { id: "submitted", label: "Submitted" },
                ]}
                onChange={setBasis}
              />
            </>
          }
          footnote={
            <>
              Hatched bars with an asterisk are partial years. {partialNote ?? ""} {UNVERIFIED}:
              counts are reports, not incidence, and move with publicity, recalls and litigation.
            </>
          }
        >
          <YearChart bars={bars} basis={basis} />
        </Panel>

        <SeverityPanel data={data} />
      </div>

      <CategoriesPanel data={data} />
    </div>
  );
}

function YearChart({ bars, basis }: { bars: YearBar[]; basis: Basis }) {
  const hatchId = "sp-hatch";
  return (
    <div
      className="h-72 p-2"
      role="img"
      aria-label={`Bars of unverified SaferProducts.gov reports per ${basis === "published" ? "publication" : "submission"} year, partial years hatched`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <pattern
              id={hatchId}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="transparent" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={SERIES_COLOR} strokeWidth="2.5" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tick={axisTick} tickFormatter={numTick} width={44} />
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as YearBar | undefined) : undefined;
              if (!row) return null;
              return (
                <div
                  className="rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground shadow-sm"
                  style={tooltipStyle}
                >
                  <p className="font-medium">
                    {row.year}
                    {row.partial ? " (partial year)" : ""}
                  </p>
                  <p className="font-mono">{int(row.reports)} unverified reports</p>
                  <p className="text-muted-foreground">{row.yoy}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="reports" name={UNVERIFIED} fill={SERIES_COLOR} isAnimationActive={false}>
            {bars.map((b) => (
              <Cell
                key={b.year}
                fill={b.partial ? `url(#${hatchId})` : SERIES_COLOR}
                stroke={SERIES_COLOR}
                strokeWidth={b.partial ? 1 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SeverityPanel({ data }: { data: ReportsData }) {
  const sev = data.severity;
  const segs = sev ? severitySegments(sev) : [];
  const total = segs.reduce((a, s) => a + s.value, 0);
  const ageMax = Math.max(1, ...data.ageBands.map((b) => b.reports), data.ageNotRecorded ?? 0);
  return (
    <Panel
      id="sp-severity"
      title="Severity and age of the primary victim"
      subtitle="Reports by the victim severity and age the submitter gave"
      actions={<UnverifiedBadge />}
      footnote="Counts are reports, not persons. Age is in whole years of the primary victim and is often blank. Severity and age are as filed, not verified."
    >
      <div className="space-y-3 p-3 text-xs">
        {sev && total > 0 ? (
          <div>
            <p className="mb-1 font-medium">Severity</p>
            <div
              role="img"
              aria-label={`Severity of the primary victim: ${segs.map((s) => `${s.label} ${int(s.value)}`).join("; ")}`}
              className="flex h-3 overflow-hidden rounded-full bg-muted"
            >
              {segs
                .filter((s) => s.value > 0)
                .map((s) => (
                  <span
                    key={s.key}
                    className="h-full"
                    style={{
                      width: `${(100 * s.value) / total}%`,
                      minWidth: 2,
                      background: SEVERITY_COLORS[s.key],
                    }}
                  />
                ))}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {segs.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-sm"
                    style={{ background: SEVERITY_COLORS[s.key] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.label}>
                    {s.label}
                  </span>
                  <span className="font-mono tabular-nums">{int(s.value)}</span>
                  <span className="w-11 text-right font-mono text-muted-foreground tabular-nums">
                    {pct(shareOf(s.value, total), 1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">Severity is {NOT_RECORDED}.</p>
        )}

        <div>
          <p className="mb-1 font-medium">Victim age</p>
          {data.ageBands.length ? (
            <ul className="space-y-1" aria-label="Reports by victim age band">
              {data.ageBands.map((b) => (
                <li key={b.key} className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-2">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
                    <span
                      className="block h-2.5 rounded-sm"
                      style={{
                        width: `${Math.max(1, (b.reports / ageMax) * 100)}%`,
                        background: FDA_COLORS[1],
                      }}
                    />
                  </span>
                  <span className="text-right font-mono tabular-nums">{int(b.reports)}</span>
                </li>
              ))}
              {data.ageNotRecorded != null ? (
                <li className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-2">
                  <span className="text-muted-foreground">Not recorded</span>
                  <span className="h-2.5 rounded-sm bg-muted" aria-hidden>
                    <span
                      className="block h-2.5 rounded-sm bg-muted-foreground/40"
                      style={{ width: `${Math.max(1, (data.ageNotRecorded / ageMax) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right font-mono tabular-nums">
                    {int(data.ageNotRecorded)}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-muted-foreground">Age bands are {NOT_RECORDED}.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function CategoriesPanel({ data }: { data: ReportsData }) {
  const cats = data.categories;
  const first = data.yearlyPublished[0]?.year;
  const last = data.yearlyPublished.at(-1)?.year;
  const growthWindow = cats.find((c) => c.growth)?.growth;
  const span = first && last ? ` ${first} to ${last}` : "";
  const compares = growthWindow
    ? `${growthWindow.recentWindow} with ${growthWindow.priorWindow}`
    : "the latest three complete years with the three before";
  return (
    <Panel
      id="sp-categories"
      title="Product categories"
      subtitle={`The ${int(cats.length)} product categories as classified in the export, largest first`}
      actions={<UnverifiedBadge />}
      footnote={`Categories, sub categories and product types are the export's own classification. The trend line is unverified reports per publication year${span}; the dashed end is the partial year. Change compares ${compares}, ranked only when both windows hold at least 30 reports.`}
    >
      {cats.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Unverified SaferProducts.gov reports by product category
            </caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Category
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Unverified reports
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Share
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Injury reports
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Death reports
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Trend
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Change
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {cats.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-56 truncate px-2 py-1" title={c.name}>
                    <Link
                      to="/records/$dataset/$id"
                      params={{ dataset: "saferproducts_products", id: c.id }}
                      className="text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{int(c.reports)}</td>
                  <td className="px-2 py-1 text-right font-mono">{pct(c.sharePct, 1)}</td>
                  <td className="px-2 py-1 text-right font-mono">{int(c.injuries)}</td>
                  <td className="px-2 py-1 text-right font-mono">{int(c.deaths)}</td>
                  <td className="px-2 py-1">
                    <Sparkline
                      points={c.yearly.map((y) => ({ value: y.reports, partial: y.partial }))}
                      label={`${c.name}: unverified reports per publication year${c.yearly.length ? `, ${c.yearly[0]!.year} to ${yearLabel(c.yearly.at(-1)!)}` : ""}`}
                    />
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right font-mono",
                      !c.growth?.eligible && "text-muted-foreground",
                    )}
                    title={
                      c.growth?.eligible
                        ? `${int(c.growth.recent)} reports in ${c.growth.recentWindow} against ${int(c.growth.prior)} in ${c.growth.priorWindow}; rank ${c.growth.rank ?? "?"} of ${c.growth.rankOf ?? "?"}`
                        : "Not ranked: fewer than 30 reports in one of the two windows"
                    }
                  >
                    {c.growth?.eligible ? signedPct(c.growth.changePct) : "Not ranked"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StateNote>Product categories are {NOT_RECORDED}.</StateNote>
      )}
    </Panel>
  );
}
