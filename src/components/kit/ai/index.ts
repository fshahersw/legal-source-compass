/**
 * The AI kit: section-scoped AI entries that stay grounded in the figures a page already shows.
 *
 *   const context = useMemo(() => buildSectionContext({ title, scope, period, source, figures }), [...]);
 *   <AiSummary context={context} />                         // "What this shows", on demand, cached
 *   <AskAiButton sectionId="civil-filings" context={context} />   // opens the assistant with this section attached
 *
 * See docs/ui-kit.md, section "AI", for what a context should hold and the grounding rules.
 */
export { AiSummary, AiSummaryView } from "./AiSummary";
export type { AiSummaryProps, AiSummaryViewProps, AiSummaryViewState } from "./AiSummary";
export { AskAiButton, AskAiButtonView } from "./AskAiButton";
export type { AskAiButtonProps } from "./AskAiButton";
export {
  AI_ASK_TIP,
  AI_LABEL,
  AI_NOT_CONFIGURED,
  AI_THIN,
  AI_UNCONFIGURED,
  AI_WAITING,
  askAiAvailability,
  copyText,
} from "./labels";
export type { AskAiAvailability } from "./labels";
export { buildSectionContext, figuresFromRows, formatFigureValue } from "./buildSectionContext";
export type { BuildSectionContextInput, FigureInput, RowFigures } from "./buildSectionContext";
export { SummaryCache, summaryCache } from "./summaryCache";
export { aiStatusQuery, useAiStatus } from "./useAiStatus";
export type { AiStatus } from "./useAiStatus";
export { toState, useAiSummary } from "./useAiSummary";
export type { SummaryState } from "./useAiSummary";
export { askAboutSection, DEFAULT_SECTION_QUESTIONS } from "@/components/assistant/askAssistant";
export {
  MAX_SECTION_CONTEXT_BYTES,
  NOT_RECORDED,
  type SectionContext,
  type SectionFigure,
} from "@/lib/assistant/sectionContext";
export { chartContext } from "./chartContext";
