# Chart kit cookbook

How to draw a chart on this site: which form answers which question, the component for it, its props and one
example. Every primitive is on `/prototypes/charts` with published data and its loading, error, empty and partial
states. Card chrome (title, subtitle, View data drawer, source footer, About popover) belongs to the page kit
(`src/components/kit`, see `docs/ui-kit.md`); the chart layer renders inside it.

```ts
import {
  ChartCard,
  TrendLines,
  TrendColumns,
  RankBars,
  BulletBand,
  SmallMultiplesGrid,
  TimelineStrip,
  BlockCard,
  periodTable,
  benchmark,
  trendTakeaway,
  rankTakeaway,
  benchmarkTakeaway,
  shareTakeaway,
  medianOf,
  rankRows,
  foldTail,
  foldSeries,
  tickText,
  percentTick,
  seriesColor,
} from "@/components/charts/recharts";
```

## The standard (binding, from WORKER_RULES_UI and the dataviz method)

- **One question per chart.** The title is the answer in plain words, computed from the plotted values with the
  takeaway helpers (never typed in, never invented). When no sentence is reliable (fewer than two recorded values, a
  tie for first) the helpers return `null`: fall back to a neutral title that says what is counted.
- **Subtitle** = measure · unit · geography · source table · period. **Footer** = Source · as of, with the method,
  caveats and partial-period note in the About popover. **View data** opens every value (table + CSV) in the drawer,
  so no extra table block sits beside a chart.
- **Context, always:** over time, against a national or peer median (labelled reference line), ranked with the focus
  item highlighted, or small multiples on a shared axis. A chart that only repeats a KPI is dropped.
- **Marks:** 1.75 px lines (1.25 px for context), bars at most 24 px with a 4 px rounded data end, hairline grid at 55% opacity, muted 12 px ticks on
  nice steps (1, 2 or 5 × 10ⁿ; 4–6 ticks; compact 50K / 1.2M), legend above the plot for two or more series, direct
  end labels for up to four lines, the latest value on the last column, crosshair tooltip on lines, per-bar hover on
  bars, values leading in the tooltip. No dual axes, no pies over four parts, no 3D, no rainbow.
- **Honesty:** gaps stay gaps (`null` → "Not recorded", never 0); partial periods are dashed (lines) or hatched
  (columns), marked "partial" in the table and never used in a comparison; nothing estimated or interpolated.
- **Colour:** one accent for one series (`seriesColor(0)`); categorical slots 1–6 in fixed order following the entity,
  never its rank; at most three slots in all-pairs forms (scatter, maps, small multiples); a seventh series is folded
  into a grey "Other" (`OTHER_MARK`) or faceted; context series grey and dashed (`CONTEXT_MARK`); de-emphasised marks
  `MUTED_MARK`. Status colours only for status. Each slot is `light-dark(light, dark)` (palette.ts): selected dark
  steps validated on the dark surface, so charts follow the theme with no code.

## Question → form

