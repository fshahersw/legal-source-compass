import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Scale } from "lucide-react";
import { signedPct, usdCompact } from "@/components/analysis/analysisFormat";
import { SourceLink } from "@/components/enforcement/parts";
import { FDA_COLORS } from "@/components/fda-analytics/chartView";
import {
  getStateConsumerData,
  type ConsumerYear,
  type StateConsumerData,
} from "@/lib/external/stateConsumer.functions";
import { MiniLine, type MiniPoint } from "./MiniLine";
import { ShareBars } from "./ShareBars";
import {
  Note,
  PanelSection,
  PanelState,
  ResponsiveTable,
  RetryButton,
  Stat,
  StatGrid,
  TakeawayList,
} from "./parts";
import {
  FTC_CREDIT,
  NOT_RECORDED,
  callsLatest,
  callsRows,
  callsSubjects,
  callsWindow,
  consumerTakeaways,
  dncChange,
  definitionYears,
  editionName,
  latest,
  nationalFor,
  nationalMedianPoints,
  noticesBetween,
  populationBasis,
  rankCellText,
  rankChangeText,
  rankText,
  refundBars,
  sentence,
  shown,
  trendPoints,
} from "./consumerView";

const count = (n: number) => n.toLocaleString("en-US");
const dollars = (n: number) => `$${count(Math.round(n))}`;
const years = (list: readonly { year: number }[]) =>
  list.length ? `${list[0]!.year}–${list[list.length - 1]!.year}` : "";

