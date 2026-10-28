/**
 * AskAiButton: a compact "Ask AI" entry for one section. A click opens the assistant with THAT section attached: its
 * title, scope, period, source and figures travel with the user's next question, shown in the panel as a removable
 * "Context: <title>" chip (open it to see every figure the model is given), with 2 or 3 questions ready to click.
 * Nothing is sent until the user asks.
 *
 *   <AskAiButton sectionId="civil-filings" context={context} questions={["Why did filings rise in FY2025?"]} />
 *
 * Where AI is not configured the button stays focusable, says so in its tooltip and, on click, in a toast: it never
 * fails silently. While `context` is null (the figures are loading) it waits, disabled, with its reason in the tooltip.
 */
import { MessageCircleQuestionMark, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { askAboutSection } from "@/components/assistant/askAssistant";
import type { SectionContext } from "@/lib/assistant/sectionContext";
import { cn } from "@/lib/utils";
import {
  AI_ASK_TIP,
  AI_NOT_CONFIGURED,
  AI_WAITING,
  askAiAvailability,
  type AskAiAvailability,
} from "./labels";
import { useAiStatus } from "./useAiStatus";

export type AskAiButtonProps = {
  /** Anchor id of the section on the page. */
  sectionId: string;
  /** Name shown in the chip and the button's accessible name (default: the context's title). */
  title?: string | undefined;
  /** From buildSectionContext. null while the section's figures are loading. */
  context: SectionContext | null;
  /** 2 or 3 questions offered ready to click (the first three are used); a general set when omitted. */
  questions?: readonly string[] | undefined;
  /** "sm" icon and label (default); "md" larger; "icon" icon only, for tight card headers. */
  size?: "sm" | "md" | "icon" | undefined;
  className?: string | undefined;
};

/** The button for a known availability; AskAiButton computes it. Exported for the gallery and tests. */
export function AskAiButtonView({
  availability,
  name,
  size = "sm",
  onAsk,
  className,
}: {
  availability: AskAiAvailability;
  name: string;
  size?: "sm" | "md" | "icon" | undefined;
  onAsk?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const tip =
    availability === "unconfigured"
      ? AI_NOT_CONFIGURED
      : availability === "waiting"
        ? AI_WAITING
        : AI_ASK_TIP;
  const disabled = availability !== "ready";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Ask AI about ${name}`}
            aria-disabled={disabled || undefined}
            data-slot="ask-ai"
            data-availability={availability}
            onClick={() => {
              if (availability === "unconfigured") toast.message(AI_NOT_CONFIGURED);
              else if (availability === "ready") onAsk?.();
            }}
            className={cn(
              buttonVariants({
                variant: size === "icon" ? "ghost" : "outline",
                size: size === "md" ? "default" : size === "icon" ? "icon" : "sm",
              }),
              // same height as the card header's other controls ("View data" is h-9 / md:h-7)
              size === "icon" && "size-9 md:size-7",
              disabled && "cursor-not-allowed opacity-60 hover:border-input hover:bg-surface",
              className,
            )}
          >
            {size === "icon" ? (
              <Sparkles aria-hidden className="text-primary" />
            ) : (
              <MessageCircleQuestionMark aria-hidden />
            )}
            {size === "icon" ? null : <span>Ask AI</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AskAiButton({
  sectionId,
  title,
  context,
  questions,
  size = "sm",
  className,
}: AskAiButtonProps) {
  const status = useAiStatus();
  const availability = askAiAvailability(context, status);
  const name = title ?? context?.title ?? "this section";
  return (
    <AskAiButtonView
      availability={availability}
      name={name}
      size={size}
      className={className}
      onAsk={() => {
        if (context) askAboutSection({ ...context, id: sectionId, title: name }, questions);
      }}
    />
  );
}
