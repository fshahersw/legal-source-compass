import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Download, MessageCircle, RotateCcw, LoaderCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationDictation } from "./ConversationDictation";
import { ConversationReadAloud } from "./ConversationReadAloud";
import {
  extractConversationFacts,
  getConversationCapability,
} from "@/lib/limitations/conversation.functions";
import {
  assessConversationFacts,
  type ConversationServerResult,
} from "@/lib/limitations/conversationAssessment.functions";
import { planConversationAssessment } from "@/lib/limitations/conversationAssessment";
import {
  applyConversationCandidates,
  conversationBinding,
  conversationFactLabel,
  conversationInput,
  conversationScreens,
  createConversationSession,
  isPlainConfirmation,
  isPlainScenarioRequest,
  CONVERSATION_LABELS,
  type ConversationSession,
} from "@/lib/limitations/conversationState";
import {
  nextConversationPrompt,
  promptContent,
  conversationEvidenceDigest,
  type ConversationPrompt,
} from "@/lib/limitations/conversationWorkflow";
import {
  CONVERSATION_MAX_CHARACTERS,
  CONVERSATION_MAX_MESSAGE_LENGTH,
  CONVERSATION_MAX_MESSAGES,
  type ConversationFactField,
} from "@/lib/limitations/conversationExtraction";
import type { ClaimType, LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { projectConversationTranscript } from "@/lib/limitations/conversationTranscript";

const panel = "min-w-0 rounded-md border border-border bg-surface";
const INTRO =
  "Tell me what happened, where it happened, and any dates you remember. I’ll ask for the other details that matter, check the recorded rules, and explain what can be calculated and what remains unresolved. You can correct me or say ‘I don’t know’ at any point. Please omit names and other identifying details.";

type Props = {
  snapshot: LimitationsSnapshot;
  state: string;
  claim?: ClaimType | undefined;
  mode?: "statutory" | "reviewed";
  active?: boolean;
  sourceRefreshFailed?: boolean;
  onRefreshSources?: (() => void) | undefined;
  renderAuthority: (rule: LimitationRule) => ReactNode;
  onOpenSources?: ((state: string, claim?: ClaimType) => void) | undefined;
};

function initialSession(state: string, claim?: ClaimType): ConversationSession {
  return {
    ...createConversationSession(state, claim),
    messages: [{ id: "intro", role: "assistant", content: INTRO }],
  };
}

export function ConversationCalculator({
  snapshot,
  state,
  claim,
  mode = "statutory",
  active = true,
  sourceRefreshFailed = false,
  onRefreshSources,
  renderAuthority,
  onOpenSources,
}: Props) {
  const [session, setSession] = useState(() => initialSession(state, claim));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<ConversationPrompt | null>(null);
  const [resultRecord, setResultRecord] = useState<{
    binding: string;
    result: ConversationServerResult;
  } | null>(null);
  const [dictationEpoch, setDictationEpoch] = useState(0);
  const [assessmentBindings, setAssessmentBindings] = useState<Record<string, string>>({});
  const serial = useRef(0),
    requestSerial = useRef(0),
    endRef = useRef<HTMLDivElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null);
  const sourceFailedRef = useRef(sourceRefreshFailed);
  sourceFailedRef.current = sourceRefreshFailed;
  const capability = useQuery({
    queryKey: ["limitations-conversation-capability"],
    queryFn: () => getConversationCapability(),
    staleTime: 60_000,
  });
  const input = conversationInput(session.facts);
  const plan = useMemo(
    () =>
      planConversationAssessment(
        snapshot,
        conversationInput(session.facts),
        conversationScreens(session.facts),
        { sourceRefreshFailed },
      ),
    [snapshot, session.facts, sourceRefreshFailed],
  );
  const sourceKey = plan.contextKey ?? snapshot.ruleVersion;
  const [boundEvidence, setBoundEvidence] = useState({ revision: session.revision, sourceKey });
  if (boundEvidence.sourceKey !== sourceKey || boundEvidence.revision !== session.revision) {
    const sourceChanged =
      boundEvidence.revision === session.revision && boundEvidence.sourceKey !== sourceKey;
    setBoundEvidence({ revision: session.revision, sourceKey });
    if (sourceChanged) {
      requestSerial.current++;
      setSession((previous) => ({ ...previous, confirmedRevision: null, scenarioRevision: null }));
      setResultRecord(null);
      setQuestion(null);
      setBusy(false);
      setError(
        "The source evidence changed. Your facts are preserved; please continue to review them against the new release.",
      );
    }
  }
  const binding = conversationBinding(session, sourceKey);
  const visibleMessages = projectConversationTranscript(
    session.messages,
    assessmentBindings,
    binding,
    sourceRefreshFailed,
  );
  const playbackText =
    question?.text ??
    visibleMessages.filter((message) => message.role === "assistant").at(-1)?.content ??
    INTRO;
  const result =
    !sourceRefreshFailed && resultRecord?.binding === binding ? resultRecord.result : null;
  const scenario = result?.status === "assessed" ? result.scenario : null;
  useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [session.messages.length, busy, active]);
  useEffect(
    () => () => {
      requestSerial.current++;
    },
    [],
  );
  useEffect(() => {
    if (sourceRefreshFailed) {
      requestSerial.current++;
      setBusy(false);
      setResultRecord(null);
      setQuestion(null);
      setSession((previous) => ({ ...previous, confirmedRevision: null, scenarioRevision: null }));
    }
  }, [sourceRefreshFailed]);
  const nextId = () => `turn-${++serial.current}`;

  function reset() {
    requestSerial.current++;
    setDictationEpoch((value) => value + 1);
    setBusy(false);
    setError(null);
    setDraft("");
    setQuestion(null);
    setResultRecord(null);
    setSession(initialSession(state, claim));
    inputRef.current?.focus();
    setAssessmentBindings({});
  }
  async function assess(current: ConversationSession, ticket: number) {
    const currentPlan = planConversationAssessment(
      snapshot,
      conversationInput(current.facts),
      conversationScreens(current.facts),
    );
    const digest = await conversationEvidenceDigest(currentPlan.contextKey);
    const response = await assessConversationFacts({
      data: {
        facts: Object.values(current.facts).filter((fact) => !!fact),
        factsConfirmed:
          current.confirmedRevision === current.revision &&
          Object.keys(current.conflicts).length === 0,
        scenarioRequested: current.scenarioRevision === current.revision,
        expectedEvidenceDigest: digest,
      },
    });
    if (ticket !== requestSerial.current || sourceFailedRef.current) return;
    if (response.status !== "assessed") {
      setError(response.message);
      setResultRecord(null);
      return;
    }
    const assessedBinding = conversationBinding(
      current,
      currentPlan.contextKey ?? snapshot.ruleVersion,
    );
    setResultRecord({ binding: assessedBinding, result: response });
    const answer =
      response.scenario.status === "conditional_illustration"
        ? `Under the stated assumptions, the unadjusted calendar illustration is ${response.scenario.date}. This is not a verified filing deadline. See the calculation, source evidence, calendar treatment and unresolved legal conditions below. You can correct any fact and I will reassess.`
        : `I cannot give a reliable date from these facts and the recorded rules. ${response.scenario.reasons.slice(0, 4).join(" ")} The complete list and cited material are below. You can add information or correct any fact.`;
    const answerId = nextId();
    setAssessmentBindings((previous) => ({ ...previous, [answerId]: assessedBinding }));
    setSession({
      ...current,
      messages: [...current.messages, { id: answerId, role: "assistant", content: answer }],
    });
    setQuestion(null);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy || sourceRefreshFailed || !active) return;
    if (
      session.messages.length + 3 > CONVERSATION_MAX_MESSAGES ||
      session.messages.reduce((total, message) => total + message.content.length, text.length) >
        CONVERSATION_MAX_CHARACTERS - 4_000
    ) {
      setError(
        "This conversation has reached its size limit. Download your review, then start a new conversation. Nothing has been silently discarded.",
      );
      return;
    }
    const ticket = ++requestSerial.current;
    const previousQuestion = question;
    let current = {
      ...session,
      confirmedRevision: null as number | null,
      scenarioRevision: null as number | null,
      messages: [...session.messages, { id: nextId(), role: "user" as const, content: text }],
    };
    setSession(current);
    setDraft("");
    setBusy(true);
    setError(null);
    setResultRecord(null);
    try {
      if (/^(?:review unresolved facts|show review|review what we have)[.!]*$/i.test(text)) {
        setQuestion(null);
        await assess(current, ticket);
        return;
      } else if (
        previousQuestion?.kind === "scenario" &&
        /^(?:no|not now)(?:[,.]?\s+(?:thanks|thank you))?[.!\s]*$/i.test(text)
      ) {
        setQuestion(null);
        setSession({
          ...current,
          confirmedRevision: session.confirmedRevision,
          scenarioRevision: null,
          messages: [
            ...current.messages,
            {
              id: nextId(),
              role: "assistant",
              content:
                "Understood. I will not request a calculation. Your recorded facts are retained. You can correct facts, review the sources or download this account.",
            },
          ],
        });
        return;
      } else if (previousQuestion?.kind === "confirm_facts" && isPlainConfirmation(text)) {
        current = { ...current, confirmedRevision: current.revision, scenarioRevision: null };
      } else if (
        previousQuestion?.kind === "scenario" &&
        isPlainScenarioRequest(text) &&
        session.confirmedRevision === session.revision
      ) {
        current = {
          ...current,
          confirmedRevision: current.revision,
          scenarioRevision: current.revision,
        };
        setSession(current);
        await assess(current, ticket);
        return;
      } else if (
        previousQuestion?.kind === "scenario" &&
        isPlainConfirmation(text) &&
        !isPlainScenarioRequest(text)
      ) {
        // The facts remain confirmed, but a factual acknowledgment does not request a date.
        current = {
          ...current,
          confirmedRevision: session.confirmedRevision,
          scenarioRevision: null,
        };
      } else {
        // A new narrative always withdraws prior confirmation until it has been interpreted and reviewed.
        current = { ...current, confirmedRevision: null, scenarioRevision: null };
        const extraction = await extractConversationFacts({
          data: {
            ...(input.jurisdiction && input.claimType
              ? {
                  selection: {
                    jurisdiction: input.jurisdiction,
                    claimType: input.claimType,
                    ...(session.facts.subtype?.certainty === "stated" && session.facts.subtype.value
                      ? { subtype: session.facts.subtype.value }
                      : {}),
                  },
                }
              : {}),
            messages: projectConversationTranscript(
              current.messages,
              assessmentBindings,
              conversationBinding(current, sourceKey),
              sourceRefreshFailed,
            ),
            ...(previousQuestion
              ? {
                  latestQuestion: {
                    id: previousQuestion.id,
                    kind: previousQuestion.kind,
                    text: previousQuestion.text.slice(0, 2_000),
                    ...(previousQuestion.field ? { field: previousQuestion.field } : {}),
                  },
                }
              : {}),
          },
        });
        if (ticket !== requestSerial.current || sourceFailedRef.current) return;
        if (extraction.status !== "extracted") {
          setError(extraction.message);
          setSession(current);
          setDraft(text);
          return;
        }
        current = applyConversationCandidates(
          current,
          extraction.candidates,
          previousQuestion ?? undefined,
        );
        if (!extraction.candidates.length) {
          const help =
            previousQuestion?.explanation ??
            "Describe one claim, the state or states involved, and dated events. You do not need to know the legal name of the claim.";
          current = {
            ...current,
            messages: [
              ...current.messages,
              {
                id: nextId(),
                role: "assistant",
                content: `I have not added a definite fact from that reply. ${help}${extraction.clarifications.length ? ` ${extraction.clarifications.join(" ")}` : ""}`,
              },
            ],
          };
        }
      }
      if (ticket !== requestSerial.current || sourceFailedRef.current) return;
      const next = nextConversationPrompt(snapshot, current);
      setQuestion(next);
      setSession({
        ...current,
        messages: [
          ...current.messages,
          {
            id: nextId(),
            role: "assistant",
            content: promptContent(next).slice(0, CONVERSATION_MAX_MESSAGE_LENGTH),
          },
        ],
      });
    } catch {
      if (ticket === requestSerial.current) {
        setError(
          "The conversation service could not complete this reply. Your facts are retained and no new result was issued. Please retry.",
        );
        setDraft(text);
      }
    } finally {
      if (ticket === requestSerial.current) {
        setBusy(false);
        inputRef.current?.focus();
      }
    }
  }

  function downloadReview() {
    // Export the live binding, not a result cached before a correction or failed source refresh.
    const data = {
      schemaVersion: "limitations-conversation/1",
      exportedAt: new Date().toISOString(),
      mode,
      release: snapshot.ruleVersion,
      snapshotDate: snapshot.snapshotDate,
      conversation: { ...session, messages: visibleMessages },
      result,
      recordedQualifications: plan.qualifications,
      sourceReferences: plan.sourceReferences,
      sourceRefreshFailed,
      verifiedFilingDeadline: false,
      comprehensiveLawReview: false,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "limitations-conversation-review.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const factEntries = Object.entries(session.facts).filter(([, fact]) => !!fact);
  const primaryFacts = factEntries.filter(([field]) => !field.startsWith("screen:"));
  const screeningFacts = factEntries.filter(([field]) => field.startsWith("screen:"));
  const renderFacts = (entries: typeof factEntries) => (
    <dl className="mt-3 space-y-2">
      {entries.map(([key, fact]) => {
        if (!fact) return null;
        const field = key as ConversationFactField;
        return (
          <div key={key} className="border-b border-border pb-2 last:border-0 last:pb-0">
            <dt className="text-xs text-muted-foreground">{CONVERSATION_LABELS[field]}</dt>
            <dd className="mt-1 break-words text-sm font-medium">
              {conversationFactLabel(field, fact.value)}
              {fact.certainty !== "stated" && (
                <span className="ml-2 text-xs font-normal text-warning">{fact.certainty}</span>
              )}
            </dd>
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">From your account</summary>
              <p className="mt-1 break-words leading-5">{fact.evidence.quote}</p>
              {fact.evidence.reference && (
                <p className="mt-1 break-words leading-5">
                  Refers to your earlier statement: {fact.evidence.reference.quote}
                </p>
              )}
            </details>
          </div>
        );
      })}
    </dl>
  );

  return (
    <section aria-label="Conversational limitations calculator" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <MessageCircle size={15} /> Talk through your timeline
          </p>
          <h2 className="font-sans text-lg font-semibold">Start with what happened.</h2>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            Answer in your own words. I’ll keep the timeline, ask the follow-ups, and connect the
            analysis to the recorded sources.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-10 sm:min-h-8"
            size="sm"
            variant="outline"
            onClick={downloadReview}
          >
            <Download size={14} /> Download review
          </Button>
          <Button className="min-h-10 sm:min-h-8" size="sm" variant="ghost" onClick={reset}>
            <RotateCcw size={14} /> Start over
          </Button>
        </div>
      </div>
      {sourceRefreshFailed && (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          The source release could not be refreshed. Your conversation is preserved; calculations
          and result exports are withheld.
          <Button variant="link" onClick={onRefreshSources}>
            Retry sources
          </Button>
        </div>
      )}
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]">
        <div className={`${panel} overflow-hidden`}>
          <div className="border-b border-border px-3 py-2 text-xs leading-5 text-muted-foreground">
            One claim at a time · Dates and answers remain editable · Source release{" "}
            {snapshot.ruleVersion}
          </div>
          <div
            role="log"
            aria-label="Limitations conversation"
            aria-live="polite"
            aria-relevant="additions text"
            className="max-h-[30rem] min-h-48 space-y-3 overflow-y-auto p-3"
          >
            {visibleMessages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-3 border-l-2 border-primary/30 bg-primary/5 px-3 py-2"
                    : "py-1"
                }
              >
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  {message.role === "user" ? "You" : "Time limits assistant"}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-[1.5]">
                  {message.content}
                </p>
              </div>
            ))}
            {busy && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="animate-spin" size={15} /> Checking your reply…
              </p>
            )}
            <div ref={endRef} />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="border-t border-border bg-background/60 p-3"
          >
            <label
              htmlFor={`conversation-reply-${mode}`}
              className="mb-1.5 block text-sm font-medium"
            >
              Your reply
            </label>
            <textarea
              ref={inputRef}
              id={`conversation-reply-${mode}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={CONVERSATION_MAX_MESSAGE_LENGTH}
              rows={3}
              placeholder="Describe what happened, answer the question, or correct a detail…"
              disabled={busy || sourceRefreshFailed}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  void send();
                }
              }}
              className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <div className="mt-2 grid items-start gap-3 sm:grid-cols-2">
              <ConversationDictation
                key={`dictation-${dictationEpoch}`}
                disabled={busy || !active || sourceRefreshFailed}
                onTranscript={(text) =>
                  setDraft((previous) => {
                    const joined = `${previous}${previous ? " " : ""}${text}`;
                    if (joined.length > CONVERSATION_MAX_MESSAGE_LENGTH) {
                      setError(
                        "That dictated segment exceeds the reply limit. It was not added; please shorten the draft and dictate the complete segment again.",
                      );
                      return previous;
                    }
                    return joined;
                  })
                }
              />
              <ConversationReadAloud
                key={`playback-${dictationEpoch}`}
                text={playbackText}
                disabled={busy || !active || sourceRefreshFailed}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
              <p className="min-w-0 flex-1 basis-64 text-xs leading-5 text-muted-foreground">
                {capability.data?.configured
                  ? // the interface names no AI vendor (owner rule); the configured provider is still disclosed as a third party
                    "Your text conversation is sent to an external AI language-model service to extract facts. This app keeps the draft in this tab’s memory; the provider’s processing and retention policies apply. Refreshing or leaving loses this draft unless you download it."
                  : capability.isPending
                    ? "Checking conversation availability…"
                    : "Natural-language interpretation is not configured or is unavailable. The structured calculator remains available below."}
              </p>
              <Button
                className="min-h-11 sm:min-h-9"
                type="submit"
                disabled={
                  busy ||
                  !draft.trim() ||
                  sourceRefreshFailed ||
                  capability.data?.configured === false
                }
              >
                <ArrowUp size={16} /> Send reply
              </Button>
            </div>
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
              >
                {error}
              </p>
            )}
          </form>
        </div>
        <aside className="min-w-0 space-y-3" aria-label="Facts and source review">
          <section className={`${panel} p-3`}>
            <h3 className="font-sans text-base font-semibold">What I understand</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              These are reported facts and proposed scenarios. Correct any item in the conversation.
            </p>
            {primaryFacts.length ? (
              renderFacts(primaryFacts)
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                State, claim and timeline facts will appear here as we talk.
              </p>
            )}
            {screeningFacts.length > 0 && (
              <details className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Screening answers ({screeningFacts.length})
                </summary>
                {renderFacts(screeningFacts)}
              </details>
            )}
            {Object.entries(session.conflicts).map(([key, values]) => (
              <p key={key} className="mt-3 rounded-md border border-warning/40 p-3 text-sm">
                Conflicting {CONVERSATION_LABELS[key as ConversationFactField].toLowerCase()}:{" "}
                {values!
                  .map((value) => conversationFactLabel(key as ConversationFactField, value.value))
                  .join(" / ")}
                . Clarification needed.
              </p>
            ))}
          </section>
          <section className={`${panel} p-3`}>
            <h3 className="flex items-center gap-2 font-sans text-base font-semibold">
              <BookOpen size={16} /> Rules and evidence
            </h3>
            <p className="mt-2 text-sm leading-5">
              {plan.rule
                ? plan.rule.summary
                : "A unique supported claim branch has not yet been established."}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {plan.screens.filter((screen) => screen.answer !== null).length} of{" "}
              {plan.screens.length} factual screens answered.{" "}
              {plan.qualifications.filter((factor) => factor.kind !== "screen").length} recorded
              legal qualifications to assess. Answered does not mean legally resolved.
            </p>
            {plan.rule && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  Read the selected rule and authorities
                </summary>
                {renderAuthority(plan.rule)}
              </details>
            )}
            {onOpenSources && (
              <Button
                className="mt-3 min-h-10 sm:min-h-8"
                variant="outline"
                size="sm"
                onClick={() => onOpenSources(input.jurisdiction, input.claimType || undefined)}
              >
                Browse sources
              </Button>
            )}
          </section>
        </aside>
      </div>
      {scenario && (
        <section aria-label="Conversation assessment" className={`${panel} p-3 sm:p-4`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {scenario.status === "conditional_illustration"
              ? "Conditional calendar illustration"
              : "Further information or legal review required"}
          </p>
          <h3 className="mt-1 font-sans text-lg font-semibold">
            {scenario.date ?? "No reliable date can be issued"}
          </h3>
          <p className="mt-2 text-sm leading-5">{scenario.reasons[0]}</p>
          {scenario.calendar?.adjustedDate && (
            <p className="mt-2 text-sm">
              Recorded weekend adjustment: {scenario.calendar.adjustedDate.date} (
              {scenario.calendar.adjustedDate.citation}). Holidays remain uncomputed.
            </p>
          )}
          {scenario.calendar?.weekendNotice && (
            <p className="mt-2 text-sm">
              The anniversary falls on a weekend; no verified adjustment has been established for
              this scenario.
            </p>
          )}
          {scenario.steps.length > 0 && (
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
              {scenario.steps.map((step, index) => (
                <li key={index}>
                  {step.text} <span className="text-muted-foreground">{step.pinpoint}</span>
                </li>
              ))}
            </ol>
          )}
          <details className="mt-3" open={scenario.status === "withheld"}>
            <summary className="cursor-pointer text-sm font-medium">
              {scenario.status === "withheld"
                ? "What prevents a date"
                : "Assumptions behind this illustration"}
            </summary>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-5">
              {(scenario.status === "withheld" ? scenario.reasons : scenario.assumptions).map(
                (reason, index) => (
                  <li key={index}>{reason}</li>
                ),
              )}
            </ul>
          </details>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">
              All recorded conditions, exclusions and review limits (
              {scenario.qualifications.length})
            </summary>
            <ul className="mt-2 divide-y divide-border text-sm leading-5">
              {scenario.qualifications.map((factor) => (
                <li key={factor.id} className="py-2 first:pt-0 last:pb-0">
                  <strong>{factor.label}</strong>
                  <p>{factor.text}</p>
                  {factor.citation && <p className="text-muted-foreground">{factor.citation}</p>}
                  <span className="text-xs text-muted-foreground">
                    Legal effect remains unresolved.
                  </span>
                </li>
              ))}
            </ul>
          </details>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Current-law completeness, choice of law, legal accrual, court calendars, commencement,
            service and filing cutoffs are not certified by this conversation.
          </p>
        </section>
      )}
    </section>
  );
}
