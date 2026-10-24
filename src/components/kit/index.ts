/**
 * The page kit: the shared building blocks of the 2026-10-24 refresh (see /prototypes/kit for every part in light and
 * dark). Tokens and type scale live in src/styles.css; restyled primitives in src/components/ui.
 */
export { Card, CardHeader, CardBody, CardFooter, SourceFooter } from "./Card";
export { cardClass, pageTabClass, pillBase, tabId, TONE_CLASS } from "./styles";
export type { SourceRef, SourceFooterProps } from "./Card";
export { InfoPopover } from "./InfoPopover";
export { StatusPill, PartialPill } from "./StatusPill";
export type { StatusTone } from "./styles";
export { KpiCard, KpiGrid, KpiStrip, DeltaPill } from "./KpiCard";
export type { KpiCardProps, KpiDelta, TrendSlot } from "./KpiCard";
export { balancedColumns, kpiGridClass } from "./grid";
export { PageHeader, Breadcrumbs } from "./PageHeader";
export { HeaderStrip, HeaderMenu } from "./HeaderStrip";
export type { PageCrumb } from "./PageHeader";
export { PageTabs } from "./PageTabs";
export type { PageTabItem } from "./PageTabs";
export { Section } from "./Section";
export { LinkTile, ListRow } from "./LinkTile";
export { EmptyState } from "./EmptyState";
export { InsightCallout } from "./InsightCallout";
export type { InsightFigure } from "./InsightCallout";
export { KpiCardSkeleton, CardSkeleton, ListSkeleton, ChartSkeleton } from "./Skeletons";
export { ChartCard } from "./ChartCard";
export { BarList } from "./BarList";
export type { BarListItem } from "./BarList";
export { barExtent } from "./bars";
export { DataDrawer } from "./DataDrawer";
export type { DataColumn, DataDrawerProps } from "./DataDrawer";
export { SectionIndex } from "./SectionIndex";
export type { SectionIndexItem } from "./SectionIndex";
export { ShowMore, ShowMoreText } from "./ShowMore";
export { csvField, csvFileName, toCsv } from "./csv";
export type { CsvValue } from "./csv";
export { activeSection } from "./scrollspy";
export {
  deltaDirection,
  deltaTone,
  directionLabel,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  splitChangeText,
} from "./format";
export type { DeltaDirection, DeltaTone, GoodDirection, ChangeParts } from "./format";
export { MAX_TABS, splitTabs } from "./tabs";
