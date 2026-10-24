# UI kit and page recipe (2026-10-24)

The page kit lives in `src/components/kit` (import from `@/components/kit` or the single file). Tokens and the type
scale live in `src/styles.css`; the shadcn primitives in `src/components/ui` keep their APIs and use the tokens.
`/prototypes/kit` shows every part on live data, in a light and a dark panel, with loading, empty, error and partial
states.

## Rules (owner feedback of 2026-10-24, binding)

1. **Answer first.** Identity header, 4-6 KPIs with a comparison, then 2-4 charts that each answer a question a
   litigator would ask, most useful first. At most one short paragraph of prose above the fold.
2. **Takeaway titles.** A chart title says what the chart shows in plain words ("District of Columbia is highest, at
   617.9 per 100,000 residents"); the subtitle names measure, unit, geography and period. Build the sentence from the
   data with a tested function (see `movementTakeaway`, `mapTakeaway`), never by hand.
3. **Source footer.** Every card that carries a number ends with one line: `Source · period · as of`, then the
   "About this data" popover. Method text, caveats, partial-period notes and links go in the popover; nothing is
   deleted.
4. **View data.** Lists, long tables and per-record values live in a `DataDrawer` (table, filter, source, CSV), or
   behind `ShowMore` ("Show all N"), never on the primary surface. A bare count with no comparison is either turned
   into a chart with context or moved to a drawer.
5. **Tabs.** One level of navigation per page: a long page gets a `SectionIndex`, not a tab row. A tab is kept only
   for a genuinely different mode of the same page: at most 4, never tabs inside tabs.
6. **Honest values.** `null` reads "Not recorded" (and is an empty CSV field), never 0. Delta pills are neutral unless
   the metric has an agreed good direction (`goodDirection`). Partial periods carry the "Partial" pill.
7. **Trend placement.** `trendPlacement="auto"` lets a card measure itself (container query at 22 rem): the sparkline
   beside the value when wide, on its own row below when narrow, so a tile never crowds at three or four per row.
   Pass `trend` as a function (`(slot) => <Sparkline width={slot === "below" ? 200 : 128} … />`) to size each slot.
8. **Tokens only.** No hard-coded colours; status colours only for status, always with icon and label; chart colours
   come from `src/components/charts/palette.ts` (`var(--chart-1…6)`).

## Page skeleton

```tsx
<AppShell title="Courts & judges" description="One line of context." breadcrumbs={[]} sectionTabs={false}
  actions={<InfoPopover label="About this page" showLabel>…</InfoPopover>}>
  <SectionIndex items={[{ id: "headlines", label: "Headlines" }, { id: "districts", label: "Districts" }]} className="-mt-4" />
  <div className="space-y-8">
    <Section id="headlines" title="Headlines" description="…">
      <KpiGrid columns={4}>{/* KpiCard as="li" … */}</KpiGrid>
    </Section>
    <Section id="districts" title="Districts">
      <ChartCard title="…takeaway…" subtitle="…" data={{ … }} source={{ … }}>{/* chart */}</ChartCard>
    </Section>
  </div>
</AppShell>
```

`sectionTabs={false}` hides the shell's section tab row for a one-page section (the routes behind the tabs stay
reachable from the page); navigation config is unchanged until the shell step of the page batches.

## Components