| The reader asks                                               | Form                                                                                        | Component                                                                                         | Audit examples (AUDIT.md §5)                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is it rising or falling? Where is it now?                     | Line (or columns for counts per period), last value labelled, peak/latest in the title      | `TrendLines`, `TrendColumns`, `BlockCard`                                                         | Docket filed / terminated / pending (court §5.1-2); "Is this MDL still growing?" (§5.6-1); "Is the backlog shrinking?" (Courts landing 2); recall streams (Safety 1)                        |
| Is this one busier or slower than its peers?                  | Bullet: focus marker over the peer min–max band and median                                  | `BulletBand`                                                                                      | "Is this court busier or slower than its peers?" (§5.1-1): weighted filings per judgeship, months to disposition, share pending > 3 years against `national.distributions`                  |
| Where does it rank? Who leads?                                | Sorted horizontal bars, values at bar ends, focus highlighted, median line                  | `RankBars` (kit `BarList` for a short linked list without a benchmark)                            | MDLs assigned here (§5.1-4); MDL among peers (§5.6-2); filings per 100,000 by state with the state highlighted (§5.4-1); districts by filings (Courts 1); fastest-rising hazards (Safety 2) |
| What is it made of?                                           | One stacked column per period with at most 3–5 parts + grey Other, or ranked bars of shares | `TrendColumns stacked` with `foldSeries`, `RankBars`, `shareTakeaway`                             | Nature of suit on the docket (§5.1-3); enforcement by agency (§5.3-4); DOJ resolutions ≥ $10M (Enforcement 2)                                                                               |
| How do several entities compare over time?                    | Small multiples, one hue, shared axis, context line in each panel                           | `SmallMultiplesGrid`                                                                              | A state's 4 districts (§5.4-2); actions per agency per year (Enforcement 1); recall streams 2×2 (Safety 1)                                                                                  |
| Against a national or median value?                           | Reference line labelled inline                                                              | `references={benchmark("Median district", mid, fmt)}` on `TrendLines`, `TrendColumns`, `RankBars` | PL share against its series median (court analytics); national vs median district months (court analytics)                                                                                  |
| What happened over time, compactly (instead of a bare count)? | Timeline strip (thin columns, latest in the accent) or sparkline ≥ 120 × 32 with values     | `TimelineStrip`, SVG `Sparkline`                                                                  | KPI cards that only print a count; table-row trends (district ranking)                                                                                                                      |
| What happened, and when did the rule change?                  | Line or area with an event rule, a peak callout on a leader, a labelled partial period      | `AnnotatedTrend`                                                                                  | MDL pending actions with the JPML report-date change; product liability filings with a peak and decline (court analytics)                                                                   |
| What is it made of over time?                                 | Stacked area with the name inside each area; 100% area for shares                           | `StackedAreaTrend` (`mode="percent"`)                                                             | FDA recall entries by product type; enforcement by agency per year; recall streams                                                                                                          |
| Which side of zero is it on, and when did it flip?            | One signed series, two tones around a zero line, peak, low and last written                 | `DivergingAreaTrend`                                                                              | Civil cases filed minus terminated; net change in pending cases                                                                                                                             |
| What is the shape of the association, and how sure are we?    | Scatter, smooth line, 95% band, the farthest points named                                   | `ScatterBand`                                                                                     | Filings per judgeship against months to disposition; insights explorer pairs                                                                                                                |
| How did outcomes split for each subject?                      | One 100% bar per subject, legend grouped by kind of outcome, click to highlight             | `VerdictStack`                                                                                    | Terminated MDLs by remand or closure; enforcement outcomes by agency                                                                                                                        |
| How far apart are two values, entity by entity?               | Dumbbell on one zero-based scale, gap written at the right                                  | `DumbbellRange`                                                                                   | Filed against terminated per district; budget against actual                                                                                                                                |
| How do entities compare across several measures?              | Matrix with grouped rows, a highlighted column, the leader bold on a plate                  | `BenchMatrix`                                                                                     | Court, judge, MDL or company comparisons                                                                                                                                                    |
| One number that matters                                       | Not a chart: a KPI with its comparison                                                      | kit `KpiCard` / `KpiStrip`, or `kpis` on `ChartCard`                                              | Page KPI rows                                                                                                                                                                               |

## Components

### ChartCard (`src/components/charts/ChartCard.tsx`)

The chart layer's props on the kit's card chrome. Props: `title` (takeaway), `subtitle`, `kpis?` (chart-local key
figures: `{ label, value, detail?, delta?: { text, direction } }`; the change pill is neutral), `status?`
(`{kind: "loading" | "error" (message?, onRetry?) | "empty" (reason) | "ready"}`), `table?` (TableSpec → View data
drawer with CSV), `sources?` (`{label, url}[]`), `period?`, `asOf?`, `footer?` (a node in place of the sources),
`variant?` (`"default"` or `"editorial"`), `about?`, `aboutTitle?`, `partial?` (footer Partial pill + note), `notice?` (a data-quality note above the chart, e.g.
"one MDL docket is 42% of the pooled figure"), `footnotes?`, `actions?`, `id?`, `className?`, `minHeight?`.

