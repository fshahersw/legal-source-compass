import { useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Search } from "lucide-react";
import {
  acknowledgeUnanswered,
  filterReviewFactors,
  nextReviewFactor,
  type ReviewFilter,
} from "@/lib/limitations/reviewNavigation";
import { Button } from "@/components/ui/button";
import {
  REVIEW_GROUP_LABELS,
  decisionResolved,
  reviewProgress,
  type ReviewDecision,
  type ReviewDecisions,
  type ReviewFactor,
  type ReviewGroup,
} from "@/lib/limitations/reviewInventory";
import {
  INSTRUCTION_LABELS,
  validateInstruction,
  type ReviewedInstruction,
} from "@/lib/limitations/reviewedArithmetic";

const control =
  "mt-1 block min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal";
const GROUPS: ReviewGroup[] = ["screening", "tolling", "scope", "authority"];
function emptyInstruction(
  factor: ReviewFactor,
  kind: ReviewedInstruction["kind"] = "pause",
): ReviewedInstruction {
  const base = {
    id: `instruction:${factor.id}`,
    authority: factor.citation ?? "",
    explanation: "",
    reviewer: "",
    legalEffectConfirmed: false,
    boundariesConfirmed: false,
    interactionsConfirmed: false,
  };
  if (kind === "defer_start")
    return { ...base, kind, resumeDate: "", presentAtAccrualConfirmed: false };
  if (kind === "minimum_after_event")
    return {
      ...base,
      kind,
      protectedFromDate: "",
      eventDate: "",
      amount: 0,
      unit: "calendar_days",
    };
  if (kind === "fixed_deadline") return { ...base, kind, date: "" };
  return { ...base, kind, startDate: "", resumeDate: "" };
}