| Component                                                          | Props (main)                                                                                                                                                                                       | Use                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                       | `title, description?, breadcrumbs?, actions?, emblem?, tabs?, meta?, titleAs?`                                                                                                                     | Identity header inside a page body (the shell renders one per page from its own props).                                                                                                                                                                                                                                                |
| `PageTabs`                                                         | `items: {id,label,count?}[], value, onValueChange, label, idPrefix?, max? = 7`                                                                                                                     | Mode switch only (at most 4 by the rules). Overflow above `max` goes to a More menu; active tab always visible. `pageTabClass(active)` styles link tabs.                                                                                                                                                                               |
| `SectionIndex`                                                     | `items: {id,label}[], label? = "On this page"`                                                                                                                                                     | Sticky in-page anchors with scroll-spy; `aria-current="location"`. Sections need ids (`Section id`).                                                                                                                                                                                                                                   |
| `Section`                                                          | `title, description?, actions?, id?, headingAs?`                                                                                                                                                   | Light section header (16/24) over content; `scroll-mt-16` for the sticky index.                                                                                                                                                                                                                                                        |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                     | `Card as?, interactive?`; `CardHeader title, description?, actions?, icon?, titleAs?, id?`                                                                                                         | White card, hairline, 12 px radius, shadow-xs.                                                                                                                                                                                                                                                                                         |
| `SourceFooter`                                                     | `source? ({label,href?} \| list \| node), period?, asOf?, partial?, about?, aboutLabel?, aboutTitle?`                                                                                              | The footer: source, period and "as of" are items in a wrapping row (a short source shares the line; a long one, clamped at two lines with its full name in the title, takes the first line and the rest flows below). The Partial pill and About button stay pinned top-right. A custom source node (link, truncating span) wraps too. |
| `InfoPopover`                                                      | `label? = "About this data", title?, showLabel?, trigger?`                                                                                                                                         | Keyboard-reachable popover for method and caveat text.                                                                                                                                                                                                                                                                                 |
| `KpiCard`                                                          | `label, value, unit?, meta?, delta?, deltaNote?, partial?, trend? (node or (slot) => node), trendPlacement? ("side"\|"below"\|"auto"), action?, source?, state?, emptyText?, onRetry?, size?, as?` | One KPI. `value` null reads Not recorded. `trend` takes a `Sparkline` (at least 120 × 32).                                                                                                                                                                                                                                             |
| `KpiGrid`                                                          | `columns? (2-6), label?`                                                                                                                                                                           | A row of KPI cards (`KpiCard as="li"`). `columns` is the widest layout (xl); the count at each breakpoint follows the number of cards (`balancedColumns`) so the last row is never one card alone: 3 cards are 3-up from lg and stacked below, 4 are 2 × 2 until xl.                                                                   |
| `KpiStrip`                                                         | `items: (KpiCardProps & {key})[], label?, cellBasis?`                                                                                                                                              | One card with KPI cells divided by hairlines.                                                                                                                                                                                                                                                                                          |
| `DeltaPill`                                                        | `delta: {value, text?, kind?, detail?, goodDirection?}`                                                                                                                                            | Direction icon + printed change; neutral unless `goodDirection`.                                                                                                                                                                                                                                                                       |
| `ChartCard`                                                        | `title (takeaway), subtitle?, actions?, legend?, data? (DataDrawer props), source?, state?, height?, emptyText?, onRetry?, id?`                                                                    | The slot every chart sits in; "View data" opens the drawer.                                                                                                                                                                                                                                                                            |
| `BarList`                                                          | `items: {id,label,value,display,note?,to?,search?,hash?}[], ariaLabel, diverging?, highlight?`                                                                                                     | Ranked rows read as bars, full labels, value at the end; signed values grow from a centre line.                                                                                                                                                                                                                                        |
| `DataDrawer`                                                       | `title, description?, columns: {key,label,align?,value,render?}[], rows, rowKey, source?, filename?, mode? ("sheet"\|"inline"), trigger?, triggerLabel?, searchable?`                              | Table + filter + source + CSV (`toCsv`: RFC 4180, formula-safe, gaps empty).                                                                                                                                                                                                                                                           |
| `ShowMore`                                                         | `items, initial? = 3, noun?, render(shown)`                                                                                                                                                        | "Show all N …" for long lists and tile grids.                                                                                                                                                                                                                                                                                          |
| `ShowMoreText`                                                     | `lines? (2,3,4,6)`                                                                                                                                                                                 | Clamped prose with Show more only when cut.                                                                                                                                                                                                                                                                                            |
| `InsightCallout`                                                   | `eyebrow?, headline, figures: {label,value,detail?}[], children (explanation), footer?`                                                                                                            | Insight of the day: headline, 2-4 figures, collapsed explanation.                                                                                                                                                                                                                                                                      |
| `LinkTile`                                                         | `to, search?, params?, icon?, title, description?, count?`                                                                                                                                         | Compact card link (navigation).                                                                                                                                                                                                                                                                                                        |
| `ListRow`                                                          | `to? \| href?, icon? \| leading?, title, description?, meta?, trailing?`                                                                                                                           | One row in a card list (`<ul className="divide-y divide-border">`).                                                                                                                                                                                                                                                                    |
| `StatusPill`, `PartialPill`                                        | `tone (good\|warning\|serious\|critical\|info\|neutral), icon?`; `note?`                                                                                                                           | Soft status pills with icon + label.                                                                                                                                                                                                                                                                                                   |
| `EmptyState`                                                       | `title, description?, action?, icon?, tone? ("empty"\|"error"), compact?`                                                                                                                          | Empty and error surfaces.                                                                                                                                                                                                                                                                                                              |
| `KpiCardSkeleton`, `CardSkeleton`, `ListSkeleton`, `ChartSkeleton` | sizes                                                                                                                                                                                              | Loading placeholders sized like the content.                                                                                                                                                                                                                                                                                           |

Helpers (pure, tested): `deltaDirection`, `deltaTone`, `formatSigned`, `formatSignedPercent`, `formatCompact`,
`splitChangeText`, `splitTabs`/`MAX_TABS`, `toCsv`/`csvField`/`csvFileName`, `activeSection`, `barExtent`.

## Examples

