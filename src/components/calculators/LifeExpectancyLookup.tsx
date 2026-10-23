/** Life expectancy at an age from the NCHS United States life tables (table year, sex, race and Hispanic origin). */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { getLifeTable, getLifeTableIndex } from "@/lib/calculators/econ.functions";
import {
  LIFE_GROUPS,
  LIFE_SEXES,
  lifeExpectancy,
  oneDecimal,
  type LifeGroup,
  type LifeSex,
} from "@/lib/calculators/lifeExpectancy";
import { Field, Figure, Method, Note, Panel, SubHeading } from "./shared";
import { controlClass } from "./format";

export function LifeExpectancyLookup() {
  const index = useQuery({
    queryKey: ["life-index"],
    queryFn: () => getLifeTableIndex(),
    staleTime: 30 * 60_000,
  });
  const entries = index.data?.entries ?? [];
  const years = [...new Set(entries.map((e) => e.year))].sort((a, b) => b - a);
  const [yearChosen, setYear] = useState<number | null>(null);
  const year = yearChosen ?? years[0] ?? null;
  const [group, setGroup] = useState<LifeGroup>("total");
  const [sex, setSex] = useState<LifeSex>("total");
  const [age, setAge] = useState("40");
  const entry = entries.find((e) => e.year === year && e.group === group && e.sex === sex) ?? null;
  const groupsForYear = new Set(entries.filter((e) => e.year === year).map((e) => e.group));
  const table = useQuery({
    queryKey: ["life-table", entry?.id],
    queryFn: () => getLifeTable({ data: { id: entry!.id } }),
    enabled: !!entry,
    staleTime: 30 * 60_000,
  });
  const ageNum = /^\d{1,3}$/.test(age) ? Number(age) : NaN;
  const result = useMemo(
    () => (table.data?.table ? lifeExpectancy(table.data.table, ageNum) : null),
    [table.data, ageNum],
  );
  const around = result?.ok
    ? table.data!.table!.rows.filter((r) => {
        const a = Number(r[0]!.split(/[- ]/)[0]);
        return (
          Math.abs(a - result.age) <= 2 ||
          (result.ageRow.includes("over") && r[0] === result.ageRow)
        );
      })
    : [];

  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Panel title="Person and table">
        <Field label="Age at last birthday" htmlFor="le-age">
          <input
            id="le-age"
            inputMode="numeric"
            className={controlClass}
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </Field>
        <Field label="Sex" htmlFor="le-sex">
          <select
            id="le-sex"
            className={controlClass}
            value={sex}
            onChange={(e) => setSex(e.target.value as LifeSex)}
          >
            {Object.entries(LIFE_SEXES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Race and Hispanic origin"
          htmlFor="le-group"
          hint="Groups as NCHS published them for the table year."
        >
          <select
            id="le-group"
            className={controlClass}
            value={group}
            onChange={(e) => setGroup(e.target.value as LifeGroup)}
          >
            {Object.entries(LIFE_GROUPS).map(([k, v]) => (
              <option key={k} value={k} disabled={!!year && !groupsForYear.has(k as LifeGroup)}>
                {v}
                {year && !groupsForYear.has(k as LifeGroup) ? " (not published for this year)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Table year" htmlFor="le-year">
          <select
            id="le-year"
            className={controlClass}
            value={year ?? ""}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={!years.length}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </Panel>
      <Panel title="Life expectancy">
        {index.isLoading ? <Note kind="loading">Reading the list of NCHS tables…</Note> : null}
        {index.data?.error ? <Note kind="error">{index.data.error}</Note> : null}
        {index.data && !index.data.error && entries.length === 0 ? (
          <Note kind="warn">
            Not recorded: the NCHS life tables dataset (econ_nchs_life_tables) is not published yet.
          </Note>
        ) : null}
        {year && !entry && entries.length ? (
          <Note kind="warn">
            Not recorded: NCHS published no {year} table for this group and sex.
          </Note>
        ) : null}
        {table.isLoading ? <Note kind="loading">Reading the table…</Note> : null}
        {table.data?.error ? <Note kind="error">{table.data.error}</Note> : null}
        {result && !result.ok ? <Note kind="warn">{result.reason}</Note> : null}
        {result && result.ok ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Figure
                label="Remaining years, e(x)"
                value={result.exDisplay}
                sub={`workbook value ${result.ex}`}
              />
              <Figure
                label="Implied age"
                value={oneDecimal(String(result.expectedAge))}
                sub={`age ${result.age} + e(x)`}
              />
              <Figure
                label="Survivors to this age"
                value={Number(result.lx).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                sub="of 100,000 born alive"
              />
            </div>
            <SubHeading>Rows of the table around this age</SubHeading>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-[12px] tabular-nums">
                <caption className="sr-only">Life table rows</caption>
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border text-left">
                    <th className="py-1 pr-3 font-medium">Age</th>
                    <th className="py-1 pr-3 text-right font-medium">q(x)</th>
                    <th className="py-1 pr-3 text-right font-medium">l(x)</th>
                    <th className="py-1 text-right font-medium">e(x)</th>
                  </tr>
                </thead>
                <tbody>
                  {around.map((r) => (
                    <tr
                      key={r[0]}
                      className={
                        r[0] === result.ageRow
                          ? "bg-muted/60 font-medium"
                          : "border-b border-border/60"
                      }
                    >
                      <td className="py-1 pr-3">{r[0]}</td>
                      <td className="py-1 pr-3 text-right">{Number(r[1]).toFixed(6)}</td>
                      <td className="py-1 pr-3 text-right">
                        {Math.round(Number(r[2])).toLocaleString("en-US")}
                      </td>
                      <td className="py-1 text-right">{oneDecimal(r[6]!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeading>Method</SubHeading>
            <Method steps={result.method} />
            <p className="flex flex-wrap gap-3 text-[12px]">
              <a
                href={result.table.reportUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {result.table.report} (PDF) <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
              <a
                href={result.table.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Table {result.table.table} workbook <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            </p>
          </>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          National Center for Health Statistics, National Vital Statistics Reports. Every age row of
          every table was checked against the printed report.
        </p>
      </Panel>
    </div>
  );
}
