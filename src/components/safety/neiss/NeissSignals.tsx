import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { HowToRead, type Measure } from "@/components/analysis/HowToRead";
import { int, NOT_RECORDED, pct } from "@/components/analysis/analysisFormat";
import { KeyTakeaways } from "@/components/analysis/KeyTakeaways";
import {
  FlagChip,
  LoadingBlock,
  Panel,
  Segmented,
  SortHeader,
  StateNote,
} from "@/components/enforcement/parts";
import {
  getNeissProducts,
  getNeissThemes,
  type NeissProduct,
  type NeissProducts,
  type NeissTheme,
  type NeissThemes,
} from "@/lib/external/neiss.functions";
import { cn } from "@/lib/utils";
import { ShowMore } from "../ShowMore";
import { Sparkline } from "../Sparkline";
import { NeissBadge, NeissCredit, NeissNotice } from "./parts";
import { neissProductsQuery, neissThemesQuery } from "./queries";
import {
  cvOf,
  figureNote,
  figureText,
  filterProducts,
  modeOf,
  neissSignalTakeaways,
  NEISS_LABEL,
  NO_CASES,
  POOLED_LABEL,
  productChange,
  productCounts,
  sortProducts,
  themeSpark,
  withheldReasons,
  WITHHELD,
  type ProductMode,
  type ProductSort,
} from "./neissView";

const STEP = 25;

export function NeissSignals() {
  const q = useQuery(neissProductsQuery);
  return (
    <div className="space-y-3">
      <NeissNotice breakYear={q.data?.designBreakYear ?? null} />
      {q.isLoading ? (
        <LoadingBlock label="Loading NEISS product signals" />
      ) : q.isError ? (
        <StateNote
          tone="error"
          action={
            <button type="button" onClick={() => void q.refetch()} className="underline">
              Retry
            </button>
          }
        >
          The NEISS product signals could not be loaded.
        </StateNote>
      ) : !q.data ? (
        <StateNote>The NEISS product estimates have not been published yet.</StateNote>
      ) : (
        <ProductsBody data={q.data} />
      )}
      <ThemeStrip breakYear={q.data?.designBreakYear ?? null} />
      <NeissCredit />
    </div>
  );
}

function measures(data: NeissProducts): Measure[] {
  const b = data.designBreakYear;
  const y = data.latestYear;
  return [
    {
      term: `${y} estimate`,
      means:
        "A weighted national estimate of emergency-department-treated injuries associated with the product code, with its CV and 95% interval.",
      caveat: "Not a case count. Products overlap, so rows must not be added.",
    },
    {
      term: "Withheld (unstable)",
      means:
        "CPSC's rule withholds an estimate below 1,200, resting on fewer than 20 sample cases, or with a CV above 33%. The row shows only its unweighted sample count.",
      caveat: "A sample count is a number of records, not a national estimate.",
    },
    {
      term: `${y} against ${y - 1}`,
      means:
        "A change is flagged only when both years are reliable and the difference exceeds 1.96 times its standard error.",
      caveat: `The test treats the two years as independent, so it is conservative. ${b != null && y - 1 >= b ? `Both years use the ${b} sample design.` : ""}`,
    },
    {
      term: POOLED_LABEL,
      means:
        "Five-year total built within two sample-design periods; it smooths year-to-year noise.",
      caveat: "Its CV is an upper bound: CPSC publishes no multi-year rule.",
    },
    {
      term: "Trend",
      means: `Reliable annual estimates only, from a zero baseline, broken where a year is withheld${b != null ? `; the dashed tick marks the ${b} sample redesign` : ""}.`,
      caveat:
        "Product codes are split, merged and retired over time, so a series is not always like-for-like.",
    },
  ];
}