```tsx
<KpiCard as="li" label="Federal civil cases filed" value="303,716" unit="cases" meta="United States, FY2025"
  delta={{ value: 1, text: "+4.4%", detail: "+12,700 vs FY2024" }}
  trend={<Sparkline series={s} keys={k} width={128} height={36} />}
  partial="FY2026 is a partial period and is not the latest value."
  source={{ source: { label: "Federal Judicial Center, Integrated Database", href }, about: <p>…</p> }} />

<ChartCard title={mapTakeaway(rows, fmt, unit)} subtitle="Federal civil filings per 100,000 residents, FY2025"
  data={{ title: "…, by state", rows, rowKey: (r) => r.id, searchable: true, columns: [
    { key: "state", label: "State", value: (r) => r.name },
    { key: "value", label: "Per 100,000", align: "right", value: (r) => r.value },
  ], source: { source: { label: "FJC Integrated Database", href } } }}>
  <BarList ariaLabel="States with the highest rate" items={top10} />
</ChartCard>

<ShowMore items={tiles} initial={3} noun="series" render={(shown) => <KpiGrid>{shown.map(…)}</KpiGrid>} />
```

## Tokens

- Surfaces: `bg-background` (canvas), `bg-card`/`bg-surface` (white), `bg-muted`, `bg-accent` (hover wash);
  `border-border`, `border-border-strong`; `text-foreground`, `text-muted-foreground`.
- One accent: `text-brand`/`bg-brand`/`bg-brand-soft` (chart slot-1 blue). Primary (buttons, active tab rule) is
  near-black.
- Status pairs: `bg-status-{good,warning,serious,critical,info,neutral}-soft`, `text-…-ink`, `ring-…-ring`.
- Type: `text-title` (24/32), `text-heading` (16/24), `text-label` (14/20 medium), `text-meta` (12/16), `text-kpi`
  (26/32) and `text-kpi-sm` (20/28) with `tabular-nums`. Monospace only for ids and citations.
- Radius: `rounded-md` 8 px (controls), `rounded-lg` 10 px, `rounded-xl` 12 px (cards). Shadows: `shadow-xs` on
  cards, `shadow-md` on popovers.
- Dark theme: the `.dark` class on `<html>` (top-bar toggle, remembered per browser; light is the default). A `.light`
  or `.dark` wrapper re-scopes the tokens for a subtree.

## Notes

- `cn()` (src/lib/utils.ts) knows the design system's font sizes (`text-title`, `text-heading`, `text-label`,
  `text-meta`, `text-kpi`, `text-kpi-sm`). Plain tailwind-merge files them with the text colours and silently drops
  them from `cn("text-meta text-muted-foreground")`; if you add a size, add it to `CUSTOM_TEXT_SIZES`.
- The floating assistant button is a 32 px round icon (40 px on a phone) with a tooltip, reachable last in tab
  order and with Ctrl+J. It sits 6 px from the right edge, so it covers the page gutter and a card's 16 px padding,
  never text inside a card; every card pads its text at least 16 px, and the page container pads its bottom by 72 px.

## AI

Two small components and one helper (`src/components/kit/ai`, exported from `@/components/kit`) put AI on a section
without leaving the figures the page shows. Owner decision of 2026-10-24 (night): important sections get a short
summary and an Ask AI entry that carries that section's figures, source and period; AI text is grounded in those
figures, labelled as AI-generated and never names a model or vendor.

