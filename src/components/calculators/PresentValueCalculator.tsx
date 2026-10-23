/** Present value of a stream of annual amounts discounted at a published Treasury constant-maturity yield. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dateLabel, isIsoDate } from "@/lib/calculators/dates";
import { getFredLatest, getFredObservations } from "@/lib/calculators/econ.functions";
import { roundCents } from "@/lib/calculators/postJudgment";
import {
  computePv,
  pvInputProblem,
  type RateBasis,
  type Timing,
} from "@/lib/calculators/presentValue";
import type { SourceObservation } from "@/lib/calculators/types";
import { TREASURY_MATURITIES } from "@/lib/ingest/sources/fredSpec";
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

export function PresentValueCalculator() {
  const [amount, setAmount] = useState("");
  const [years, setYears] = useState("10");
  const [growth, setGrowth] = useState("0");
  const [timing, setTiming] = useState<Timing>("end");
  const [basis, setBasis] = useState<RateBasis>("annual");
  const [series, setSeries] = useState("DGS10");
  const latest = useQuery({
    queryKey: ["fred-latest", series],
    queryFn: () => getFredLatest({ data: { series } }),
    staleTime: 10 * 60_000,
  });
  const [dateChosen, setDate] = useState("");
  const date = dateChosen || latest.data?.latest?.date || "";
  const year = isIsoDate(date) ? Number(date.slice(0, 4)) : null;
  const obs = useQuery({
    queryKey: ["fred", series, year, "pv"],
    queryFn: () => getFredObservations({ data: { series, years: [year! - 1, year!] } }),
    enabled: year !== null && year > 1962,
    staleTime: 10 * 60_000,
  });
  const exact = obs.data?.series?.obs.find((o) => o.date === date && o.value !== null) ?? null;
  const earlier =
    obs.data?.series?.obs.filter((o) => o.date < date && o.value !== null).at(-1) ?? null;
  const rate: SourceObservation | null =
    exact && obs.data?.series
      ? {
          seriesId: series,
          label: obs.data.series.label,
          date: exact.date,
          value: exact.value!,
          units: obs.data.series.units,
          vintage: exact.vintage,
          url: obs.data.series.url,
          ...(exact.firstVintage !== undefined
            ? { firstValue: exact.firstValue ?? null, firstVintage: exact.firstVintage }
            : {}),
        }
      : null;
  const amt = parseAmount(amount);
  const input = {
    amount: amt ?? NaN,
    years: Number(years),
    growthPercent: Number(growth),
    timing,
    basis,
  };
  const problem = !amount
    ? null
    : amt === null
      ? "Enter the annual amount as a number."
      : pvInputProblem(input);
  const result = useMemo(
    () => (rate && !problem && amt !== null ? computePv(input, rate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rate?.value, rate?.date, problem, amt, years, growth, timing, basis],
  );
  const maturity = TREASURY_MATURITIES.find((m) => m.daily === series);

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Panel title="Stream and discount rate">
        <Field label="Annual amount (USD)" htmlFor="pv-amount">
          <input
            id="pv-amount"
            inputMode="decimal"
            placeholder="e.g. 50,000.00"
            className={controlClass}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Years" htmlFor="pv-years">
            <input
              id="pv-years"
              inputMode="numeric"
              className={controlClass}
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
          </Field>
          <Field
            label="Growth per year (%)"
            htmlFor="pv-growth"
            hint="Your assumption; 0 for level payments."
          >
            <input
              id="pv-growth"
              inputMode="decimal"
              className={controlClass}
              value={growth}
              onChange={(e) => setGrowth(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Payments at" htmlFor="pv-timing">
          <select
            id="pv-timing"
            className={controlClass}
            value={timing}
            onChange={(e) => setTiming(e.target.value as Timing)}
          >
            <option value="end">End of each year</option>
            <option value="start">Start of each year</option>
          </select>
        </Field>
        <Field label="Treasury maturity" htmlFor="pv-maturity">
          <select
            id="pv-maturity"
            className={controlClass}
            value={series}
            onChange={(e) => {
              setSeries(e.target.value);
              setDate("");
            }}
          >
            {TREASURY_MATURITIES.map((m) => (
              <option key={m.daily} value={m.daily}>
                {m.label} (FRED {m.daily})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Yield on (date)"
          htmlFor="pv-date"
          hint={latest.data?.latest ? `Latest published: ${latest.data.latest.date}.` : undefined}
        >
          <input
            id="pv-date"
            type="date"
            className={controlClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field
          label="Yield treated as"
          htmlFor="pv-basis"
          hint="H.15 quotes these yields on an investment (bond-equivalent) basis; the calculator does not choose for you."
        >
          <select
            id="pv-basis"
            className={controlClass}
            value={basis}
            onChange={(e) => setBasis(e.target.value as RateBasis)}
          >
            <option value="annual">An annual rate (r = y)</option>
            <option value="semiannual">
              A semiannual bond-equivalent yield (r = (1 + y/2)² − 1)
            </option>
          </select>
        </Field>
      </Panel>
      <Panel title="Result">
        {latest.data && !latest.data.available && !latest.isLoading ? (
          <Note kind="warn">Not recorded: the FRED series dataset is not published yet.</Note>
        ) : null}
        {obs.isLoading ? <Note kind="loading">Reading the yield…</Note> : null}
        {obs.isError || obs.data?.error ? (
          <Note kind="error">{obs.data?.error ?? "The yield could not be read right now."}</Note>
        ) : null}
        {obs.data?.series && date && !exact ? (
          <Note kind="warn">
            Not recorded: no {maturity?.label} yield is published for {dateLabel(date)} (FRED shows
            no value on weekends and holidays). No other date is substituted.
            {earlier ? (
              <>
                {" "}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => setDate(earlier.date)}
                >
                  Use {earlier.date} instead ({earlier.value}%)
                </button>
              </>
            ) : null}
          </Note>
        ) : null}
        {problem ? <Note kind="warn">{problem}</Note> : null}
        {!amount ? (
          <Note kind="info">
            Enter the annual amount; the result discounts each payment at the published yield.
          </Note>
        ) : null}
        {result ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Figure label="Present value" value={usd(roundCents(result.presentValue))} />
              <Figure label="Undiscounted total" value={usd(roundCents(result.nominalTotal))} />
              <Figure
                label="Discount rate"
                value={`${num(result.annualRate * 100, 4)}%`}
                sub={`${maturity?.label} yield ${result.rate.value}% on ${result.rate.date}`}
              />
            </div>
            <SubHeading>Inputs</SubHeading>
            <Inputs
              items={[
                ["Annual amount", usd(result.inputs.amount)],
                ["Years", String(result.inputs.years)],
                ["Growth", `${result.inputs.growthPercent}% a year`],
                ["Timing", timing === "end" ? "End of each year" : "Start of each year"],
                [
                  "Yield treated as",
                  basis === "annual" ? "Annual rate" : "Semiannual bond-equivalent yield",
                ],
              ]}
            />
            <SubHeading>Published value used</SubHeading>
            <SourceObservations rows={[result.rate]} />
            <SubHeading>Payments</SubHeading>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-[12px] tabular-nums">
                <caption className="sr-only">Discounted payments</caption>
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border text-left">
                    <th className="py-1 pr-3 font-medium">t</th>
                    <th className="py-1 pr-3 text-right font-medium">Payment</th>
                    <th className="py-1 pr-3 text-right font-medium">Discount factor</th>
                    <th className="py-1 text-right font-medium">Present value</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.t} className="border-b border-border/60">
                      <td className="py-1 pr-3">{r.t}</td>
                      <td className="py-1 pr-3 text-right">{usd(roundCents(r.payment))}</td>
                      <td className="py-1 pr-3 text-right">{num(r.factor, 6)}</td>
                      <td className="py-1 text-right">{usd(roundCents(r.pv))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeading>Method</SubHeading>
            <Method steps={result.method} />
          </>
        ) : null}
        <FredNotice />
      </Panel>
    </div>
  );
}