function ProductsBody({ data }: { data: NeissProducts }) {
  const [mode, setMode] = useState<ProductMode>("reliable");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProductSort>("estimate");
  const [desc, setDesc] = useState(true);
  const [limit, setLimit] = useState(STEP);
  const counts = useMemo(() => productCounts(data.rows), [data.rows]);
  const takeaways = useMemo(
    () => neissSignalTakeaways(data.rows, data.latestYear),
    [data.rows, data.latestYear],
  );
  const rows = useMemo(
    () => sortProducts(filterProducts(data.rows, { mode, flaggedOnly, query }), sort, desc),
    [data.rows, mode, flaggedOnly, query, sort, desc],
  );
  const shown = rows.slice(0, limit);
  const breakIndex = data.designBreakYear != null ? data.years.indexOf(data.designBreakYear) : -1;
  const reset = () => setLimit(STEP);
  const click = (key: ProductSort) => {
    if (sort === key) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(key !== "name");
    }
    reset();
  };
  const y = data.latestYear;
  return (
    <div className="space-y-3">
      <KeyTakeaways items={takeaways} scope={`${NEISS_LABEL} · ${y} against ${y - 1}`} />
      <HowToRead measures={measures(data)} />
      <Panel
        id="neiss-signals"
        title="Product signals"
        subtitle={`${int(data.rows.length)} NEISS product codes; weighted national estimates, flagged only when the change is beyond sampling error and both years are reliable`}
        actions={
          <>
            <NeissBadge />
            <Segmented
              label="Estimate status"
              value={mode}
              options={[
                { id: "reliable", label: `Reliable (${int(counts.reliable)})` },
                { id: "withheld", label: `${WITHHELD} (${int(counts.withheld)})` },
                { id: "none", label: `${NO_CASES} (${int(counts.none)})` },
              ]}
              onChange={(m) => {
                setMode(m);
                if (m !== "reliable") setFlaggedOnly(false);
                reset();
              }}
            />
          </>
        }
        footnote={`${y} is the newest file CPSC serves and may be revised. A withheld row shows its unweighted sample count and never an estimate. Product codes change meaning over time (splits, merges, retirements), so a series is not always like-for-like. Estimates for different products overlap and are not additive.`}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <label className="flex min-w-48 flex-1 items-center gap-1.5 text-xs">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Search NEISS products</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                reset();
              }}
              placeholder="Search product name or code"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </label>
          {mode === "reliable" ? (
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => {
                  setFlaggedOnly(e.target.checked);
                  reset();
                }}
                className="size-3.5 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
              />
              Changes beyond sampling error only ({int(counts.flagged)})
            </label>
          ) : null}
          <span className="text-[11px] text-muted-foreground" aria-live="polite">
            {int(rows.length)} products
          </span>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">NEISS product estimates and changes</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr>
                  <SortHeader
                    label="Product"
                    align="left"
                    active={sort === "name"}
                    desc={desc}
                    onClick={() => click("name")}
                  />
                  <SortHeader
                    label={`${y} estimate (95% interval)`}
                    active={sort === "estimate"}
                    desc={desc}
                    onClick={() => click("estimate")}
                  />
                  <SortHeader
                    label="CV"
                    active={sort === "cv"}
                    desc={desc}
                    onClick={() => click("cv")}
                  />
                  <SortHeader
                    label={`${POOLED_LABEL} (CV)`}
                    active={sort === "pooled"}
                    desc={desc}
                    onClick={() => click("pooled")}
                  />
                  <SortHeader
                    label={`${y} against ${y - 1}`}
                    active={sort === "change"}
                    desc={desc}
                    onClick={() => click("change")}
                  />
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((p) => (
                  <ProductRow key={p.code} p={p} years={data.years} breakIndex={breakIndex} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StateNote>
            {flaggedOnly
              ? "No product has a change beyond the sampling error with these filters."
              : query
                ? `No product matches “${query}” in this status group.`
                : "No product codes in this status group."}
          </StateNote>
        )}
        <ShowMore
          shown={shown.length}
          total={rows.length}
          step={STEP}
          onMore={() => setLimit((l) => l + STEP)}
          onAll={() => setLimit(rows.length)}
          noun="products"
        />
      </Panel>
    </div>
  );
}