```tsx
<ChartCard
  title={trendTakeaway("Product liability filings", totals, fmt) ?? "Product liability filings"}
  subtitle="Cases filed in U.S. district courts · Table C-11 · FY2014–FY2025"
  kpis={[
    {
      label: "Filings FY2025",
      value: "45,713",
      delta: { text: "18.2% vs FY2024", direction: "down" },
    },
  ]}
  table={periodTable(rows, "year", [{ key: "total", label: "Filings" }], fmt, {
    caption: "Product liability filings",
    xLabel: "Fiscal year",
  })}
  sources={[{ label: "Judicial Business of the United States Courts", url }]}
  about={<p>Large swings track MDL dockets.</p>}
>
  <TrendColumns
    rows={rows}
    xKey="year"
    series={[{ key: "total", label: "Filings" }]}
    format={fmt}
  />
</ChartCard>
```

`variant="editorial"` is the headline form for a chart that carries a page: a short accent rule above a bold 19 px
title and a quieter 13 px subtitle (measure, unit, geography, period only). It changes the heading, not the card: View
data, the source footer and the About popover stay the same. Use it for one lead chart per page.

`ChartFrame` (SVG kit) and the FDA `ChartCard` (`fda-analytics/FdaCharts.tsx`) render through it.

### TrendLines

Lines over periods. Props: `rows`, `xKey`, `series: {key, label, short?, color?, context?}[]`, `format` (full value
text), `tick?` (axis text, default compact), `xTick?`, `tooltipTitle?`, `tooltipFooter?`, `height?` (220), `zero?`
(true; false for levels such as population or months), `references?` (`benchmark(...)`), `markers?`
(`{x, label}` vertical lines, e.g. a reporting change), `partialKey?` (row flag → dashed tail), `endLabels?` (default
≤ 4 series), `legend?` (default ≥ 2 series), `dots?` (default ≤ 12 periods), `tickCount?`, `ariaLabel`.

```tsx
<TrendLines
  rows={rows}
  xKey="year"
  format={(v) => fmtNum(v, 1)}
  zero={false}
  series={[
    { key: "national", label: "National median", short: "National" },
    { key: "district", label: "Median district", context: true },
  ]}
  ariaLabel="Median months to disposition"
/>
```

Pick it for change over time with one to four series. More than four: `SmallMultiplesGrid`.

### TrendColumns

Columns over periods: one series, grouped or `stacked`. Props as TrendLines plus `stacked?`, `highlightX?` (one
period in the accent, the rest muted), `lastValue?` (default: one series), no end labels. Tooltip shows the stack
total when every part is recorded.

```tsx
<TrendColumns
  rows={rows}
  xKey="year"
  series={[{ key: "total", label: "Filings" }]}
  format={fmt}
  highlightX="FY2023"
  partialKey="__partial"
  ariaLabel="Filings by fiscal year"
/>
```

Pick it for counts per period (filings, recalls), and for part-to-whole over time with `foldSeries(rows, keys, 3)`
so no segment is a sliver.

### RankBars

Sorted horizontal bars, value at each bar end, focus item in the accent and the rest muted, benchmark lines labelled
at the top, the focus row kept when it ranks below `limit`, unrecorded items listed apart. Props: `items: {id,
label, value}[]`, `format`, `focusId?`, `references?`, `ascending?`, `limit?`, `rowHeight?` (26), `labelWidth?`,
`showRank?`, `note?(id)`, `onSelect?(id)`, `ariaLabel`.

```tsx
<RankBars
  items={districts}
  format={(v) => fmtNum(v, 1)}
  focusId="ilnd"
  limit={12}
  showRank
  references={benchmark("Median district", medianOf(districts.map((d) => d.value)), (v) =>
    fmtNum(v, 1),
  )}
  ariaLabel="Median months to disposition by district"
/>
```

Pick it for "where does this one sit" and "who leads". For a short list of links inside a card without a benchmark,
use the kit's `BarList`.

### BulletBand

One row per measure: the focus value as an accent marker over the peer min–max band with its median tick; value,
min, median and max written as text. Props: `rows: {id, label, value, min, median, max, format?, note?}[]`, `format`,
`focusLabel?`, `benchmarkLabel?` ("National"), `zero?`, `ariaLabel`.