/** FTC Consumer Sentinel, Do Not Call and refund figures for a state, each shown as the FTC printed it. */
export function StateConsumerProtectionPanel({ usps }: { usps: string }) {
  const fn = useServerFn(getStateConsumerData);
  const q = useQuery({
    queryKey: ["state-consumer-protection", usps],
    queryFn: () => fn({ data: { usps } }),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <section
      className="resource-panel @container"
      aria-label="Consumer protection reports and complaints from the Federal Trade Commission"
    >
      <div className="research-band">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="size-4" aria-hidden />
          Consumer protection
        </h2>
        <span className="text-[11px] text-[var(--navy-muted)]">FTC data books</span>
      </div>
      {q.isPending ? (
        <p role="status" aria-busy="true" className="px-3 py-6 text-xs text-muted-foreground">
          Loading…
        </p>
      ) : q.error ? (
        <PanelState tone="error" action={<RetryButton onClick={() => void q.refetch()} />}>
          FTC consumer data could not load.
        </PanelState>
      ) : (
        <Body data={q.data} onRetry={() => void q.refetch()} />
      )}
    </section>
  );
}

const SECTION_LABEL = {
  reports: "Consumer Sentinel reports",
  dnc: "Do Not Call",
  calls: "Do Not Call reports by month",
  refunds: "refunds",
  national: "national comparison",
  sources: "edition details",
} as const;

function Body({ data, onRetry }: { data: StateConsumerData; onRetry: () => void }) {
  const y = latest(data.years);
  if (!y && !data.dnc.length && !data.calls.length && !data.refunds.length)
    return data.unavailable.length ? (
      <PanelState tone="error" action={<RetryButton onClick={onRetry} />}>
        FTC consumer data could not load.
      </PanelState>
    ) : (
      <PanelState>No FTC consumer protection records are published for this state yet.</PanelState>
    );
  const first = data.years[0];
  const dnc = latest(data.dnc);
  const takeaways = consumerTakeaways(data);
  // A dataset that has no row for this state is said so once; one that failed to load is named in the note above.
  const absent = [
    !y && !data.unavailable.includes("reports") ? "Consumer Sentinel reports" : null,
    !data.dnc.length && !data.unavailable.includes("dnc") ? "Do Not Call" : null,
    !data.refunds.length && !data.unavailable.includes("refunds") ? "refunds" : null,
  ].filter((s): s is string => s != null);
  const nat = y ? nationalFor(data.national, y.year) : undefined;
  const previous = y ? y.year - 1 : 0;
  const edition = y
    ? editionName(data.editions.sentinel, y.year, "Consumer Sentinel Data Book")
    : "";
  return (
    <>
      {data.unavailable.length ? (
        <PanelState action={<RetryButton onClick={onRetry} />}>
          Not loaded: {data.unavailable.map((s) => SECTION_LABEL[s]).join(", ")}. The rest is shown.
        </PanelState>
      ) : null}
      {y ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-3 py-1.5 text-[11px]">
            <span className="font-medium">Latest edition</span>
            {y.sourceUrl ? (
              <SourceLink href={y.sourceUrl}>{edition}</SourceLink>
            ) : (
              <span className="text-muted-foreground">{edition}</span>
            )}
          </div>
          <StatGrid label={`${y.year} Consumer Sentinel figures`}>
            <Stat
              label="Fraud and other reports"
              value={shown(y.reports)}
              note="Identity theft excluded"
            />
            <Stat
              label="Reports per 100,000 residents"
              value={shown(y.per100k)}
              note={
                [sentence(rankText(y.rank)), rankChangeText(y, previous)]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            <Stat
              label="Identity theft reports"
              value={shown(y.identityTheftReports)}
              note={`${y.identityTheftPer100k ? `${y.identityTheftPer100k.text} per 100,000` : `Per 100,000 ${NOT_RECORDED}`} · ${rankText(y.identityTheftRank)}`}
            />
            <Stat
              label="Reported fraud loss"
              value={shown(y.totalLoss)}
              note={`Reports with a loss of $1 to $999,999${
                y.change.totalLossPct != null
                  ? ` · ${signedPct(y.change.totalLossPct)} against the ${previous} edition`
                  : ""
              }`}
            />
            <Stat
              label="Median fraud loss"
              value={shown(y.medianLoss)}
              note={`United States: ${nat?.medianLoss?.text ?? NOT_RECORDED}`}
            />
            <Stat
              label="Fraud reports with a loss"
              value={y.pctReportingLoss != null ? `${y.pctReportingLoss}%` : NOT_RECORDED}
              note={`Of ${shown(y.fraudReports)} fraud reports`}
            />
          </StatGrid>
          <Note className="px-3 py-1.5">
            Per-100K figures are the FTC&apos;s own, using {populationBasis(y)}. Reports are
            consumer submissions the FTC has not verified.
          </Note>
        </>
      ) : null}
      {absent.length ? (
        <PanelState>Not published for this state: {absent.join(", ")}.</PanelState>
      ) : null}
      <TakeawayList
        items={takeaways}
        scope={[y ? `${y.year} Data Book` : null, dnc ? `FY${dnc.fy} Do Not Call` : null]
          .filter(Boolean)
          .join(" · ")}
      />
      {first && y ? (
        <>
          <PanelSection
            id="consumer-trend"
            title="Reports and losses by edition"
            hint={years(data.years)}
          >
            <Trend data={data} />
          </PanelSection>
          <PanelSection
            id="consumer-categories"
            title="Top categories and identity theft"
            hint={`${y.year}`}
          >
            <Categories data={data} />
          </PanelSection>
        </>
      ) : null}
      {data.dnc.length || data.calls.length ? (
        <PanelSection
          id="consumer-dnc"
          title="Do Not Call complaints"
          hint={
            data.dnc.length
              ? `FY${data.dnc[0]!.fy}–FY${data.dnc[data.dnc.length - 1]!.fy}${data.calls.length ? " · by month" : ""}`
              : "by month"
          }
        >
          <DoNotCall data={data} />
          {data.calls.length ? <ReportedCalls data={data} /> : null}
        </PanelSection>
      ) : null}
      {data.refunds.length ? (
        <PanelSection
          id="consumer-refunds"
          title="Refunds mailed to consumers"
          hint={years(data.refunds)}
        >
          <Refunds data={data} />
        </PanelSection>
      ) : null}
      <PanelSection id="consumer-method" title="Sources and how to read">
        <Method data={data} />
      </PanelSection>
      <p className="border-t border-border/70 px-3 py-2 text-[10.5px] leading-snug text-muted-foreground">
        {FTC_CREDIT}
      </p>
    </>
  );
}

function Trend({ data }: { data: StateConsumerData }) {
  const y = latest(data.years);
  if (!y) return <Note>Consumer Sentinel reports are {NOT_RECORDED} for this state.</Note>;
  const defs = definitionYears(data.national);
  const point = (
    pick: (c: ConsumerYear) => ConsumerYear["per100k"],
    withBasis: boolean,
  ): MiniPoint[] =>
    trendPoints(data.years, pick).map((p) => ({
      x: p.year,
      label: String(p.year),
      y: p.value,
      text: p.text,
      note: withBasis && p.populationYear ? `Census estimate used: ${p.populationYear}` : null,
    }));
  const nationalMedian = nationalMedianPoints(data.years, data.national);
  const medianPoints: MiniPoint[] = point((c) => c.medianLoss, false).map((p, i) => ({
    ...p,
    y2: nationalMedian[i] ?? null,
  }));
  const hasNational = nationalMedian.some((v) => v != null);
  return (
    <>
      <div className="grid gap-x-4 gap-y-3 @xl:grid-cols-2">
        <MiniLine
          title="Fraud and other reports per 100,000"
          valueLabel={`${y.year}: ${shown(y.per100k)}`}
          data={point((c) => c.per100k, true)}
          name="Reports per 100,000"
          format={count}
          markers={defs}
        />
        <MiniLine
          title="Identity theft reports per 100,000"
          valueLabel={`${y.year}: ${y.identityTheftPer100k?.text ?? NOT_RECORDED}`}
          data={point((c) => c.identityTheftPer100k, true)}
          name="Identity theft per 100,000"
          format={count}
          markers={defs}
          color={FDA_COLORS[4]}
        />
        <MiniLine
          title="Reported fraud loss"
          valueLabel={`${y.year}: ${y.totalLoss?.value != null ? usdCompact(y.totalLoss.value) : NOT_RECORDED}`}
          data={point((c) => c.totalLoss, false)}
          name="Reported fraud loss"
          format={dollars}
          axisFormat={usdCompact}
          markers={defs}
          color={FDA_COLORS[2]}
        />
        <MiniLine
          title="Median fraud loss"
          valueLabel={`${y.year}: ${shown(y.medianLoss)}`}
          data={medianPoints}
          name="This state"
          name2={hasNational ? "United States" : undefined}
          format={dollars}
          markers={defs}
          color={FDA_COLORS[3]}
        />
      </div>
      <Note>
        {defs.length
          ? `Dashed vertical lines mark editions with an FTC category-definition notice (${defs.join(", ")}). `
          : ""}
        Each point is the figure as printed in that year&apos;s Data Book; the FTC revises earlier
        years in later editions. Per-100K uses each edition&apos;s own Census estimate (edition:
        estimate year){" "}
        {data.years.map((c) => `${c.year}: ${c.populationYear ?? NOT_RECORDED}`).join(" · ")}, so
        the series mixes population vintages.
      </Note>
    </>
  );
}

function Categories({ data }: { data: StateConsumerData }) {
  const [selected, setSelected] = useState(() => latest(data.years)?.year ?? 0);
  const y = data.years.find((c) => c.year === selected);
  if (!y) return <Note>Consumer Sentinel reports are {NOT_RECORDED} for this state.</Note>;
  const notices = noticesBetween(data.national, y.year, y.year);
  const defs = definitionYears(data.national);
  const reason = (prefix: string) =>
    y.withheld.filter((w) => w.startsWith(prefix)).join("; ") || "no reason on the record";
  return (
    <>
      <label className="flex items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">Data Book edition</span>
        <select
          value={y.year}
          onChange={(e) => setSelected(Number(e.target.value))}
          className="h-7 rounded-md border border-input bg-surface px-2 text-xs"
        >
          {[...data.years].reverse().map((c) => (
            <option key={c.year} value={c.year}>
              {c.year}
              {c.categories ? "" : ` (${NOT_RECORDED})`}
            </option>
          ))}
        </select>
      </label>
      <div className="space-y-1">
        <h4 className="text-xs font-semibold">
          Top ten report categories, {y.year}
          <span className="ml-1 font-normal text-muted-foreground">
            share of the state&apos;s reports
          </span>
        </h4>
        {y.categories ? (
          <ShareBars items={y.categories.map((c) => ({ ...c, label: c.category }))} />
        ) : (
          <>
            <p className="text-xs">{NOT_RECORDED}</p>
            <Note>
              The FTC table was withheld because the PDF text was damaged (record:{" "}
              {reason("top categories")}).
            </Note>
          </>
        )}
      </div>
      <div className="space-y-1">
        <h4 className="text-xs font-semibold">
          Identity theft types, {y.year}
          <span className="ml-1 font-normal text-muted-foreground">
            share of identity theft reports
          </span>
        </h4>
        {y.identityTheftTypes ? (
          <ShareBars
            items={y.identityTheftTypes.map((t) => ({ label: t.type, sharePct: t.sharePct }))}
          />
        ) : (
          <>
            <p className="text-xs">{NOT_RECORDED}</p>
            <Note>
              The FTC table was withheld because the PDF text was damaged (record:{" "}
              {reason("identity theft types")}).
            </Note>
          </>
        )}
      </div>
      {notices.length ? (
        <Note>
          <span className="font-medium text-foreground">
            FTC definition notice for this edition:
          </span>{" "}
          {notices.map((n) => n.notice).join(" ")}
        </Note>
      ) : null}
      <Note>
        The FTC{" "}
        {defs.length
          ? `renamed, retired or consolidated categories in ${defs.join(", ")}`
          : "revises category definitions between editions"}
        , so category shares are not like-for-like across editions. Shares are rounded to whole
        percents as printed.
      </Note>
    </>
  );
}

function DoNotCall({ data }: { data: StateConsumerData }) {
  if (!data.dnc.length)
    return data.calls.length ? null : (
      <Note>Do Not Call figures are {NOT_RECORDED} for this state.</Note>
    );
  const rows = data.dnc;
  const byFy = new Map(rows.map((r) => [r.fy, r]));
  const last = rows[rows.length - 1]!;
  return (
    <>
      <div className="grid gap-x-6 gap-y-3 @2xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold">Complaints</h4>
          <ResponsiveTable
            caption="Do Not Call complaints by fiscal year"
            rows={[...rows].reverse()}
            rowKey={(r) => r.recordId}
            columns={[
              { id: "fy", header: "Fiscal year", role: "title", cell: (r) => `FY${r.fy}` },
              {
                id: "n",
                header: "Complaints",
                align: "right",
                role: "value",
                cell: (r) => shown(r.complaints),
              },
              {
                id: "per",
                header: "Per 100K",
                align: "right",
                role: "detail",
                cell: (r) => shown(r.complaintsPer100k),
              },
              {
                id: "rank",
                header: "Rank",
                align: "right",
                role: "detail",
                cell: (r) => rankCellText(r.complaintsRank),
              },
              {
                id: "yoy",
                header: "vs prior FY",
                align: "right",
                role: "detail",
                cell: (r) => dncChange(r, byFy.get(r.fy - 1)),
              },
            ]}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold">Active registrations</h4>
          <ResponsiveTable
            caption="Do Not Call registrations by fiscal year"
            rows={[...rows].reverse()}
            rowKey={(r) => r.recordId}
            columns={[
              { id: "fy", header: "Fiscal year", role: "title", cell: (r) => `FY${r.fy}` },
              {
                id: "n",
                header: "Registrations",
                align: "right",
                role: "value",
                cell: (r) => shown(r.registrations),
              },
              {
                id: "per",
                header: "Per 100K",
                align: "right",
                role: "detail",
                cell: (r) => shown(r.registrationsPer100k),
              },
              {
                id: "rank",
                header: "Rank",
                align: "right",
                role: "detail",
                cell: (r) => rankCellText(r.registrationsRank),
              },
            ]}
          />
        </div>
      </div>
      <Note>
        Counts and per-100K figures are the FTC&apos;s own, fiscal years October to September;
        per-100K uses each edition&apos;s Census estimate (
        {rows.map((r) => `FY${r.fy}: ${r.populationYear ?? NOT_RECORDED}`).join(" · ")}). The FTC
        ranks the 50 states and prints no rank for the District of Columbia or Puerto Rico (
        {NOT_RECORDED} here). Change against the prior fiscal year is computed from the two printed
        complaint counts.
      </Note>
      <Note>
        Data Books:{" "}
        {rows.map((r, i) => (
          <span key={r.recordId}>
            {i ? " · " : ""}
            {r.sourceUrl ? <SourceLink href={r.sourceUrl}>FY{r.fy}</SourceLink> : `FY${r.fy}`}
          </span>
        ))}
        {data.editions.dnc[last.fy] ? ` (${data.editions.dnc[last.fy]!.name})` : ""}
      </Note>
    </>
  );
}

/** Do Not Call reports counted by month for the state: rows, subjects and what the counted days are. */
function ReportedCalls({ data }: { data: StateConsumerData }) {
  const rows = callsRows(data.calls);
  const subjects = callsSubjects(data.calls);
  const window = callsWindow(data.calls);
  const newest = callsLatest(data.calls);
  const source = newest?.sourceUrl ?? null;
  return (
    <div
      className="space-y-2 border-t border-border/60 pt-2"
      aria-label="Do Not Call reports by month"
    >
      <h4 className="text-xs font-semibold">
        Reports by month created
        <span className="ml-1 font-normal text-muted-foreground">
          reports from consumers who gave this state
        </span>
      </h4>
      <ResponsiveTable
        caption="Do Not Call reports by month for this state"
        rows={rows}
        rowKey={(r) => r.key}
        columns={[
          { id: "m", header: "Month", role: "title", cell: (r) => r.label },
          { id: "n", header: "Reports", align: "right", role: "value", cell: (r) => r.reports },
          {
            id: "p",
            header: "Per 100K residents",
            align: "right",
            role: "detail",
            cell: (r) => r.per100k,
          },
          { id: "r", header: "Rank", align: "right", role: "detail", cell: (r) => r.rank },
          {
            id: "s",
            header: "Robocall share",
            align: "right",
            role: "detail",
            cell: (r) => r.robocallShare,
          },
        ]}
      />
      {rows.some((r) => r.partial) ? (
        <Note>
          * Partial month:{" "}
          {rows
            .filter((r) => r.partial && r.coverage)
            .map((r) => `${r.label.replace("*", "")} covers complaints created ${r.coverage}`)
            .join("; ")}
          . A partial month is not comparable with a whole one.
        </Note>
      ) : null}
      {subjects ? (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">
            Subjects reported
            <span className="ml-1 font-normal text-muted-foreground">
              share of this state&apos;s {subjects.total.toLocaleString("en-US")} reports
              {window ? `, ${window}` : ""}
            </span>
          </h4>
          <ShareBars items={subjects.items} />
          {subjects.catchAll ? (
            <Note>The FTC&apos;s catch-all choices, not ranked above: {subjects.catchAll}.</Note>
          ) : null}
        </div>
      ) : null}
      <Note>
        Every report was counted from the FTC&apos;s daily Do Not Call files (complaints are
        consumers&apos; reports, which the FTC says are not verified). The state is the one the
        consumer gave; reports with no state are in the national count only. Per 100,000 uses the
        Census resident population of July 1, {newest?.populationYear ?? NOT_RECORDED} (Population
        Estimates, vintage {newest?.populationYear ?? NOT_RECORDED}); the rank is among the 50
        states, DC and Puerto Rico in the same month. Robocall share is reports answered as a
        recorded message divided by reports answered either way. Months before the first day above
        are not counted here; the fiscal-year table above is the FTC&apos;s Data Book.
        {source ? (
          <>
            {" "}
            <SourceLink href={source}>FTC Do Not Call reported calls data</SourceLink>
          </>
        ) : null}
      </Note>
    </div>
  );
}

function Refunds({ data }: { data: StateConsumerData }) {
  if (!data.refunds.length) return <Note>Refund figures are {NOT_RECORDED} for this state.</Note>;
  const bars = refundBars(data.refunds);
  return (
    <>
      <ul className="space-y-2 @xl:max-w-xl">
        {[...bars].reverse().map((r) => (
          <li key={r.recordId}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium">{r.year}</span>
              <span className="font-mono">{shown(r.mailed)}</span>
            </div>
            {r.width != null ? (
              <div className="mt-0.5 h-1.5 rounded-sm bg-muted" aria-hidden>
                <span
                  className="block h-1.5 rounded-sm"
                  style={{ width: `${r.width}%`, background: FDA_COLORS[2] }}
                />
              </div>
            ) : null}
            <Note className="mt-0.5">
              {r.sharePct != null
                ? `${r.sharePct}% of the printed state table`
                : `Share of the state table ${NOT_RECORDED}`}
              {" · "}
              {r.yoyPct != null
                ? `${signedPct(r.yoyPct)} against ${r.year - 1}`
                : r.year === data.refunds[0]!.year
                  ? "No earlier year loaded"
                  : `Change ${NOT_RECORDED}`}
              {r.sourceUrl ? (
                <>
                  {" · "}
                  <SourceLink href={r.sourceUrl}>{r.year} report</SourceLink>
                </>
              ) : null}
            </Note>
          </li>
        ))}
      </ul>
      <Note>
        Dollars the FTC mailed to consumers in the state in each calendar year (FTC Annual Report on
        Refunds to Consumers): mailing totals, not a count of consumers or of amounts cashed, which
        the reports do not publish by state ({NOT_RECORDED}). Only 2022 to 2024 are loaded.
      </Note>
    </>
  );
}

function Method({ data }: { data: StateConsumerData }) {
  const notices = data.national.flatMap((n) =>
    n.notices.map((notice) => ({ year: n.year, notice })),
  );
  return (
    <>
      <dl className="space-y-1.5 text-[11px] leading-snug">
        <div>
          <dt className="font-medium">Reports per 100,000</dt>
          <dd className="text-muted-foreground">
            The FTC&apos;s printed figure, not recomputed. The denominator is the FTC&apos;s own
            Census estimate for that edition (the population is not published separately).
          </dd>
        </div>
        <div>
          <dt className="font-medium">Fraud and other reports</dt>
          <dd className="text-muted-foreground">
            Identity theft is counted separately. The FTC leaves out reports with no state and
            reports from state-specific data contributors.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Reported fraud loss</dt>
          <dd className="text-muted-foreground">
            Fraud reports with a loss of $1 to $999,999. Reports are unverified consumer
            submissions, not a survey.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Change against the prior edition</dt>
          <dd className="text-muted-foreground">
            Computed from two editions&apos; printed values. The FTC revises earlier years, so
            editions are different vintages.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Not recorded</dt>
          <dd className="text-muted-foreground">
            The source cell is blank, unranked, or its PDF text was damaged; no value is filled in.
          </dd>
        </div>
      </dl>
      {notices.length ? (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">FTC category-definition notices</h4>
          <ul className="space-y-1 text-[11px] leading-snug text-muted-foreground">
            {notices.map((n) => (
              <li key={`${n.year}-${n.notice}`}>{n.notice}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Note>
        Data Books:{" "}
        {data.years.map((c, i) => (
          <span key={c.recordId}>
            {i ? " · " : ""}
            {c.sourceUrl ? <SourceLink href={c.sourceUrl}>{c.year}</SourceLink> : c.year}
          </span>
        ))}
      </Note>
      {data.terms ? <Note>{data.terms}</Note> : null}
    </>
  );
}