function ProductRow({
  p,
  years,
  breakIndex,
}: {
  p: NeissProduct;
  years: number[];
  breakIndex: number;
}) {
  const change = productChange(p);
  const mode = modeOf(p);
  const spanLabel = years.length ? `${years[0]} to ${years.at(-1)}` : "";
  return (
    <tr>
      <td className="max-w-56 px-2 py-1 xl:max-w-80">
        <Link
          to="/records/$dataset/$id"
          params={{ dataset: "neiss_product_estimates", id: p.code }}
          className="block truncate text-primary hover:underline"
          title={p.label}
        >
          {p.label}
        </Link>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{p.code}</span>
          {p.status === "retired" ? (
            <FlagChip title="CPSC deleted or retired this product code">Retired code</FlagChip>
          ) : null}
        </span>
      </td>
      <td className="px-2 py-1 text-right">
        <span className={cn("font-mono", mode !== "reliable" && "text-muted-foreground")}>
          {figureText(p.latest)}
        </span>
        {figureNote(p.latest, { cv: false, label: false }) ? (
          <span
            className="block text-[11px] text-muted-foreground"
            title={withheldReasons(p.latest) ?? undefined}
          >
            {figureNote(p.latest, { cv: false, label: false })}
          </span>
        ) : null}
        {withheldReasons(p.latest) ? (
          <span className="block text-[11px] text-muted-foreground">
            CPSC rule: {withheldReasons(p.latest)}
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1 text-right font-mono">
        {cvOf(p.latest) != null ? (
          pct(cvOf(p.latest), 1)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1 text-right">
        <span
          className={cn("font-mono", p.pooled?.state !== "estimate" && "text-muted-foreground")}
        >
          {figureText(p.pooled)}
        </span>
        {p.pooled?.state === "estimate" ? (
          <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
            CV {pct(p.pooled.cvPct, 1)}, upper bound
          </span>
        ) : p.pooled?.state === "withheld" ? (
          <span className="block text-[11px] text-muted-foreground">
            {int(p.pooled.cases)} sample cases (unweighted)
          </span>
        ) : null}
      </td>
      <td className="px-2 py-1 text-right" title={change.title}>
        {change.flagged ? (
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="font-mono font-semibold">{change.text}</span>
            <FlagChip title="Exceeds the sampling error; both years are reliable estimates">
              Beyond sampling error
            </FlagChip>
          </span>
        ) : (
          <span className="text-muted-foreground">{change.text}</span>
        )}
      </td>
      <td className="px-2 py-1">
        {mode === "reliable" ? (
          <Sparkline
            points={p.spark.map((value) => ({ value }))}
            breakBefore={breakIndex > 0 ? breakIndex : null}
            width={96}
            label={`${p.label}: reliable weighted estimates per year, ${spanLabel}`}
          />
        ) : (
          <span className="text-[11px] text-muted-foreground">No reliable estimate</span>
        )}
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------------------------ theme strip

function ThemeStrip({ breakYear }: { breakYear: number | null }) {
  const q = useQuery(neissThemesQuery);
  if (q.isLoading) return <LoadingBlock label="Loading NEISS narrative themes" />;
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
        The NEISS narrative themes could not be loaded.
      </StateNote>
    );
  if (!q.data)
    return <StateNote>The NEISS narrative themes have not been published yet.</StateNote>;
  return <ThemesBody data={q.data} breakYear={breakYear} />;
}

function ThemesBody({ data, breakYear }: { data: NeissThemes; breakYear: number | null }) {
  const comparableFrom = data.themes.find((t) => t.comparableFrom != null)?.comparableFrom ?? null;
  return (
    <Panel
      id="neiss-themes"
      title="Emerging-hazard themes"
      subtitle={`Keyword themes over the injury narratives: this project's classification, not CPSC categories. Trend lines start${comparableFrom != null ? ` in ${comparableFrom}, the first year with comparable narratives` : " where narratives are comparable"}${breakYear != null ? `; the dashed tick marks the ${breakYear} sample redesign` : ""}.`}
      actions={
        <>
          <NeissBadge />
          <span className="inline-flex items-center rounded border border-warning/40 bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning-foreground">
            Not a CPSC category
          </span>
        </>
      }
      footnote={
        data.classification ??
        "A theme counts cases whose narrative contains the listed words; it misses cases whose narrative omits them and can include off-topic mentions. Narratives were limited to 142 characters before 2019, so earlier counts are not comparable."
      }
    >
      <ul
        className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Narrative keyword themes"
      >
        {data.themes.map((t) => (
          <ThemeCard key={t.id} t={t} breakYear={breakYear} />
        ))}
      </ul>
    </Panel>
  );
}

function ThemeCard({ t, breakYear }: { t: NeissTheme; breakYear: number | null }) {
  const from = t.comparableFrom;
  const points = themeSpark(t);
  const start =
    from != null
      ? Math.max(
          0,
          t.years.findIndex((y) => y >= from),
        )
      : 0;
  const slice = points.slice(start);
  const latestYear = t.latestYear;
  const breakIdx = breakYear != null ? t.years.indexOf(breakYear) - start : -1;
  return (
    <li className="min-w-0 rounded-md border border-border px-3 py-2 text-xs">
      <p className="truncate font-medium" title={t.description ?? t.label}>
        {t.label}
      </p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("font-mono", t.latest?.state !== "estimate" && "text-muted-foreground")}>
            {figureText(t.latest)}
            {latestYear != null ? (
              <span className="ml-1 font-sans text-[11px] text-muted-foreground">{latestYear}</span>
            ) : null}
          </p>
          <p
            className="text-[11px] text-muted-foreground"
            title={withheldReasons(t.latest) ?? undefined}
          >
            {figureNote(t.latest) ??
              (t.latest?.state === "none" ? "No sample cases" : NOT_RECORDED)}
          </p>
        </div>
        <Sparkline
          points={slice}
          breakBefore={breakIdx > 0 ? breakIdx : null}
          label={`${t.label}: reliable weighted estimates per year${from != null ? ` from ${from}` : ""}`}
          width={84}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {POOLED_LABEL}: <span className="font-mono text-foreground">{figureText(t.pooled)}</span>
        {t.pooled?.state === "estimate" ? ` · CV ${pct(t.pooled.cvPct, 1)} (upper bound)` : ""}
        {t.pooled?.state === "withheld"
          ? ` · ${int(t.pooled.cases)} sample cases (unweighted)`
          : ""}
      </p>
    </li>
  );
}