```tsx
<BulletBand
  focusLabel="N.D. Illinois"
  benchmarkLabel="All districts"
  format={(v) => fmtNum(v)}
  rows={[
    {
      id: "perj",
      label: "Civil filings per judgeship",
      value: 733,
      min: 91,
      median: 340,
      max: 1453,
    },
  ]}
  ariaLabel="N.D. Illinois against all districts"
/>
```

Pick it for an entity page's "busier or slower than peers" against `national.distributions`.

### SmallMultiplesGrid

One compact line panel per entity, one hue, shared value axis (default) so panels compare by height, an optional
context series (median, national) dashed in every panel, latest value and change on each panel. Props: `rows`, `xKey`,
`panels: {key, label}[]`, `format`, `tick?`, `context?: {key, label}`, `focusKey?`, `shared?`, `zero?`,
`panelHeight?` (96), `columns?`, `changeText?`, `ariaLabel`.

Pick it instead of a busy multi-line chart (five or more series) and for "how do these compare over time".

### TimelineStrip

A thin column per period, earlier periods muted, the latest complete period in the accent, partial periods hatched,
missing periods as a stub (never a zero column); first and last period under the strip, the latest value beside it.
Props: `points: {label, value, partial?}[]`, `format`, `height?` (36), `what` (accessible summary).

Pick it to turn a bare count in a KPI card or list row into its history.

### BlockCard and blockChart

`<BlockCard id="cpsc-recalls" />` fetches one analytics trend block (`getAnalyticsBlock`; ids in
`src/lib/analytics/registry.ts`) and renders it complete: takeaway (stacks read by their totals; long series compared
over the last ten recorded periods), latest value and change as a KPI, partial periods, reporting-change markers,
notes in About, View data. Props: `id`, `subject?`, `form?` ("auto" | "line" | "bar"), `height?`, `className?`.
`blockChart(data, def)` is the pure adapter when a page needs the pieces.

### SVG kit (`src/components/charts/*.tsx`)

`LineTrend`, `BarTrend`, `RankedBars`, `SmallMultiples`, `Sparkline`, `Heatmap`, `Choropleth`, `SlopeChart`,
`ScatterCorrelation`, `DistributionStrip`, `SurvivalCurve`, `Sankey`, `Network`, `Lanes`, `Swimlanes`, `Icicle`,
`TreeExplorer`, inside `ChartFrame`. Same standard (nice 1/2/5 ticks, 12 px axis text, end labels with the last
value, RankedBars with rounded data ends and a muted-rest highlight, Sparkline at least 120 × 32 with an end dot and
optional `format` / `showStart` values). Use them where the insights metric layer already supplies `PeriodAxis` and
`ValueFormatter`; otherwise prefer the recharts components above.

## Editorial forms (`src/components/charts/editorial`)

Seven forms in the editorial style: thin lines, a recessive grid, direct labels instead of a legend, the peak, the
last value and the event written on the chart. They are exported from `@/components/charts/recharts` (and
`@/components/charts/editorial`), draw inside the kit `ChartCard` and follow the same rules as every other chart:
palette slots from `palette.ts` in light and dark, hover tooltip, keyboard arrows on the SVG forms, an `aria-label`
that states the values, reduced motion respected, a gap is "Not recorded" and never zero, a partial period is dashed or
hatched and never compared. Pass the card's `table` for View data. The SVG forms take the same inputs as `TrendLines`
(`series`, `axis`, `formatter`) so `blockSeries(data)` turns an analytics block into them.

