/** Inflation adjustment between two months with a published CPI series (values and series id shown). */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { monthLabel, isMonthKey } from "@/lib/calculators/dates";
import { getFredLatest, getFredObservations } from "@/lib/calculators/econ.functions";
import {
  INFLATION_SERIES,
  computeInflation,
  inflationInputProblem,
} from "@/lib/calculators/inflation";
import { roundCents } from "@/lib/calculators/postJudgment";
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

export type InflationDefaults = { amount?: string; from?: string; to?: string; series?: string };

export function InflationCalculator({ defaults }: { defaults?: InflationDefaults }) {
  const [amount, setAmount] = useState(defaults?.amount ?? "");
  const [from, setFrom] = useState(defaults?.from ?? "");
  const [series, setSeries] = useState(defaults?.series ?? "CPIAUCNS");
  const latest = useQuery({
    queryKey: ["fred-latest", series],
    queryFn: () => getFredLatest({ data: { series } }),
    staleTime: 10 * 60_000,
  });
  const latestMonth = latest.data?.latest?.date.slice(0, 7) ?? "";
  const [toChosen, setTo] = useState(defaults?.to ?? "");
  const to = toChosen || latestMonth;

  const years = [...new Set([from, to].filter(isMonthKey).map((m) => Number(m.slice(0, 4))))];
  const obs = useQuery({
    queryKey: ["fred", series, years.join(",")],
    queryFn: () => getFredObservations({ data: { series, years } }),
    enabled: years.length > 0 && years.every((y) => y >= 1913),
    staleTime: 10 * 60_000,
  });
  const value = parseAmount(amount);
  const input = { amount: value ?? NaN, fromMonth: from, toMonth: to, seriesId: series };
  const problem = !amount
    ? null
    : value === null
      ? "Enter the amount as a number."
      : inflationInputProblem(input);
  const result = useMemo(
    () =>
      obs.data?.series && !problem && value !== null && isMonthKey(from) && isMonthKey(to)
        ? computeInflation(input, obs.data.series, obs.data.series)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [obs.data, problem, value, from, to, series],
  );
  const chosen = INFLATION_SERIES.find((s) => s.id === series)!;

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Panel title="Amount and months">
        <Field label="Amount (USD)" htmlFor="inf-amount">
          <input
            id="inf-amount"
            inputMode="decimal"
            placeholder="e.g. 10,000.00"
            className={controlClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Dollars of (month)" htmlFor="inf-from">
          <input
            id="inf-from"
            type="month"
            min="1913-01"
            className={controlClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field
          label="Expressed in dollars of (month)"
          htmlFor="inf-to"
          hint={latestMonth ? `Latest published month: ${monthLabel(latestMonth)}.` : undefined}
        >
          <input
            id="inf-to"
            type="month"
            min="1913-01"
            className={controlClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field label="Index" htmlFor="inf-series" hint={chosen.note}>
          <select
            id="inf-series"
            className={controlClass}
            value={series}
            onChange={(e) => setSeries(e.target.value)}
          >
            {INFLATION_SERIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[12px] text-muted-foreground">
          FRED {chosen.id} · BLS series {chosen.bls}
        </p>
      </Panel>
      <Panel title="Result">
        {latest.data && !latest.data.available && !latest.isLoading ? (
          <Note kind="warn">
            Not recorded: the FRED series dataset (econ_fred_series) is not published yet.
          </Note>
        ) : null}
        {obs.isLoading ? <Note kind="loading">Reading the index values…</Note> : null}
        {obs.isError || obs.data?.error ? (
          <Note kind="error">{obs.data?.error ?? "The index could not be read right now."}</Note>
        ) : null}
        {problem ? <Note kind="warn">{problem}</Note> : null}
        {!amount || !isMonthKey(from) ? (
          <Note kind="info">
            Enter an amount and the month it is in; the result uses the published index for both
            months.
          </Note>
        ) : null}
        {result && !result.ok ? <Note kind="warn">{result.reason}</Note> : null}
        {result && result.ok ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Figure
                label={`In ${monthLabel(to)} dollars`}
                value={usd(roundCents(result.adjusted))}
              />
              <Figure
                label="Ratio"
                value={num(result.factor, 6)}
                sub={`${result.to.value} ÷ ${result.from.value}`}
              />
              <Figure
                label="Change in the index"
                value={`${num(result.changePercent, 1)}%`}
                sub={`${monthLabel(from)} to ${monthLabel(to)}`}
              />
            </div>
            <SubHeading>Inputs</SubHeading>
            <Inputs
              items={[
                ["Amount", usd(result.inputs.amount)],
                ["From", monthLabel(from)],
                ["To", monthLabel(to)],
                ["Index", `${chosen.label} (FRED ${chosen.id})`],
              ]}
            />
            <SubHeading>Published values used</SubHeading>
            <SourceObservations rows={[result.from, result.to]} />
            <SubHeading>Method</SubHeading>
            <Method steps={result.method} notes={result.notes} />
          </>
        ) : null}
        <FredNotice />
      </Panel>
    </div>
  );
}
