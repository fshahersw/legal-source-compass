# UI kit and page recipe (2026-10-24)

The page kit lives in `src/components/kit` (import from `@/components/kit` or the single file). Tokens and the type
scale live in `src/styles.css`; the shadcn primitives in `src/components/ui` keep their APIs and use the tokens.
`/prototypes/kit` shows every part on live data, in a light and a dark panel, with loading, empty, error and partial
states, and the header strip with a dropdown open.

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
5. **One header, one menu.** Every page has one `HeaderStrip`: breadcrumb, title, search, Ask AI and the section menu
   in a single band. The menu has at most 4 items (direct links or dropdown panels); a page has no tab row of its own.
   A long page gets a `SectionIndex`, not tabs. A tab stays only for a genuinely different mode of the same page: at
   most 4, never tabs inside tabs.
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
  <SectionIndex items={[{ id: "headlines", label: "Headlines" }, { id: "districts", label: "Districts" }]} />
  <div className="stack-block">
    <Section id="headlines" title="Headlines" description="…">
      <KpiGrid columns={4}>{/* KpiCard as="li" … */}</KpiGrid>
    </Section>
    <Section id="districts" title="Districts">
      <ChartCard title="…takeaway…" subtitle="…" data={{ … }} source={{ … }}>{/* chart */}</ChartCard>
    </Section>
  </div>
</AppShell>
```

The shell renders the `HeaderStrip` (see below) from the page's own props; `sectionTabs={false}` leaves the section
menu out of the strip for a one-page section (the routes behind it stay reachable from the page). `SectionIndex` sits
flush under the strip (`--page-pad-top` on `.atlas-main`), so pages never pass a negative margin. Space sections with
`stack-section` (32 px) inside a block and `stack-block` (48 px) between blocks.

## Components

| Component                                                          | Props (main)                                                                                                                                                                                       | Use                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                       | `title, description?, breadcrumbs?, actions?, emblem?, tabs?, tabsClassName?, meta?, titleAs?`                                                                                                     | Identity header inside a page body (the shell renders one per page from its own props).                                                                                                                                                                                                                                                |
| `HeaderStrip`                                                      | `title, titleAs?, description?, breadcrumbs, menu? (from sectionMenu), menuLabel?, menuTitle?, compact?, actions?, emblem?, leading?, search?, askAi?, trailing?, defaultOpenMenu?`                | The page's one header: a 56 px bar (sidebar toggles, breadcrumb, search, Ask AI, theme) over the title row (H1, one line of context, one primary action) and the section menu. The app shell renders it for every page.                                                                                                                |
| `HeaderMenu`                                                       | `items: MenuItem[], label? = "Section", title?, compact?, defaultOpen?`                                                                                                                            | The menu alone (up to 4 items). From 768 px a Radix navigation menu (direct links and dropdown panels); below it one button that opens a sheet with every destination.                                                                                                                                                                 |
| `PageTabs`                                                         | `items: {id,label,count?}[], value, onValueChange, label, idPrefix?, max? = 7`                                                                                                                     | Mode switch inside a page only (at most 4 by the rules); the shell no longer uses it for section navigation. Overflow above `max` goes to a More menu; active tab always visible. `pageTabClass(active)` styles link tabs.                                                                                                             |
| `SectionIndex`                                                     | `items: {id,label}[], label? = "On this page"`                                                                                                                                                     | Sticky in-page anchors with scroll-spy; `aria-current="location"`. Sections need ids (`Section id`).                                                                                                                                                                                                                                   |
| `Section`                                                          | `title, description?, actions?, id?, headingAs?`                                                                                                                                                   | Section header (20/28 title, 14/22 one-line description capped at 68ch) over content; `scroll-mt-16` for the sticky index.                                                                                                                                                                                                             |
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

## Header strip and navigation model

```text
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [≡] Courts & judges / Vacancies            [ Search the corpus… ]  (Ask AI)  (theme) │  tier 1, 56 px
│ Judicial vacancies                                                   [Export]        │
│ One line of context, at most 68 characters wide.                                      │  tier 2
│ Courts   Judges   Caseload ▾   Compare ▾                                              │  menu
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Source of truth** is `SECTIONS` in `src/lib/atlas/navigation.ts`. Each tab is
  `{ id, to, search?, label, description, group?, owns }`. `description` is plain language, at most 14 words (a test
  enforces it and that each is unique within the section). `group` names a `SECTION_GROUPS` entry
  (`"courts:caseload"`): tabs that belong together become one dropdown panel, placed where its first member sits in
  the tab order. Tabs without a group are direct links.