| Component            | What it draws                                                                                                      | Props that matter                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AnnotatedTrend`     | Line or area per series, event rules with labels, peak/low/keyed callouts on leaders, end labels, partial period   | `form` ("line" \| "area"), `events` (`{key,label,kind?}`), `callouts` (`"peak"`, `"low"` or `{key,label}`), `smooth`, `zero`, `partialLabel`, `endLabels`, `highlight` |
| `StackedAreaTrend`   | Stack or 100% area with each name inside its area (a leader at the right edge when the layer is thin), total label | `mode` ("stack" \| "percent"), `smooth`, `otherIds` (grey Other), `showTotal`, `legend` (default past four series)                                                     |
| `DivergingAreaTrend` | One signed series filled in two tones at zero, peak, low and last written, one annotated period                    | `positiveLabel`, `negativeLabel`, `annotation` (`{key,label}`), `smooth`                                                                                               |
| `ScatterBand`        | Points, local-regression line, 95% band, the points farthest from the line named                                   | `points` (`{id,label,x,y}`), `span`, `degree`, `showBand`, `logX`, `logY`, `bandFloor`, `outliers`, `labelIds`, `selected`/`onSelect`                                  |
| `VerdictStack`       | A 100% bar per subject, whole percentages that sum to 100, legend grouped by kind of outcome (click to highlight)  | `subjects` (`{label,counts,n?}`), `taxonomy` (`{group,tags:[{key,label}]}[]`), `sortBy`, `labelWidth`                                                                  |
| `DumbbellRange`      | Two dots per row joined by a connector on one zero-based scale, both values and the gap at the right               | `rows` (`{id,label,a,b}`), `aLabel`, `bLabel`, `format`, `tickFormat`, `gapLabel`, `sort`, `maxValue`                                                                  |
| `BenchMatrix`        | Grouped rows with a vertical group label, a tinted hero column, the leading value bold on a plate                  | `columns` (`{id,label,sub?,hero?}`), `groups` (`{label,rows:[{label,note?,values,format?,lead?}]}`), `measureLabel`                                                    |

```tsx
<ChartCard
  variant="editorial"
  title="Actions pending in MDLs peaked at 464,724 in November 2023; 204,977 in October 2026"
  subtitle="Actions now pending in all pending MDLs · per JPML monthly report · July 2012 to October 2026"
  table={table}
  sources={[{ label: "JPML pending MDL reports", url }]}
>
  <AnnotatedTrend
    series={[pending]}
    axis={axis}
    formatter={count}
    form="line"
    events={[
      {
        key: "2024-01",
        label: "Reports dated the first business day, from Jan 2024",
        kind: "break",
      },
    ]}
    callouts={["peak"]}
    ariaLabel="Actions pending in MDLs per JPML monthly report, with the report-date change marked"
  />
</ChartCard>
```

```tsx
<VerdictStack
  ariaLabel="Outcome of terminated actions in the largest MDLs"
  taxonomy={[
    { group: "Closed", tags: [{ key: "closed", label: "Closed in the transferee court" }] },
    { group: "Returned", tags: [{ key: "remanded", label: "Remanded to the original courts" }] },
  ]}
  subjects={mdls.map((m) => ({ id: String(m.mdl), label: `MDL ${m.mdl}`, counts: { closed: m.closed, remanded: m.remanded } }))}
  sortBy="remanded"
/>
<DumbbellRange rows={districts} aLabel="Filed" bLabel="Terminated" format={fmtN} tickFormat={tickText} gapLabel="Net" />
<BenchMatrix
  ariaLabel="Four districts compared"
  columns={[{ id: "ndil", label: "N.D. Illinois", sub: "7th Circuit", hero: true }, { id: "dsc", label: "D. South Carolina" }]}
  groups={[{ label: "Speed", rows: [{ label: "Median months to disposition", values: [5.9, 7.8], lead: "lowest" }] }]}
