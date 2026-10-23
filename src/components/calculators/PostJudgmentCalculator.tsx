/** Federal post-judgment interest under 28 U.S.C. § 1961: rate lookup, daily accrual, annual compounding. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { ChartFrame, LineTrend } from "@/components/charts";
import { metricFormatter } from "@/components/charts/format";
import { addDays, dateLabel, isIsoDate } from "@/lib/calculators/dates";
import { getFredLatest, getFredObservations } from "@/lib/calculators/econ.functions";
import {
  PJI_SERIES,
  PJI_SOURCES,
  computePji,
  findRate,
  pjiInputProblem,
  rateWeekFor,
  roundCents,
  type DayBasis,
} from "@/lib/calculators/postJudgment";
import {
  Field,
  Figure,
  FredNotice,
  Inputs,
  Method,
  Note,
  Panel,
  SourceObservations,
  SubHeading,
} from "./shared";
import { controlClass, num, parseAmount, usd } from "./format";

const today = () => new Date().toISOString().slice(0, 10);

export type PjiDefaults = {
  amount?: string;
  judgment?: string;
  payment?: string;
  basis?: DayBasis;
};

export function PostJudgmentCalculator({ defaults }: { defaults?: PjiDefaults }) {
  const [amount, setAmount] = useState(defaults?.amount ?? "");
  const [judgment, setJudgment] = useState(defaults?.judgment ?? today());
  const [payment, setPayment] = useState(defaults?.payment ?? today());
  const [basis, setBasis] = useState<DayBasis>(defaults?.basis ?? "365");

  const week = isIsoDate(judgment) ? rateWeekFor(judgment) : null;
  const year = week ? Number(week.weekEnding.slice(0, 4)) : null;
  const rateQuery = useQuery({
    queryKey: ["fred", PJI_SERIES, year, "with-previous"],
    queryFn: () => getFredObservations({ data: { series: PJI_SERIES, years: [year! - 1, year!] } }),
    enabled: year !== null && year >= 2000,
    staleTime: 10 * 60_000,
  });
  const latest = useQuery({
    queryKey: ["fred-latest", PJI_SERIES],
    queryFn: () => getFredLatest({ data: { series: PJI_SERIES } }),
    staleTime: 10 * 60_000,
  });
  const recentYear = latest.data?.latest ? Number(latest.data.latest.date.slice(0, 4)) : null;
  const recent = useQuery({
    queryKey: ["fred", PJI_SERIES, "recent", recentYear],
    queryFn: () =>
      getFredObservations({ data: { series: PJI_SERIES, years: [recentYear! - 1, recentYear!] } }),
    enabled: recentYear !== null,
    staleTime: 10 * 60_000,
  });

  const principal = parseAmount(amount);
  const input = {
    principal: principal ?? NaN,
    judgmentDate: judgment,
    paymentDate: payment,
    dayBasis: basis,
  };
  const problem =
    principal === null
      ? amount
        ? "Enter the judgment amount as a number."
        : null
      : pjiInputProblem(input);
  const rate =
    week && rateQuery.data?.series ? findRate(rateQuery.data.series, week.weekEnding) : null;
  const result = useMemo(() => {
    if (problem || principal === null || !rate) return null;
    try {
      return computePji(input, rate, previous);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem, principal, rate, judgment, payment, basis]);

  let rateState: React.ReactNode = null;
  if (!week) rateState = <Note kind="info">Enter the date the judgment was entered.</Note>;
  else if (judgment < "2000-12-21")
    rateState = (
      <Note kind="warn">
        Not recorded: judgments entered before December 21, 2000 used the 52-week Treasury bill
        auction yield, which is not held here.
      </Note>
    );
  else if (rateQuery.isLoading) rateState = <Note kind="loading">Reading the weekly rate…</Note>;
  else if (rateQuery.isError || rateQuery.data?.error)
    rateState = (
      <Note kind="error">{rateQuery.data?.error ?? "The rate could not be read right now."}</Note>
    );
  else if (rateQuery.data && !rateQuery.data.series)
    rateState = (
      <Note kind="warn">
        Not recorded: the FRED series dataset (econ_fred_series) is not published yet.
      </Note>
    );
  else if (rateQuery.data && !rate)
    rateState = (
      <Note kind="warn">
        Not recorded: no weekly average is stored for the week ending {dateLabel(week.weekEnding)}.
        No other week is used.
        {week.weekEnding >= today() || week.effectiveFrom > today()
          ? " That week has not ended or has not been published yet."
          : ""}
      </Note>
    );

  const chartPoints = (recent.data?.series?.obs ?? []).filter((o) => o.value !== null).slice(-52);
  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Panel title="Judgment">
        <Field label="Judgment amount (USD)" htmlFor="pji-amount">
          <input
            id="pji-amount"
            inputMode="decimal"
            placeholder="e.g. 250,000.00"
            className={controlClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Date the judgment was entered" htmlFor="pji-judgment">
          <input
            id="pji-judgment"
            type="date"
            className={controlClass}
            value={judgment}
            onChange={(e) => setJudgment(e.target.value)}
          />
        </Field>
        <Field
          label="Date of payment"
          htmlFor="pji-payment"
          hint="Interest runs to the day before payment."
        >
          <input
            id="pji-payment"
            type="date"
            className={controlClass}
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
          />
        </Field>
        <Field
          label="Day basis"
          htmlFor="pji-basis"
          hint="§ 1961(b) says interest is computed daily; it does not name a day basis. The result states which was used."
        >
          <select
            id="pji-basis"
            className={controlClass}
            value={basis}
            onChange={(e) => setBasis(e.target.value as DayBasis)}
          >
            <option value="365">365-day year</option>
            <option value="actual">Actual days of each judgment year (365 or 366)</option>
          </select>
        </Field>
        {week ? (
          <p className="text-[12px] text-muted-foreground">
            Rate week: the week ending{" "}
            <span className="text-foreground">{dateLabel(week.weekEnding)}</span>, which the courts'
            tables apply to judgments entered {dateLabel(week.effectiveFrom)} to{" "}
            {dateLabel(week.effectiveTo)}.
          </p>
        ) : null}
        <p className="text-[12px] text-muted-foreground">
          Statute:{" "}
          <Link
            to="/law/uscode/$title/$section"
            params={{ title: "28", section: "1961" }}
            className="text-primary hover:underline"
          >
            28 U.S.C. § 1961
          </Link>{" "}
          ·{" "}
          <a
            href={PJI_SOURCES.uscourtsText}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            uscourts.gov <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        </p>
      </Panel>

      <div className="flex min-w-0 flex-col gap-3">
        <Panel title="Result">
          {rateState}
          {problem ? <Note kind="warn">{problem}</Note> : null}
          {!amount && !problem ? (
            <Note kind="info">Enter the judgment amount to compute interest.</Note>
          ) : null}
          {rate && !result && !problem && amount ? <Note kind="info">Check the dates.</Note> : null}
          {rate ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <Figure label="Rate" value={`${rate.value}%`} sub={`Week ending ${rate.date}`} />
              <Figure
                label="Interest"
                value={result ? usd(roundCents(result.interest)) : "—"}
                sub={result ? `${result.days.toLocaleString("en-US")} days` : undefined}
              />
              <Figure
                label="Total due"
                value={result ? usd(roundCents(result.total)) : "—"}
                sub={result ? `Per day in year 1: ${usd(roundCents(result.perDiem))}` : undefined}
              />
            </div>
          ) : null}
          {result ? (
            <>
              <SubHeading>Inputs</SubHeading>
              <Inputs
                items={[
                  ["Judgment amount", usd(result.inputs.principal)],
                  ["Judgment entered", dateLabel(result.inputs.judgmentDate)],
                  ["Payment", dateLabel(result.inputs.paymentDate)],
                  [
                    "Day basis",
                    result.inputs.dayBasis === "365"
                      ? "365-day year"
                      : "Actual days of each judgment year",
                  ],
                ]}
              />
              <SubHeading>Accrual by judgment year</SubHeading>
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-[12px]">
                  <caption className="sr-only">Interest by judgment year</caption>
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border text-left">
                      <th className="py-1 pr-3 font-medium">From</th>
                      <th className="py-1 pr-3 font-medium">To (exclusive)</th>
                      <th className="py-1 pr-3 text-right font-medium">Days</th>
                      <th className="py-1 pr-3 text-right font-medium">Balance</th>
                      <th className="py-1 pr-3 text-right font-medium">Interest</th>
                      <th className="py-1 font-medium">Compounded</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {result.periods.map((p) => (
                      <tr key={p.from} className="border-b border-border/60">
                        <td className="py-1 pr-3">{p.from}</td>
                        <td className="py-1 pr-3">{p.to}</td>
                        <td className="py-1 pr-3 text-right">
                          {p.days} / {p.basisDays}
                        </td>
                        <td className="py-1 pr-3 text-right">{usd(roundCents(p.opening))}</td>
                        <td className="py-1 pr-3 text-right">{usd(roundCents(p.interest))}</td>
                        <td className="py-1">
                          {p.compounded ? "Yes, at the anniversary" : "No (partial year)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SubHeading>Published value used</SubHeading>
              <SourceObservations rows={[result.rate]} />
              <SubHeading>Method</SubHeading>
              <Method steps={result.method} notes={result.notes} />
            </>
          ) : null}
          <FredNotice />
        </Panel>

        <ChartFrame
          title="Weekly 1-year Treasury average (the § 1961 rate), last 52 published weeks"
          unit="percent per year"
          period={
            chartPoints.length
              ? `${chartPoints[0]!.date} to ${chartPoints.at(-1)!.date}`
              : undefined
          }
          sources={[
            { label: "FRED WGS1YR", url: PJI_SOURCES.fred },
            { label: "Federal Reserve H.15", url: PJI_SOURCES.h15 },
          ]}
          status={
            latest.isLoading || recent.isLoading
              ? { kind: "loading" }
              : latest.isError || recent.isError
                ? { kind: "error", message: "The series could not be read." }
                : chartPoints.length === 0
                  ? {
                      kind: "empty",
                      reason: "Not recorded: the weekly series is not published yet.",
                    }
                  : { kind: "ready" }
          }
          notes={[
            "Each point is a week's average (week ending Friday); it applies to judgments entered the following Monday to Sunday.",
          ]}
          table={{
            caption: "Weekly averages",
            columns: [{ label: "Week ending" }, { label: "Rate", align: "right" }],
            rows: chartPoints.map((o) => ({ key: o.date, cells: [o.date, `${o.value}%`] })),
          }}
        >
          <LineTrend
            ariaLabel="Weekly 1-year Treasury constant maturity average"
            series={[
              {
                id: "wgs1yr",
                label: "1-year Treasury, weekly average",
                points: chartPoints.map((o) => ({ key: o.date, value: Number(o.value) })),
              },
            ]}
            axis={{
              keys: chartPoints.map((o) => o.date),
              label: (k) => `Week ending ${k}`,
              tick: (k) => k.slice(5),
            }}
            formatter={{
              ...metricFormatter("percent"),
              full: (v) => (v === null || v === undefined ? "Not recorded" : `${num(v)}%`),
            }}
            zero={false}
            height={180}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
