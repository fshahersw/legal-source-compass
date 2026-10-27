/** State judgment interest rates: only rates an official statute or agency page states; every other state is Not recorded. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { STATES } from "@/lib/corpus/geo";
import { getStateRates, type StateRate } from "@/lib/calculators/econ.functions";
import { daysToEnd, isoToday, rateStatus } from "@/lib/calculators/damagesInputs";
import { Field, Figure, Note, Panel } from "./shared";
import { controlClass } from "./format";

const KIND = { prejudgment: "Prejudgment", postjudgment: "Post-judgment" } as const;

/** Rates set for a stated period read Not recorded once the period has ended, until a newer rate is captured. */
function rateText(r: StateRate, today: string) {
  const status = rateStatus(r, today);
  if (status === "ended") return `Not recorded (the stated period ended ${r.effectiveTo})`;
  if (status === "not_started")
    return `Not recorded yet (the stated period starts ${r.effectiveFrom})`;
  if (r.ratePercent) return `${r.ratePercent}% per year`;
  if (r.rateType === "same_as_prejudgment") return "Same rate as the prejudgment interest awarded";
  if (r.rateType === "published_periodically")
    return "Not recorded (set periodically; current value not read)";
  return "Not recorded";
}

export function StateRatesTable() {
  const q = useQuery({
    queryKey: ["state-rates"],
    queryFn: () => getStateRates(),
    staleTime: 30 * 60_000,
  });
  const [state, setState] = useState("");
  const rates = q.data?.rates ?? [];
  const byState = new Map<string, StateRate[]>();
  for (const r of rates) byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  const shown = STATES.filter((s) => !state || s.usps === state);
  const today = isoToday();
  const covered = byState.size;
  const inForce = rates.filter((r) => r.ratePercent && rateStatus(r, today) === "in_force").length;
  const endingSoon = rates.filter((r) => {
    const d = daysToEnd(r, today);
    return d !== null && d <= 30;
  });
  return (
    <Panel
      title="State prejudgment and post-judgment interest rates"
      actions={
        <div className="w-48">
          <Field label="State" htmlFor="sr-state">
            <select
              id="sr-state"
              className={controlClass}
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">All states</option>
              {STATES.map((s) => (
                <option key={s.usps} value={s.usps}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      }
    >
      <p className="text-[12px] text-muted-foreground">
        A rate appears only where the state's own statute or agency page states it; the words that
        state it are quoted and were checked against the captured page. Contract rates, special
        rules (e.g. public entities, consumer debt) and rates set elsewhere are not computed. Every
        other state shows Not recorded.
      </p>
      {q.data && q.data.available ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure
            label="States with a cited rate"
            value={`${covered} of ${STATES.length}`}
            sub="every other state: Not recorded"
          />
          <Figure
            label="Stated percentages in force today"
            value={String(inForce)}
            sub={`as of ${today}`}
          />
          <Figure
            label="Stated periods ending within 30 days"
            value={String(endingSoon.length)}
            sub={
              endingSoon.length
                ? endingSoon.map((r) => `${r.state} ${r.effectiveTo}`).join(", ")
                : "none"
            }
          />
        </div>
      ) : null}
      {q.isLoading ? <Note kind="loading">Reading the cited rates…</Note> : null}
      {q.data?.error ? <Note kind="error">{q.data.error}</Note> : null}
      {q.data && !q.data.error && !q.data.available ? (
        <Note kind="warn">
          Not recorded: the state rates dataset (econ_state_judgment_rates) is not published yet.
        </Note>
      ) : null}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[44rem] text-[12px]">
          <caption className="sr-only">State judgment interest rates</caption>
          <thead className="text-muted-foreground">
            <tr className="border-b border-border text-left">
              <th className="py-1 pr-3 font-medium">State</th>
              <th className="py-1 pr-3 font-medium">Kind</th>
              <th className="py-1 pr-3 font-medium">Rate</th>
              <th className="py-1 pr-3 font-medium">Provision and scope</th>
              <th className="py-1 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const list = byState.get(s.usps);
              if (!list)
                return (
                  <tr key={s.usps} className="border-b border-border/60 text-muted-foreground">
                    <td className="py-1 pr-3 text-foreground">{s.name}</td>
                    <td className="py-1 pr-3" colSpan={4}>
                      Not recorded
                    </td>
                  </tr>
                );
              return list.map((r, i) => (
                <tr key={r.id} className="border-b border-border/60 align-top">
                  <td className="py-1 pr-3">{i === 0 ? s.name : ""}</td>
                  <td className="py-1 pr-3">{KIND[r.kind]}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {rateText(r, today)}
                    {r.effectiveFrom ? (
                      <span className="block text-[11px] text-muted-foreground">
                        for {r.effectiveFrom} to {r.effectiveTo}
                      </span>
                    ) : null}
                    {r.publisher ? (
                      <span className="block text-[11px] text-muted-foreground">
                        Set by: {r.publisher}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3">
                    <span className="font-medium">{r.provision}</span> · {r.appliesTo}
                    {r.accruesFrom ? (
                      <span className="block text-[11px] text-muted-foreground">
                        Runs from: {r.accruesFrom}
                      </span>
                    ) : null}
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        As stated
                      </summary>
                      <blockquote className="mt-1 border-l-2 border-border pl-2 text-[12px] text-foreground">
                        {r.quote}
                      </blockquote>
                      {r.note ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{r.note}</p>
                      ) : null}
                    </details>
                  </td>
                  <td className="py-1">
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Official page <ExternalLink aria-hidden className="h-3 w-3" />
                    </a>
                    <span className="block text-[11px] text-muted-foreground">
                      read {r.retrievedAt.slice(0, 10)}
                    </span>
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