| Part                          | Props                                                                                                  | Use                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildSectionContext(input)`  | `{ title, id?, scope?, period?, source?, figures, maxFigures? }` -> `SectionContext`                   | Turns what the page holds into the bounded context. Pure and deterministic; `figures` are `{ label, value, unit?, period?, note?, decimals? }`.                                                                                                    |
| `figuresFromRows(rows, spec)` | `{ label, value, unit?, period?, note?, decimals?, order? ("desc"), limit? (10) }`                     | Rows (a ranked chart) to figures: ranked, gaps last, ties by label, cut to `limit`.                                                                                                                                                                |
| `AiSummary`                   | `context: SectionContext \| null, title? ("What this shows"), actions?, className?`                    | A quiet strip: **Summarize** on demand, 3 or 4 bullets (about 90 words), cached. `context` null while the figures load (the strip waits, disabled, at the same height). `actions` takes the section's `AskAiButton`.                               |
| `AskAiButton`                 | `sectionId, context: SectionContext \| null, title?, questions? (2-3), size? ("sm" \| "md" \| "icon")` | Opens the assistant with this section attached as a removable "Context: <title>" chip (click the chip to see every figure sent) and the questions ready to click. Nothing is sent until the user asks. `icon` suits a chart card's `actions` slot. |

### What goes into a context

- **Title** names the section as the reader sees it ("Federal civil cases filed"), **period** and **scope**
  (geography, population) as the card's subtitle prints them, **source** as the footer prints it.
- **Figures**: the numbers the section shows, each with a label, a value, a unit and, when it differs from the section's, a
  period. Pass numbers and let the builder format them (`303716` -> `303,716`, exact digits, no "k" or "M"), or pass the
  text the page prints (`"+12,736 (+4.4%) vs FY2024"`). A missing value is `null` and reads "Not recorded", never `0`.
- **Units**: `unit: "cases"` goes after the number; `unit: "%"` attaches (`4.4%`); omit the unit when the text already
  carries it (`"$3.94 billion"`).
- **Size**: at most 24 figures by default (`maxFigures`, 40 at most) and never more than about 8 KB serialised; figures are
  cut from the end and the context records "N of M shown". Keep the figures that answer the section's question first
  (a ranked chart: the top 8 to 10 rows, not all 94). The order you give is the order sent.
- **Not in a context**: raw record dumps, prose paragraphs, method notes, names of people beyond what the section shows,
  anything the reader cannot see on the page. If a section has fewer than two recorded figures there is nothing to
  summarize and the strip says so.

### Grounding rules (enforced on the server, not only requested)

1. The summary prompt allows only the supplied figures: no added facts, laws, cases, causes or numbers; no legal advice;
   no calculation (sums, differences, percentages, rounding); at most 90 words; period and unit stay with each number.
2. A deterministic check follows: every number a sentence states must appear in the context (thousands commas, `%` and
   units are normalised; "303.7 thousand" is accepted for 303,716 only when correctly rounded). A sentence with any other
   number is dropped and the strip says "Some details omitted"; if nothing survives, nothing is shown.
3. Ask AI answers go through the assistant, which receives the section as a `<section_context>` block next to the page
   text; it is told to quote the section's figures with their period and unit and to use its tools for anything more.
4. The label under every summary is fixed: "AI-generated from the figures on this page; check the source." The copy button
   adds the section title, source and period to what it copies.
5. No model, vendor or provider name appears in UI text, docs, tests or comments. The server alone knows them.

### Where AI is not configured

The kit asks the server once whether AI is configured. If not, `AiSummary` reads "AI not configured" in its header row
(the full sentence is its tooltip) and `AskAiButton` stays focusable, says "AI is not configured on this server." in its
tooltip and in a toast on click; neither fails or hides, and the strip keeps its height. Rate limited, busy, timed out and error replies each have their own message and a **Try again** button.
`/prototypes/kit` shows every state (stub text, not model output) in light and dark.

### Examples

A KPI strip: the context comes from the tiles, the strip sits under the grid with Ask AI inside it.

```tsx
const context = kpiContext("Headline figures", tileStates); // null while any tile loads (src/components/insights/kpiContext.ts)
<KpiGrid>…</KpiGrid>
<AiSummary context={context} className="mt-3"
  actions={<AskAiButton sectionId="headlines" context={context}
    questions={["Which figure changed most?", "What should I check before relying on these?"]} />} />
```

A chart card: Ask AI as an icon in the card's `actions`; the summary under the chart (use `border-0 bg-muted/40 shadow-none` inside a card).

```tsx
const context = buildSectionContext({
  title: "Product liability filings by fiscal year", scope: "U.S. district courts", period: "FY2014–FY2025",
  source: "Judicial Business of the United States Courts, Table C-11",
  figures: years.map((y, i) => ({ label: "Product liability filings", value: totals[i], unit: "cases", period: `FY${y}` })),
});
<ChartCard title={takeaway} actions={<AskAiButton sectionId="court-nos" context={context} size="icon" />} …>
  <TrendColumns … />
  <AiSummary context={context} className="mt-3 border-0 bg-muted/40 shadow-none" />
</ChartCard>
```

A page header or entity page: one strip under the KPI row summarizing the page's headline figures, built from the same
values the KPI cards print (never from the DOM).

```tsx
const context = buildSectionContext({
  title: court.name,
  scope: "Federal district court",
  period: "FY2025",
  source: "Judicial Business of the United States Courts",
  figures: [
    { label: "Civil cases filed", value: stats.civilFiled, unit: "cases" },
    { label: "Median time to disposition", value: stats.medianMonths, unit: "months", decimals: 1 },
    { label: "Pending MDL cases", value: stats.mdlPending, unit: "cases" },
  ],
});
<AiSummary context={context} actions={<AskAiButton sectionId="overview" context={context} />} />;
```

Limits: a summary costs about 0.3 to 2.5k input tokens and under 150 output tokens; results are cached in the browser
for 6 hours (per tab) and on the server for 24 hours, keyed by a hash of the context, so a repeat costs nothing and new
figures never show an old summary; 30 summaries per client address per 10 minutes, 20 s timeout, at most 6 at once.
