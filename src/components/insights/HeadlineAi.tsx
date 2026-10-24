/**
 * AI entries for the Overview's headline strip. HeadlineTiles owns the reads (and defers them past the first paint);
 * these observe the same query cache without fetching, so the summary and the "Ask AI" button wait for the tiles and
 * never start a read of their own.
 */
import { useQueries } from "@tanstack/react-query";
import { analyticsBlockQuery } from "@/components/analytics/hub/blockQuery";
import { AiSummary } from "@/components/kit/ai/AiSummary";
import { AskAiButton } from "@/components/kit/ai/AskAiButton";
import { HEADLINE_BLOCKS, hubTileState } from "./hubTiles";
import { HEADLINE_QUESTIONS, kpiContext } from "./kpiContext";

const TITLE = "Headline figures";

function useHeadlineContext() {
  const qs = useQueries({
    queries: HEADLINE_BLOCKS.map((id) => ({ ...analyticsBlockQuery(id), enabled: false })),
  });
  return kpiContext(
    TITLE,
    HEADLINE_BLOCKS.map((id, i) => hubTileState(id, qs[i]!)),
  );
}

/** The Overview's AI strip: "What this shows" for the headline tiles, with Ask AI beside Summarize. */
export function HeadlineSummary({ className }: { className?: string }) {
  const context = useHeadlineContext();
  return (
    <AiSummary
      context={context}
      {...(className ? { className } : {})}
      actions={
        <AskAiButton
          sectionId="headlines"
          title={TITLE}
          context={context}
          questions={HEADLINE_QUESTIONS}
        />
      }
    />
  );
}
