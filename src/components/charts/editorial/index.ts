/**
 * Editorial chart forms: stacked area with direct labels, annotated trend, diverging area, scatter with a smooth line
 * and ribbon, verdict stack, dumbbell range and bench matrix. See docs/chart-kit.md for when to pick each one.
 */
export { StackedAreaTrend } from "./StackedAreaTrend";
export type { StackedAreaTrendProps } from "./StackedAreaTrend";
export { AnnotatedTrend } from "./AnnotatedTrend";
export type { AnnotatedTrendProps, TrendCallout, TrendEvent } from "./AnnotatedTrend";
export { DivergingAreaTrend } from "./DivergingAreaTrend";
export type { DivergingAreaTrendProps } from "./DivergingAreaTrend";
export { ScatterBand } from "./ScatterBand";
export type { ScatterBandProps } from "./ScatterBand";
export { VerdictStack } from "./VerdictStack";
export type { VerdictStackProps } from "./VerdictStack";
export { DumbbellRange } from "./DumbbellRange";
export type { DumbbellRangeProps } from "./DumbbellRange";
export { BenchMatrix } from "./BenchMatrix";
export type { BenchMatrixProps } from "./BenchMatrix";
export { roundShares, sortByTag, tagPaints, verdictSegments } from "./verdict";
export type { VerdictGroup, VerdictSegment, VerdictSubject, VerdictTag } from "./verdict";
export { dumbbellLayout, dumbbellScale, sortDumbbell } from "./dumbbell";
export type { DumbbellLayout, DumbbellRow, DumbbellSort } from "./dumbbell";
export { defaultBenchFormat, leaderIndices } from "./bench";
export type { BenchColumn, BenchGroup, BenchRow } from "./bench";
export { MIN_SMOOTH_POINTS, loess, outlierIndices, t95 } from "./smooth";
export type { LoessResult, Smoothed } from "./smooth";
export {
  areaBetween,
  areaUnder,
  boundarySegments,
  edgeSpans,
  labelSpot,
  linePath,
  monotoneTangents,
  placeCallout,
  signedRuns,
  stackLayers,
  staggerLevels,
} from "./geometry";
