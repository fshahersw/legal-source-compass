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
7. **Tokens only.** No hard-coded colours; status colours only for status, always with icon and label; chart colours
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

| Component                                                          | Props (main)                                                                                                                                                          | Use                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                       | `title, description?, breadcrumbs?, actions?, emblem?, tabs?, meta?, titleAs?`                                                                                        | Identity header inside a page body (the shell renders one per page from its own props).                                                                  |
| `PageTabs`                                                         | `items: {id,label,count?}[], value, onValueChange, label, idPrefix?, max? = 7`                                                                                        | Mode switch only (at most 4 by the rules). Overflow above `max` goes to a More menu; active tab always visible. `pageTabClass(active)` styles link tabs. |
| `SectionIndex`                                                     | `items: {id,label}[], label? = "On this page"`                                                                                                                        | Sticky in-page anchors with scroll-spy; `aria-current="location"`. Sections need ids (`Section id`).                                                     |
| `Section`                                                          | `title, description?, actions?, id?, headingAs?`                                                                                                                      | Light section header (16/24) over content; `scroll-mt-16` for the sticky index.                                                                          |
| `Card`, `CardHeader`, `CardBody`, `CardFooter`                     | `Card as?, interactive?`; `CardHeader title, description?, actions?, icon?, titleAs?, id?`                                                                            | White card, hairline, 12 px radius, shadow-xs.                                                                                                           |
| `SourceFooter`                                                     | `source? ({label,href?} \| list \| node), period?, asOf?, partial?, about?, aboutLabel?, aboutTitle?`                                                                 | The one footer line plus the About popover.                                                                                                              |
| `InfoPopover`                                                      | `label? = "About this data", title?, showLabel?, trigger?`                                                                                                            | Keyboard-reachable popover for method and caveat text.                                                                                                   |
| `KpiCard`                                                          | `label, value, unit?, meta?, delta?, deltaNote?, partial?, trend?, trendPlacement? ("side"\|"below"), action?, source?, state?, emptyText?, onRetry?, size?, as?`     | One KPI. `value` null reads Not recorded. `trend` takes a `Sparkline` (at least 120 × 32).                                                               |
| `KpiGrid`                                                          | `columns? (2-6), label?`                                                                                                                                              | A row of KPI cards (`KpiCard as="li"`).                                                                                                                  |
| `KpiStrip`                                                         | `items: (KpiCardProps & {key})[], label?, cellBasis?`                                                                                                                 | One card with KPI cells divided by hairlines.                                                                                                            |
| `DeltaPill`                                                        | `delta: {value, text?, kind?, detail?, goodDirection?}`                                                                                                               | Direction icon + printed change; neutral unless `goodDirection`.                                                                                         |
| `ChartCard`                                                        | `title (takeaway), subtitle?, actions?, legend?, data? (DataDrawer props), source?, state?, height?, emptyText?, onRetry?, id?`                                       | The slot every chart sits in; "View data" opens the drawer.                                                                                              |
| `BarList`                                                          | `items: {id,label,value,display,note?,to?,search?,hash?}[], ariaLabel, diverging?, highlight?`                                                                        | Ranked rows read as bars, full labels, value at the end; signed values grow from a centre line.                                                          |
| `DataDrawer`                                                       | `title, description?, columns: {key,label,align?,value,render?}[], rows, rowKey, source?, filename?, mode? ("sheet"\|"inline"), trigger?, triggerLabel?, searchable?` | Table + filter + source + CSV (`toCsv`: RFC 4180, formula-safe, gaps empty).                                                                             |
| `ShowMore`                                                         | `items, initial? = 3, noun?, render(shown)`                                                                                                                           | "Show all N …" for long lists and tile grids.                                                                                                            |
| `ShowMoreText`                                                     | `lines? (2,3,4,6)`                                                                                                                                                    | Clamped prose with Show more only when cut.                                                                                                              |
| `InsightCallout`                                                   | `eyebrow?, headline, figures: {label,value,detail?}[], children (explanation), footer?`                                                                               | Insight of the day: headline, 2-4 figures, collapsed explanation.                                                                                        |
| `LinkTile`                                                         | `to, search?, params?, icon?, title, description?, count?`                                                                                                            | Compact card link (navigation).                                                                                                                          |
| `ListRow`                                                          | `to? \| href?, icon? \| leading?, title, description?, meta?, trailing?`                                                                                              | One row in a card list (`<ul className="divide-y divide-border">`).                                                                                      |
| `StatusPill`, `PartialPill`                                        | `tone (good\|warning\|serious\|critical\|info\|neutral), icon?`; `note?`                                                                                              | Soft status pills with icon + label.                                                                                                                     |
| `EmptyState`                                                       | `title, description?, action?, icon?, tone? ("empty"\|"error"), compact?`                                                                                             | Empty and error surfaces.                                                                                                                                |
| `KpiCardSkeleton`, `CardSkeleton`, `ListSkeleton`, `ChartSkeleton` | sizes                                                                                                                                                                 | Loading placeholders sized like the content.                                                                                                             |

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