function InstructionEditor({
  factor,
  value,
  onChange,
}: {
  factor: ReviewFactor;
  value: ReviewedInstruction;
  onChange: (next: ReviewedInstruction) => void;
}) {
  const change = (patch: Record<string, unknown>, confirmation = false) =>
    onChange({
      ...value,
      ...patch,
      ...(!confirmation
        ? { legalEffectConfirmed: false, boundariesConfirmed: false, interactionsConfirmed: false }
        : {}),
    } as ReviewedInstruction);
  const date = (key: string, label: string, help?: string) => {
    const current = (value as unknown as Record<string, unknown>)[key];
    return (
      <label className="block text-sm font-medium" key={key}>
        {label}
        <input
          className={control}
          type="date"
          min="1900-01-01"
          max="2199-12-31"
          value={typeof current === "string" ? current : ""}
          onChange={(e) => change({ [key]: e.target.value })}
        />
        {help && (
          <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
            {help}
          </span>
        )}
      </label>
    );
  };
  const errors = validateInstruction(value);
  return (
    <div
      className="mt-3 space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4"
      data-testid="instruction-editor"
    >
      <div>
        <p className="text-sm font-semibold">Case-specific legal instruction</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          This computes the effect you have reviewed. It does not infer that a statute applies or
          add a new verified rule to the corpus.
        </p>
      </div>
      <label className="block text-sm font-medium">
        Reviewed effect
        <select
          className={control}
          aria-label="Reviewed effect"
          value={value.kind}
          onChange={(e) =>
            onChange({
              ...emptyInstruction(factor, e.target.value as ReviewedInstruction["kind"]),
              authority: value.authority,
              reviewer: value.reviewer,
            })
          }
        >
          {Object.entries(INSTRUCTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {value.kind === "pause" && (
          <>
            {date(
              "startDate",
              "First excluded day",
              "The suspension begins on and includes this civil day.",
            )}
            {date(
              "resumeDate",
              "First day the clock runs again",
              "This day is not excluded. Leave blank only if the suspension remains ongoing.",
            )}
          </>
        )}
        {value.kind === "pause" && (
          <div className="space-y-3 sm:col-span-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
                checked={value.maximumExclusion !== undefined}
                onChange={(e) =>
                  change({
                    maximumExclusion: e.target.checked
                      ? { amount: 0, unit: "calendar_days" }
                      : undefined,
                  })
                }
              />
              <span>This authority limits the excluded interval</span>
            </label>
            {value.maximumExclusion && (
              <div className="grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Maximum period
                  <input
                    className={control}
                    type="number"
                    min="1"
                    step="1"
                    max="36500"
                    value={value.maximumExclusion.amount || ""}
                    onChange={(e) =>
                      change({
                        maximumExclusion: {
                          ...value.maximumExclusion,
                          amount: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  Maximum period unit
                  <select
                    className={control}
                    aria-label="Maximum period unit"
                    value={value.maximumExclusion.unit}
                    onChange={(e) =>
                      change({
                        maximumExclusion: { ...value.maximumExclusion, unit: e.target.value },
                      })
                    }
                  >
                    <option value="calendar_days">Calendar days</option>
                    <option value="calendar_months">Calendar months</option>
                    <option value="calendar_years">Calendar years</option>
                  </select>
                </label>
                <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                  Measured from the first excluded day you entered. Confirm that this is the legal
                  cap's correct trigger. Each cap is applied before overlapping intervals are
                  combined; no statutory maximum is assumed.
                </p>
              </div>
            )}
          </div>
        )}
        {value.kind === "defer_start" && (
          <>
            {date(
              "resumeDate",
              "Confirmed resumption date",
              "Do not assume a majority age. Establish the legally applicable date; original accrual remains unchanged.",
            )}
            <label className="flex items-start gap-2 self-center text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={value.presentAtAccrualConfirmed}
                onChange={(e) => change({ presentAtAccrualConfirmed: e.target.checked })}
              />
              <span>
                The qualifying protection existed at accrual, and I verified that the full period
                runs after this resumption.
              </span>
            </label>
          </>
        )}
        {value.kind === "minimum_after_event" && (
          <>
            {date(
              "protectedFromDate",
              "Date protection first attached",
              "For example, the legally effective petition or notice date. Must precede expiry of the then-running period.",
            )}
            {date(
              "eventDate",
              "Later event or notice date",
              "Use the precise trigger established by the authority, not automatically the end of the proceeding.",
            )}
            <label className="text-sm font-medium">
              Minimum period after the event
              <input
                className={control}
                type="number"
                min="1"
                max="36500"
                step="1"
                value={value.amount || ""}
                onChange={(e) => change({ amount: Number(e.target.value) })}
              />
            </label>
            <label className="text-sm font-medium">
              Period unit
              <select
                className={control}
                aria-label="Period unit"
                value={value.unit}
                onChange={(e) => change({ unit: e.target.value })}
              >
                <option value="calendar_days">Calendar days</option>
                <option value="calendar_months">Calendar months</option>
                <option value="calendar_years">Calendar years</option>
              </select>
            </label>
          </>
        )}
        {value.kind === "fixed_deadline" &&
          date(
            "date",
            "Expressly established date",
            "A fixed-date agreement or order cannot be stacked with other effects without an explicit interaction rule.",
          )}
      </div>
      <label className="block text-sm font-medium">
        Authority or case document
        <input
          className={control}
          value={value.authority}
          maxLength={10000}
          onChange={(e) => change({ authority: e.target.value })}
          placeholder="Exact provision, order paragraph or agreement clause"
        />
      </label>
      <label className="block text-sm font-medium">
        Why this effect applies
        <textarea
          className={control + " min-h-20"}
          rows={3}
          value={value.explanation}
          maxLength={10000}
          onChange={(e) => change({ explanation: e.target.value })}
          placeholder="Record claim/party scope, effective version, exclusions, period or cap, and any interaction with other protections."
        />
      </label>
      <label className="block text-sm font-medium">
        Reviewed by
        <input
          className={control}
          value={value.reviewer}
          maxLength={300}
          onChange={(e) => change({ reviewer: e.target.value })}
          placeholder="Name or case-team identifier"
          autoComplete="off"
        />
      </label>
      <div className="space-y-2 rounded-md border border-border bg-background p-3">
        {(
          [
            [
              "legalEffectConfirmed",
              "I checked the legal effect and its applicability to this claim, party and statutory version.",
            ],
            ["boundariesConfirmed", "I checked the dates and exactly which boundary days count."],
            [
              "interactionsConfirmed",
              "I checked prior expiry, other tolls, exclusions, and any independent outer bar.",
            ],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={value[key]}
              onChange={(e) => change({ [key]: e.target.checked }, true)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {errors.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {errors.length} required {errors.length === 1 ? "item remains" : "items remain"}.{" "}
          {errors[0]}
        </p>
      )}
      {errors.length === 0 && (
        <p className="flex items-center gap-2 text-xs font-medium">
          <Check className="h-4 w-4" aria-hidden="true" />
          Instruction complete. Legal applicability remains your recorded assumption.
        </p>
      )}
    </div>
  );
}

export function ReviewChecklist({
  state,
  factors,
  decisions,
  onChange,
  onInspectEvidence,
}: {
  state: string;
  factors: ReviewFactor[];
  decisions: ReviewDecisions;
  onChange: (next: ReviewDecisions) => void;
  onInspectEvidence?: (factor: ReviewFactor) => void;
}) {
  const [openGroup, setOpenGroup] = useState<ReviewGroup | null>("screening");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [lastNavigated, setLastNavigated] = useState<string>();
  const visible = filterReviewFactors(factors, decisions, query, filter);
  const next = nextReviewFactor(factors, decisions, lastNavigated);
  const goNext = () => {
    if (!next) return;
    setQuery("");
    setFilter("all");
    setOpenGroup(next.group);
    setLastNavigated(next.id);
    requestAnimationFrame(() => {
      const node = document.getElementById("factor-" + next.id);
      node?.focus({ preventScroll: true });
      node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };
  const progress = reviewProgress(factors, decisions);
  const update = (id: string, decision: ReviewDecision) =>
    onChange({ ...decisions, [id]: decision });
  const completeUnanswered = (group: ReviewGroup) => {
    const next = acknowledgeUnanswered(factors, decisions, group);
    onChange(next);
    const following = GROUPS.find(
      (g) => g !== group && factors.some((f) => f.group === g && !decisionResolved(f, next[f.id])),
    );
    setOpenGroup(following ?? group);
  };
  return (
    <div className="space-y-3" data-testid="review-checklist" data-jurisdiction={state}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Check what can change the result</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every condition, exclusion and note attached to this rule is included. “Checked” means
            no unresolved change beyond any instruction you record—not that all applicable law has
            been verified.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums">
          {progress.resolved} / {progress.total}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Recorded factors addressed"
        aria-valuenow={progress.resolved}
        aria-valuemin={0}
        aria-valuemax={progress.total}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress.total ? (100 * progress.resolved) / progress.total : 0}%` }}
        />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">Search factors and citations</span>
            <input
              type="search"
              className={control + " mt-0 pl-9"}
              value={query}
              maxLength={200}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a fact, citation or exception"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={!next}
            onClick={goNext}
            aria-label="Next unresolved factor"
          >
            Resolve next <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Filter review factors"
        >
          {(
            [
              ["all", "All factors"],
              ["attention", "Needs attention"],
              ["instructions", "Instructions"],
              ["resolved", "Addressed"],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={
                "min-h-9 rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                (filter === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted")
              }
            >
              {label}
            </button>
          ))}
          <span className="ml-auto px-2 text-xs tabular-nums text-muted-foreground" role="status">
            {visible.length} shown / {factors.length} total
          </span>
        </div>
      </div>
      {visible.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          No factors match this view. Filtering never removes a requirement from your assessment.{" "}
          <button
            type="button"
            className="font-medium text-primary underline"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Show all factors
          </button>
        </p>
      )}
      {GROUPS.map((group) => {
        const items = factors.filter((f) => f.group === group);
        const shown = visible.filter((f) => f.group === group);
        if (!shown.length) return null;
        const resolved = items.filter((f) => decisionResolved(f, decisions[f.id])).length;
        const unanswered = items.filter((f) => !decisions[f.id]).length;
        return (
          <section
            key={group}
            className="overflow-hidden rounded-lg border border-border"
            data-testid={`review-group-${group}`}
          >
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between gap-3 bg-muted/30 px-4 py-3 text-left"
              aria-expanded={openGroup === group}
              aria-controls={`review-content-${group}`}
              onClick={() => setOpenGroup(openGroup === group ? null : group)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {resolved === items.length ? (
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                ) : (
                  <CircleHelp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
                {REVIEW_GROUP_LABELS[group]}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {resolved}/{items.length}
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${openGroup === group ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </span>
            </button>
            {openGroup === group && (
              <div id={`review-content-${group}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border bg-background px-4 py-2">
                  <p className="text-xs text-muted-foreground">
                    Previously flagged items and instructions are never cleared by this action.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={unanswered === 0 || !!query.trim() || filter !== "all"}
                    title={
                      query.trim() || filter !== "all"
                        ? "Clear filters before acknowledging every unanswered item in this group"
                        : "Record your explicit review of this group; existing decisions are preserved"
                    }
                    onClick={() => completeUnanswered(group)}
                  >
                    Mark {unanswered} unanswered as checked
                  </Button>
                </div>
                <div className="max-h-[36rem] divide-y divide-border overflow-y-auto">
                  {shown.map((factor, index) => {
                    const decision = decisions[factor.id];
                    return (
                      <div
                        key={factor.id}
                        id={`factor-${factor.id}`}
                        className="p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        tabIndex={-1}
                        data-testid="review-factor"
                        data-factor-kind={factor.kind}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{factor.citation ?? factor.label}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                              {factor.text}
                            </p>
                            {onInspectEvidence && factor.ruleSourceIds.length > 0 && (
                              <button
                                type="button"
                                className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                                onClick={() => onInspectEvidence(factor)}
                              >
                                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Read this
                                rule's sources
                              </button>
                            )}
                            {factor.origins.length > 1 && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Shown once; retained in {factor.origins.length} source locations.
                              </p>
                            )}
                          </div>
                          <select
                            className={control + " mt-0 sm:w-48 sm:shrink-0"}
                            aria-label={`Review ${factor.label} ${index + 1}`}
                            value={decision?.status ?? ""}
                            onChange={(e) => {
                              const status = e.target.value as ReviewDecision["status"] | "";
                              if (!status) {
                                const next = { ...decisions };
                                delete next[factor.id];
                                onChange(next);
                              } else if (status === "instruction")
                                update(factor.id, {
                                  status,
                                  instruction: emptyInstruction(factor),
                                });
                              else update(factor.id, { status });
                            }}
                          >
                            <option value="">Not checked</option>
                            <option value="no_effect">Checked / addressed</option>
                            <option value="needs_review">Needs legal review</option>
                            {factor.instructionAllowed && (
                              <option value="instruction">Apply reviewed effect</option>
                            )}
                          </select>
                        </div>
                        {decision?.status === "needs_review" && (
                          <label className="mt-3 block text-xs font-medium">
                            What needs to be resolved?
                            <textarea
                              className={control}
                              value={decision.note ?? ""}
                              maxLength={10000}
                              rows={2}
                              onChange={(e) =>
                                update(factor.id, { ...decision, note: e.target.value })
                              }
                              placeholder="The issue remains blocking until resolved; do not guess a legal effect."
                            />
                          </label>
                        )}
                        {decision?.status === "instruction" && decision.instruction && (
                          <InstructionEditor
                            factor={factor}
                            value={decision.instruction}
                            onChange={(instruction) =>
                              update(factor.id, { status: "instruction", instruction })
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
