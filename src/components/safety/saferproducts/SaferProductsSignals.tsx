import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { int, NOT_RECORDED, pct, signedPct } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import {
  LoadingBlock,
  Panel,
  Segmented,
  SortHeader,
  StateNote,
} from "@/components/enforcement/parts";
import {
  getSaferProductsSignals,
  type SaferProductsSignals as SignalsData,
  type SpGrowthLevel,
  type SpTheme,
} from "@/lib/external/saferProducts.functions";
import { Sparkline } from "../Sparkline";
import { saferProductsSignalsQuery } from "./queries";
import { ShowMore } from "../ShowMore";
import { UnverifiedBadge, UnverifiedNotice } from "./parts";
import {
  decliningRows,
  filterByText,
  precisionLabel,
  rankLabel,
  ratioLabel,
  sortGrowth,
  spSignalTakeaways,
  themesByReports,
  UNVERIFIED,
  type GrowthSort,
} from "./saferProductsView";

const STEP = 25;

const LEVELS: { id: SpGrowthLevel; label: string; noun: string }[] = [
  { id: "type", label: "Product types", noun: "product types" },
  { id: "subcategory", label: "Sub categories", noun: "sub categories" },
  { id: "category", label: "Categories", noun: "categories" },
];

type Direction = "all" | "rising" | "falling";

const MEASURES: Measure[] = [
  {
    term: "Change",
    means:
      "Unverified reports published in the three latest complete years against the three before, as a percent change.",
    caveat:
      "Reports move with publicity, recalls and litigation, so a rise is not evidence that more people were harmed.",
  },
  {
    term: "Rate ratio and interval",
    means:
      "Recent reports divided by prior reports, with a 95% interval treating each count as a Poisson count.",
    caveat: "The interval reflects counting noise only, not changes in who reports or why.",
  },
  {
    term: "Rank",
    means:
      "Position among rows where both windows hold at least 30 reports. Rows below that are not ranked and not shown here.",
  },
  {
    term: "Hazard-term count",
    means:
      "Reports whose incident description matches a documented wording rule. A report can match several terms.",
    caveat: "A match is wording, not a confirmed hazard; negation is not modelled.",
  },
  {
    term: "Precision",
    means:
      "Of 20 matching reports sampled per term, the share judged to be about the named hazard, with the Wilson 95% interval.",
    caveat:
      "The reviewer was a language model, not a human domain expert. Precision says nothing about recall: hazards described in other words are missed.",
  },
];

export function SaferProductsSignals() {
  const q = useQuery(saferProductsSignalsQuery);
  return (
    <div className="space-y-3">
      <UnverifiedNotice />
      {q.isLoading ? (
        <LoadingBlock label="Loading SaferProducts.gov growth signals" />
      ) : q.isError ? (
        <StateNote
          tone="error"
          action={
            <button type="button" onClick={() => void q.refetch()} className="underline">
              Retry
            </button>
          }
        >
          The SaferProducts.gov growth signals could not be loaded.
        </StateNote>
      ) : !q.data ? (
        <StateNote>The SaferProducts.gov growth signals have not been published yet.</StateNote>
      ) : (
        <Body data={q.data} />
      )}
    </div>
  );
}

function Body({ data }: { data: SignalsData }) {
  const takeaways = spSignalTakeaways(data);
  return (
    <div className="space-y-3">
      <KeyTakeaways
        items={takeaways}
        scope={`${UNVERIFIED}${data.windows ? ` · ${data.windows.recent} against ${data.windows.prior}` : ""}`}
      />
      <HowToRead measures={MEASURES} />
      <GrowthPanel data={data} />
      <HazardPanel themes={data.themes} />
    </div>
  );
}