- `sectionMenu(pathname, search?)` returns the section's items for the current page: `{ kind: "link" | "group", key,
label, description, … }`. A link carries `current` (`"page"` on the exact page, `"true"` when the page sits inside
  it) and a group carries `active`. At most `MAX_MENU_ITEMS` (4) items; a test fails if a section needs more, so add a
  group instead of a fifth item. Every tab appears exactly once and every former URL still resolves
  (`routeMap.test.ts`).
- **Panels.** A dropdown panel is a short summary tile (the group title and one line, not a link) beside the
  destinations, each a title with a one-line description. The panel opens under its own trigger, left-aligned with it;
  when that would run past the window it slides left just enough to keep 16 px inside (measured when it opens and on
  resize), so a panel never covers the sidebar or leaves the screen.
- **Router links.** Menu links are TanStack `Link`s (client-side navigation) with `activeOptions.exact`, so the router
  never adds its own `aria-current="page"` to a parent route (/courts while on /courts/vacancies); `link.current` alone
  decides it.
- **Current page.** The item that holds the page has ink text, a semibold weight and a 2 px primary rule on the strip's
  bottom border (`data-active`), plus `aria-current`. Hover and an open panel use the accent wash; focus shows a ring.
- **Keyboard.** Arrow keys move between the top-level items; Enter or Space opens a panel (focus stays on the
  trigger), ArrowDown moves into it and Tab steps through its links; Escape closes it and returns focus to the
  trigger. Hover opens a panel too.
- **Phones (below 768 px).** The menu is one button labelled with the current page ("Section: Vacancies") that opens a
  bottom sheet, titled with the section's name (`menuTitle`), listing every destination under its group heading;
  choosing one closes the sheet. `compact` forces this layout at any width (the kit gallery's phone specimen). Search becomes an icon
  link to `/search`; Ask AI keeps its icon.
- **Primitive.** `src/components/ui/navigation-menu.tsx` is the shadcn NavigationMenu on
  `@radix-ui/react-navigation-menu` (`viewport={false}` lets each panel open under its trigger; `ChevronDown` turns when
  open; slide and fade motion). `navigationMenuTriggerStyle()` styles a plain link to match the triggers.
- **Ask AI.** `openAssistant()` (`src/components/assistant/askAssistant.ts`) opens the assistant panel from anywhere; the
  strip's button calls it, and the floating launcher stays as the second entry (Ctrl+J).

```tsx
<HeaderStrip
  title="Judicial vacancies"
  description="Open seats and nominations."
  breadcrumbs={crumbs}
  menu={sectionMenu(pathname, search)}
  leading={toggles}
  search={<SearchForm className="hidden w-56 md:flex lg:w-72" />}
  askAi={<AskAiButton />}
  trailing={<ThemeToggle />}
  actions={<Button size="sm">Export</Button>}
/>
```

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
- Type: `text-title` 28/34 semibold, tight tracking (page H1); `text-heading` 20/28 semibold (section heading);
  `text-label` 15/22 medium (card title); `text-body` 14/22 (body and descriptions); `text-meta` 12/16 (meta, source
  lines); `text-kpi` 32/36 and `text-kpi-sm` 28/32 semibold with `tabular-nums`. Prose is capped with `measure`
  (68ch). Monospace only for ids and citations.
- Rhythm: 32 px between sections (`stack-section`), 48 px between blocks (`stack-block`), 16 px inside cards; the page
  pads 32 px above (`--page-pad-top`) and 72 px below. Left edges line up: toggle, breadcrumb, title, menu text and
  first section heading share the page gutter.
- Radius: `rounded-md` 8 px (controls), `rounded-lg` 10 px, `rounded-xl` 12 px (cards). Shadows: `shadow-xs` on
  cards, `shadow-md` on popovers.
- Dark theme: the `.dark` class on `<html>` (top-bar toggle, remembered per browser; light is the default). A `.light`
  or `.dark` wrapper re-scopes the tokens for a subtree.

## Notes

- `cn()` (src/lib/utils.ts) knows the design system's font sizes (`text-title`, `text-heading`, `text-label`,
  `text-body`, `text-meta`, `text-kpi`, `text-kpi-sm`). Plain tailwind-merge files them with the text colours and silently drops
  them from `cn("text-meta text-muted-foreground")`; if you add a size, add it to `CUSTOM_TEXT_SIZES`.
- The floating assistant button is a 32 px round icon (40 px on a phone) with a tooltip, reachable last in tab
  order and with Ctrl+J. It sits 6 px from the right edge, so it covers the page gutter and a card's 16 px padding,
  never text inside a card; every card pads its text at least 16 px, and the page container pads its bottom by 72 px.