/>
```

Rules for the editorial forms:

- **Direct labels, not a legend**, for up to four series; a legend only past four (`StackedAreaTrend` decides). A name
  that cannot fit inside its area goes to the right edge with a leader; a label that would sit on another is left out
  and the value stays in the tooltip.
- **Smoothing is display only.** `smooth` draws a monotone curve through the recorded values (it never overshoots, so
  a count never dips below zero); the table and tooltips show the recorded values. The scatter line is a local
  regression with a 95% confidence band for the mean line, not a prediction interval; it needs at least eight points
  with three distinct x values and otherwise draws the points alone and says so.
- **Narrow cards.** `DumbbellRange` shows both values and the gap in a container of 520 px or more; narrower, only the
  gap (when `gapLabel` is set) stays at the right and both values move to the tooltip and View data.
- **Titles are computed.** Write them from the data (peak, last, share, leader). `BenchMatrix` marks a leader only
  when a row has two recorded values, and a tie marks every tie.
- **Colour.** Text set on a slot uses `seriesOn(i)` (`var(--chart-on-N)`, white or near-black by WCAG contrast in the
  active theme); the neutral Other is `var(--chart-other)`; hatched fills mark partial periods. `VerdictStack` and
  `StackedAreaTrend` colour slots in order and fold a seventh and later part into Other: fold the tail first.
- **Pure parts are tested** (`editorial/*.test.ts`): curve and area paths, stacking, label spots, signed runs, callout
  placement and collision, log ticks, LOESS and its band, whole-percentage rounding, dumbbell scale and layout, leader
  selection.

## Custom recharts charts: the theme layer

When no component fits, build the chart from the prop factories so it still looks like the rest:

```tsx
<BarChart data={rows} margin={CHART_MARGIN} accessibilityLayer>
  <CartesianGrid {...gridProps} />
  <XAxis dataKey="year" {...xCategoryAxis()} />
  <YAxis {...yValueAxis(niceAxisFor(rows, ["filed"]), (v) => tickText(v))} />
  <Tooltip {...tooltipProps({ valueFormat: fmt, cursor: "bar" })} />
  <ReferenceLine y={median} {...referenceLineProps(`Median ${fmt(median)}`)} />
  <Bar dataKey="filed" name="Filed" {...barProps()} />
</BarChart>
```

`theme.ts`: `seriesColor`, `ACCENT`, `MUTED_MARK`, `CONTEXT_MARK`, `OTHER_MARK`, `TICK`, `CHART_MARGIN`, `gridProps`,
`gridPropsVertical`, `xCategoryAxis`, `yValueAxis`, `xValueAxis`, `yCategoryAxis`, `lineProps`, `barProps`,
`valueLabelProps`, `referenceLineProps` (inline label on a surface halo; `orientation: "vertical"` for x lines),
`tooltipProps`, `legendProps`, `endLabelMargin`, `benchmark`. `content.tsx`: `ThemedTooltip`, `SeriesLegend`,
`ThemedLegend`, `EndLabels` (via `<Customized component={<EndLabels format={fmt} />} />`), `PartialKey`. `axis.ts`
(pure): `niceAxis`, `niceAxisFor`, `plottedValues`, `tickText`, `percentTick`, `axisWidth`, `categoryAxisWidth`,
`fitText`, `tickIndices`, `bulletLayout`. `tables.ts`: `periodTable`.

## Takeaway helpers (`src/components/charts/takeaway.ts`, pure, tested)

| Helper                                                                                                                                      | Sentence                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trendTakeaway(subject, points, fmt)`                                                                                                       | "… reached a high of X in L" · "… fell to a low of X in L" · "… peaked at X in P; Y in L" · "… rose / fell N% from A to L, to Y" (last ten recorded periods) · "… changed little …" |
| `rankTakeaway(items, fmt, {verb, ascending, withRunnerUp})`                                                                                 | "D. South Carolina leads with 1,130.7; D. New Jersey next at 659.7"; ties named, never picked                                                                                       |
| `benchmarkTakeaway(label, value, bench, benchLabel, fmt, diff)`                                                                             | "N.D. Illinois, FY2025: 5.9 months, 2.0 months below the median district (7.9 months)"                                                                                              |
| `shareTakeaway(parts, {totalLabel})`                                                                                                        | "Drug accounts for 46% of 5,290 entries"                                                                                                                                            |
| `summarizeTrend`, `peakOf`, `lowOf`, `latestOf`, `firstOf`, `lastChange`, `changeBetween`, `medianOf`, `rankRows`, `foldTail`, `foldSeries` | the numbers behind the sentences                                                                                                                                                    |

Partial periods are never compared. The sentences use past-tense verbs so the subject's number never matters.

## Checks before a chart ships

`npx vitest run src/components/charts`; look at the chart at 1280 and 1024 px in light and dark (the theme toggle in
the top bar); hover a mark and use the arrow keys on the chart; open View data and About; check the empty and
partial states. If you change a colour, run the dataviz palette validator for both modes and record the result in
palette.ts.