function GrowthPanel({ data }: { data: SignalsData }) {
  const [level, setLevel] = useState<SpGrowthLevel>("type");
  const [direction, setDirection] = useState<Direction>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<GrowthSort>("change");
  const [desc, setDesc] = useState(true);
  const [limit, setLimit] = useState(STEP);
  const info = data.levels[level];
  const w = data.windows;
  const rows = useMemo(() => {
    const base =
      direction === "falling"
        ? decliningRows(info.rows)
        : direction === "rising"
          ? info.rows.filter((r) => r.growth.changePct > 0)
          : info.rows;
    return sortGrowth(
      filterByText(
        base,
        query,
        (r) => `${r.name} ${r.category ?? ""} ${r.subcategory ?? ""} ${r.code ?? ""}`,
      ),
      sort,
      desc,
    );
  }, [info.rows, direction, query, sort, desc]);
  const shown = rows.slice(0, limit);
  const noun = LEVELS.find((l) => l.id === level)?.noun ?? "rows";
  const click = (key: GrowthSort) => {
    if (sort === key) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(key !== "name");
    }
    setLimit(STEP);
  };
  const reset = () => setLimit(STEP);
  return (
    <Panel
      id="sp-growth"
      title="Growth in unverified reports"
      subtitle={
        w
          ? `${w.recent} against ${w.prior}; only ${noun} with at least ${w.minReportsPerWindow ?? 30} reports in both windows are ranked (${info.eligible != null && info.total != null ? `${int(info.eligible)} of ${int(info.total)}` : NOT_RECORDED})`
          : "Latest three complete years against the three before"
      }
      actions={
        <>
          <UnverifiedBadge />
          <Segmented
            label="Classification level"
            value={level}
            options={LEVELS.map((l) => ({ id: l.id, label: l.label }))}
            onChange={(l) => {
              setLevel(l);
              reset();
            }}
          />
        </>
      }
      footnote={
        <>
          {UNVERIFIED}: counts are reports published by CPSC, not incidents. Product types, sub
          categories and categories are the export&apos;s own classification. Rows under the
          30-report minimum are not ranked and not shown. The 95% interval is on the ratio of the
          two counts.
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <label className="flex min-w-48 flex-1 items-center gap-1.5 text-xs">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search {noun}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
            placeholder={`Search ${noun}`}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
        </label>
        <Segmented
          label="Direction of change"
          value={direction}
          options={[
            { id: "all", label: "All ranked" },
            { id: "rising", label: "Rising" },
            { id: "falling", label: "Falling" },
          ]}
          onChange={(d) => {
            setDirection(d);
            reset();
          }}
        />
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          {int(rows.length)} {noun}
        </span>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Growth in unverified SaferProducts.gov reports by {noun}
            </caption>
            <thead className="text-left text-[11px] text-muted-foreground">
              <tr>
                <SortHeader
                  label={
                    level === "type"
                      ? "Product type"
                      : level === "category"
                        ? "Category"
                        : "Sub category"
                  }
                  align="left"
                  active={sort === "name"}
                  desc={desc}
                  onClick={() => click("name")}
                />
                <SortHeader
                  label="Change"
                  active={sort === "change"}
                  desc={desc}
                  onClick={() => click("change")}
                />
                <SortHeader
                  label={w ? `Reports ${w.recent}` : "Recent reports"}
                  active={sort === "recent"}
                  desc={desc}
                  onClick={() => click("recent")}
                />
                <SortHeader
                  label={w ? `Reports ${w.prior}` : "Prior reports"}
                  active={sort === "prior"}
                  desc={desc}
                  onClick={() => click("prior")}
                />
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Rate ratio (95% interval)
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Rank
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Trend
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="max-w-72 px-2 py-1">
                    <Link
                      to="/records/$dataset/$id"
                      params={{ dataset: "saferproducts_products", id: r.id }}
                      className="block truncate text-primary hover:underline"
                      title={r.name}
                    >
                      {r.name}
                    </Link>
                    {level !== "category" && r.category ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {r.category}
                        {level === "type" && r.subcategory ? ` · ${r.subcategory}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {signedPct(r.growth.changePct)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{int(r.growth.recent)}</td>
                  <td className="px-2 py-1 text-right font-mono">{int(r.growth.prior)}</td>
                  <td className="px-2 py-1 text-right font-mono">{ratioLabel(r.growth)}</td>
                  <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                    {rankLabel(r.growth)}
                  </td>
                  <td className="px-2 py-1">
                    <Sparkline
                      points={r.yearly.map((y) => ({ value: y.reports, partial: y.partial }))}
                      label={`${r.name}: unverified reports per publication year`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StateNote>
          {info.rows.length
            ? `No ranked ${noun} match these filters.`
            : `No ${noun} are ranked: none has the minimum number of reports in both windows.`}
        </StateNote>
      )}
      <ShowMore
        shown={shown.length}
        total={rows.length}
        step={STEP}
        onMore={() => setLimit((l) => l + STEP)}
        onAll={() => setLimit(rows.length)}
        noun={noun}
      />
    </Panel>
  );
}

function HazardPanel({ themes }: { themes: SpTheme[] }) {
  const ordered = themesByReports(themes);
  return (
    <Panel
      id="sp-hazards"
      title="Hazard terms in the incident descriptions"
      subtitle="Documented wording rules applied to each report's description; the description itself is not published"
      actions={<UnverifiedBadge />}
      footnote="A count is the number of reports whose description matches the wording, not confirmed hazards, and one report can match several terms. Precision: 20 matching reports per term were sampled and judged by the builder's reviewer (a language model, not a human domain expert); the interval is the Wilson 95% interval. Precision says nothing about recall, and negation is not modelled (“no flames” matches Fire)."
    >
      {ordered.length ? (
        <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Hazard terms">
          {ordered.map((t) => (
            <li key={t.theme} className="min-w-0 rounded-md border border-border px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium" title={t.label}>
                  {t.label}
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {int(t.reports)}
                  <span className="ml-1 text-muted-foreground">{pct(t.sharePct, 1)}</span>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">unverified reports matching</p>
              <PrecisionBar precision={t.precision} label={t.label} />
            </li>
          ))}
        </ul>
      ) : (
        <StateNote>Hazard-term counts are {NOT_RECORDED}.</StateNote>
      )}
    </Panel>
  );
}

function PrecisionBar({ precision, label }: { precision: SpTheme["precision"]; label: string }) {
  if (!precision) {
    return <p className="mt-1.5 text-[11px] text-muted-foreground">Precision {NOT_RECORDED}</p>;
  }
  const [lo, hi] = precision.wilson95;
  return (
    <div className="mt-1.5">
      <div
        role="img"
        aria-label={`${label}: ${precisionLabel(precision)}`}
        className="relative h-2 rounded-sm bg-muted"
      >
        <span
          className="absolute inset-y-0 rounded-sm bg-primary/30"
          style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }}
        />
        <span
          className="absolute -top-px h-2.5 w-0.5 bg-primary"
          style={{ left: `calc(${precision.precisionPct}% - 1px)` }}
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        <span className="font-mono font-medium text-foreground">
          {pct(precision.precisionPct, 0)}
        </span>{" "}
        precision · 95% interval {pct(lo, 0)} to {pct(hi, 0)} · {int(precision.correct)} of{" "}
        {int(precision.sampleSize)} sampled
      </p>
    </div>
  );
}
