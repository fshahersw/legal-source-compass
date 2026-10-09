import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { STATES } from "@/lib/corpus/geo";
import { baselineRule, periodLabel, sourceReviewDate } from "@/lib/limitations/engine";
import {
  SCREENING_QUESTIONS,
  exceptionInventory,
  reviewContextKey,
  type ScreeningAnswers,
  type ScreeningId,
} from "@/lib/limitations/exceptionReview";
import {
  calculateGuided,
  assessmentExport,
  type GuidedReview,
} from "@/lib/limitations/guidedAssessment";
import {
  eligibleMinorityPolicy,
  type MinorityFacts,
  type ReviewedResult,
} from "@/lib/limitations/tollingPolicy";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  type BaselineInput,
  type ClaimType,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";
import {
  guidedDateFields,
  isAccrualReposeRule,
  missingRequirements,
  unconfirmedClaimInput,
  switchedVersionInput,
  versionWindowLabel,
} from "./calculatorGuidance";

const control =
  "mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary";
const card = "rounded-xl border border-border bg-surface";
const groups = [...new Set(SCREENING_QUESTIONS.map((q) => q.group))];
const human = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const dateLabel = (s: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(s + "T12:00:00Z"));
const emptyMinority = (): MinorityFacts => ({
  policyId: "",
  majorityDate: "",
  minorAtAccrual: false,
  majorityDateConfirmed: false,
  livingNoOtherDisability: false,
  ordinaryPrivateClaim: false,
  conditionsConfirmed: false,
});

export function GuidedCalculator({
  snapshot,
  state,
  claim,
  onNavigate,
  renderEvidence,
  patternLabel,
}: {
  snapshot: LimitationsSnapshot;
  state: string;
  claim: ClaimType | undefined;
  onNavigate: (next: {
    state: string;
    claim?: ClaimType | undefined;
    view: "calculator" | "coverage" | "sources";
  }) => void;
  renderEvidence: (rule: LimitationRule) => ReactNode;
  patternLabel: (subtype: string, rule: LimitationRule | null) => string;
}) {
  const [input, setInput] = useState<BaselineInput>(() =>
    unconfirmedClaimInput(state, claim ?? ""),
  );
  const [step, setStep] = useState(0);
  const [groupIndex, setGroupIndex] = useState(0);
  const [answers, setAnswers] = useState<ScreeningAnswers>({});
  const [qualificationsReviewed, setQualificationsReviewed] = useState(false);
  const [minority, setMinority] = useState<MinorityFacts>(emptyMinority);
  const [result, setResult] = useState<ReviewedResult | null>(null);
  const [noteQuery, setNoteQuery] = useState("");
  const [uiError, setUiError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rule = claim ? baselineRule(snapshot.rules, state, claim, input.subtype) : null;
  const rules = useMemo(
    () => snapshot.rules.filter((r) => r.jurisdiction === state && r.claimType === claim),
    [snapshot, state, claim],
  );
  const subtypes = [...new Set(["general", ...rules.map((r) => r.subtype ?? "general")])];
  const inventory = useMemo(
    () => (rule ? exceptionInventory(snapshot, rule) : []),
    [snapshot, rule],
  );
  const filteredNotes = inventory.filter(
    (n) =>
      !noteQuery || `${n.text} ${n.citation ?? ""}`.toLowerCase().includes(noteQuery.toLowerCase()),
  );
  const policy = eligibleMinorityPolicy(rule);
  const dates = guidedDateFields(rule, state, input.subtype);
  const required = [
    ...missingRequirements(
      { ...input, exceptionReview: "no_unresolved_issues", issues: [] },
      rule,
      dates,
    ),
    ...(!input.governingLawConfirmed
      ? [{ id: "governingLawConfirmed", label: "Confirm governing law" }]
      : []),
    ...(!input.accrualConfirmed
      ? [{ id: "accrualConfirmed", label: "Confirm the legal start dates" }]
      : []),
    ...(!input.applicabilityConfirmed
      ? [{ id: "applicabilityConfirmed", label: "Confirm claim and version applicability" }]
      : []),
  ];
  const answered = SCREENING_QUESTIONS.filter((q) => answers[q.id]).length;
  const selected = SCREENING_QUESTIONS.filter(
    (q) => answers[q.id] === "yes" || answers[q.id] === "unsure",
  );
  const currentQuestions = SCREENING_QUESTIONS.filter((q) => q.group === groups[groupIndex]);
  const groupComplete = currentQuestions.every((q) => answers[q.id]);
  const stateName = STATES.find((s) => s.usps === state)?.name ?? state;
  const cutoff = rule ? sourceReviewDate(snapshot, rule) : null;
  const review: GuidedReview = {
    answers,
    contextKey: rule ? reviewContextKey(snapshot, rule, input) : "",
    recordedQualificationsReviewed: qualificationsReviewed,
    ...(answers.minority === "yes"
      ? { minority: { ...minority, policyId: policy?.id ?? "", minorAtAccrual: true } }
      : {}),
  };
  function go(next: number) {
    setStep(next);
    setUiError("");
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  function changeFacts(patch: Partial<BaselineInput>) {
    setInput((old) => ({
      ...old,
      ...patch,
      governingLawConfirmed: false,
      accrualConfirmed: false,
      applicabilityConfirmed: false,
      reposeApplicabilityConfirmed: false,
    }));
    setAnswers({});
    setQualificationsReviewed(false);
    setMinority(emptyMinority());
    setResult(null);
    setUiError("");
  }
  function answer(id: ScreeningId, value: "yes" | "no" | "unsure") {
    setAnswers((old) => ({ ...old, [id]: value }));
    setQualificationsReviewed(false);
    setResult(null);
    if (id === "minority") setMinority(emptyMinority());
  }
  function calculate() {
    if (!rule) return;
    const next = calculateGuided(snapshot, input, review);
    setResult(next);
    go(2);
  }
  function printAssessment() {
    if (!result) return;
    try {
      assessmentExport(snapshot, input, review, result); // Revalidate retained evidence before printing.
      setResult(calculateGuided(snapshot, input, review));
      requestAnimationFrame(() => window.print());
    } catch {
      setUiError("The assessment could not be printed. Recheck the sources and try again.");
    }
  }
  const evidence = (
    <details className={card + " mt-4 p-4"}>
      <summary className="cursor-pointer text-sm font-semibold">
        Recorded qualifications and authority{" "}
        <span className="ml-2 text-muted-foreground font-normal">{inventory.length} items</span>
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">
        Every recorded condition, exclusion, tolling note, repose note, warning and flag is retained
        here. Topic grouping does not determine legal effect; unclassified provisions stay visible.
      </p>
      <input
        className={control}
        value={noteQuery}
        onChange={(e) => setNoteQuery(e.target.value)}
        placeholder="Find a provision or phrase"
        aria-label="Search recorded qualifications"
      />
      <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-border">
        {filteredNotes.map((n) => (
          <article key={n.id} className="py-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {n.kind} · {n.citation ?? rule?.pinpoint}
            </p>
            <p className="leading-relaxed">{n.text}</p>
            <span className="mt-1 block text-xs text-muted-foreground">Source record: {n.id}</span>
          </article>
        ))}
        {!filteredNotes.length && (
          <p className="py-3 text-sm">No matching recorded qualifications.</p>
        )}
      </div>
      {rule && <div className="mt-4 border-t border-border pt-4">{renderEvidence(rule)}</div>}
    </details>
  );
  return (
    <div data-testid="guided-calculator" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-2" aria-label="Calculator steps">
          {["Case facts", "Exceptions", "Assessment"].map((label, index) => (
            <button
              key={label}
              type="button"
              disabled={(index === 1 && (!rule || required.length > 0)) || (index === 2 && !result)}
              onClick={() => go(index)}
              aria-current={step === index ? "step" : undefined}
              className={
                "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition-colors disabled:opacity-40 " +
                (step === index
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted")
              }
            >
              <span
                className={
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs " +
                  (step === index ? "bg-primary-foreground/15" : "border border-border")
                }
              >
                {index + 1}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <span className="text-xs text-muted-foreground">Release {snapshot.ruleVersion}</span>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0" role="region" aria-label="Guided assessment">
          <section className={card + " overflow-hidden"}>
            <header className="border-b border-border px-5 py-4 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Step {step + 1} of 3
              </p>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="mt-1 text-xl font-semibold tracking-tight outline-none"
              >
                {step === 0
                  ? "Case facts"
                  : step === 1
                    ? "Exceptions and tolling"
                    : "Your assessment"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {step === 0
                  ? "Choose the legal rule, then enter the dates it actually requires."
                  : step === 1
                    ? "Review one small group at a time. Yes and Not sure are never treated as No."
                    : "See the date, applied rules, and anything still requiring a decision."}
              </p>
            </header>
            <div className="p-5 sm:p-6">
              {step === 0 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">
                      Governing law
                      <select
                        className={control}
                        aria-label="Choose governing state"
                        value={state}
                        onChange={(e) => onNavigate({ state: e.target.value, view: "calculator" })}
                      >
                        <option value="">Choose a state</option>
                        {[...STATES]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((s) => (
                            <option key={s.usps} value={s.usps}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium">
                      Claim
                      <select
                        className={control}
                        aria-label="Choose claim type"
                        value={claim ?? ""}
                        disabled={!state}
                        onChange={(e) =>
                          onNavigate({
                            state,
                            claim: (e.target.value || undefined) as ClaimType | undefined,
                            view: "calculator",
                          })
                        }
                      >
                        <option value="">Choose a claim</option>
                        {CLAIM_TYPES.map((c) => (
                          <option key={c} value={c}>
                            {CLAIM_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {state && claim && subtypes.length > 1 && (
                    <label className="block text-sm font-medium">
                      Claim variant or statutory version
                      <select
                        className={control}
                        value={input.subtype ?? "general"}
                        onChange={(e) => {
                          setInput(unconfirmedClaimInput(state, claim, e.target.value));
                          setAnswers({});
                          setMinority(emptyMinority());
                          setQualificationsReviewed(false);
                          setResult(null);
                        }}
                      >
                        {subtypes.map((s) => (
                          <option key={s} value={s}>
                            {patternLabel(s, baselineRule(snapshot.rules, state, claim, s))}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {state && claim && !rule && (
                    <div
                      role="status"
                      className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm"
                    >
                      <p className="font-semibold">
                        This branch does not have a unique supported calculation.
                      </p>
                      <p className="mt-1">
                        Review the recorded rule or choose the fact pattern that actually applies. A
                        narrower variant is not a substitute for a missing general rule.
                      </p>
                      <Button
                        className="mt-3"
                        variant="outline"
                        onClick={() => onNavigate({ state, claim, view: "sources" })}
                      >
                        Open claim sources
                      </Button>
                      {rules
                        .filter((r) => (r.subtype ?? "general") === (input.subtype ?? "general"))
                        .map((r) => (
                          <details key={r.id} className="mt-3">
                            <summary className="cursor-pointer font-medium">{r.pinpoint}</summary>
                            {renderEvidence(r)}
                          </details>
                        ))}
                    </div>
                  )}
                  {rule && (
                    <>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex flex-wrap justify-between gap-2">
                          <p className="text-sm font-semibold">
                            {rule.period ? periodLabel(rule.period) : "Review required"}
                          </p>
                          <p className="text-xs text-muted-foreground">{rule.pinpoint}</p>
                        </div>
                        <p className="mt-1 text-sm">{rule.scope}</p>
                        {versionWindowLabel(rule) && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {versionWindowLabel(rule)}
                          </p>
                        )}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {dates.map((f) => (
                          <label key={f.key} className="text-sm font-medium">
                            {f.label}
                            <input
                              id={"date-" + f.key}
                              type="date"
                              className={control}
                              min="1900-01-01"
                              max={snapshot.snapshotDate}
                              value={input[f.key] ?? ""}
                              onChange={(e) => changeFacts({ [f.key]: e.target.value })}
                              aria-describedby={f.key + "-help"}
                            />
                            <span
                              id={f.key + "-help"}
                              className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground"
                            >
                              {f.help}
                            </span>
                          </label>
                        ))}
                      </div>
                      {rule.calculation?.deathCapYears && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-sm">
                            Claimant status
                            <select
                              className={control}
                              value={input.vitalStatus ?? "unknown"}
                              onChange={(e) =>
                                changeFacts({
                                  vitalStatus: e.target.value as NonNullable<
                                    BaselineInput["vitalStatus"]
                                  >,
                                  deathDate: "",
                                })
                              }
                            >
                              <option value="unknown">Choose status</option>
                              <option value="alive">Living</option>
                              <option value="deceased">Deceased</option>
                            </select>
                          </label>
                          {input.vitalStatus === "deceased" &&
                            !dates.some((d) => d.key === "deathDate") && (
                              <label className="text-sm">
                                Date of death
                                <input
                                  id="date-deathDate"
                                  className={control}
                                  type="date"
                                  value={input.deathDate ?? ""}
                                  max={snapshot.snapshotDate}
                                  onChange={(e) => changeFacts({ deathDate: e.target.value })}
                                />
                              </label>
                            )}
                        </div>
                      )}
                      <fieldset className="space-y-3 border-t border-border pt-4">
                        <legend className="mb-2 text-sm font-semibold">Confirm the basis</legend>
                        {(
                          [
                            ["governingLawConfirmed", "This state’s law governs this claim."],
                            [
                              "accrualConfirmed",
                              "The entered dates are the legally relevant start dates.",
                            ],
                            [
                              "applicabilityConfirmed",
                              "This claim category, version and scope fit the facts.",
                            ],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-primary"
                              checked={input[key]}
                              onChange={(e) => {
                                setInput((old) => ({ ...old, [key]: e.target.checked }));
                                setResult(null);
                              }}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                        {isAccrualReposeRule(rule) && (
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              id="repose-applicability-confirmed"
                              type="checkbox"
                              className="mt-0.5 h-4 w-4"
                              checked={input.reposeApplicabilityConfirmed ?? false}
                              onChange={(e) => {
                                setInput((old) => ({
                                  ...old,
                                  reposeApplicabilityConfirmed: e.target.checked,
                                }));
                                setResult(null);
                              }}
                            />
                            <span>
                              The independent repose clock applies to this claim and defendant.
                            </span>
                          </label>
                        )}
                      </fieldset>
                      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                        <p className="text-xs text-muted-foreground">
                          {required.length
                            ? `${required.length} required ${required.length === 1 ? "item" : "items"} remaining`
                            : "Facts entered. Next, review exceptions."}
                        </p>
                        <Button disabled={required.length > 0} onClick={() => go(1)}>
                          Review exceptions{" "}
                          <span aria-hidden="true" className="ml-2">
                            →
                          </span>
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {step === 1 && rule && (
                <div>
                  <div className="mb-5 flex flex-wrap gap-1.5" aria-label="Exception review groups">
                    {groups.map((g, i) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGroupIndex(i)}
                        className={
                          "min-h-9 rounded-md px-2.5 text-xs font-medium " +
                          (i === groupIndex
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground")
                        }
                      >
                        {SCREENING_QUESTIONS.filter((q) => q.group === g).every(
                          (q) => answers[q.id],
                        )
                          ? "✓ "
                          : ""}
                        {g}
                      </button>
                    ))}
                  </div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{groups[groupIndex]}</h3>
                    <button
                      type="button"
                      className="text-xs text-primary underline underline-offset-4"
                      onClick={() => {
                        const additions = Object.fromEntries(
                          currentQuestions.filter((q) => !answers[q.id]).map((q) => [q.id, "no"]),
                        );
                        setAnswers((old) => ({ ...old, ...additions }));
                        setQualificationsReviewed(false);
                        setResult(null);
                      }}
                    >
                      No to unanswered questions in this group
                    </button>
                  </div>
                  <div className="divide-y divide-border">
                    {currentQuestions.map((q) => {
                      const notes = inventory.filter((n) => n.categories.includes(q.id));
                      return (
                        <div key={q.id} className="py-4 first:pt-1">
                          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                            <div className="min-w-0">
                              <p id={"question-" + q.id} className="text-sm font-medium">
                                {q.label}
                              </p>
                              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                                {q.hint}
                              </p>
                            </div>
                            <div
                              role="radiogroup"
                              aria-labelledby={"question-" + q.id}
                              className="flex shrink-0 gap-1"
                            >
                              {(["no", "yes", "unsure"] as const).map((a) => (
                                <button
                                  key={a}
                                  type="button"
                                  role="radio"
                                  aria-checked={answers[q.id] === a}
                                  onClick={() => answer(q.id, a)}
                                  className={
                                    "min-h-9 rounded-md border px-3 text-xs font-medium " +
                                    (answers[q.id] === a
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-background hover:bg-muted")
                                  }
                                >
                                  {a === "unsure" ? "Not sure" : human(a)}
                                </button>
                              ))}
                            </div>
                          </div>
                          {answers[q.id] && answers[q.id] !== "no" && (
                            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
                              <p className="font-medium">
                                {q.id === "minority" && policy && answers[q.id] === "yes"
                                  ? "A source-bound minority calculation is available after the facts below are confirmed."
                                  : "Separate legal review is required; no automatic extension is assumed."}
                              </p>
                              {notes.length > 0 && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-primary">
                                    {notes.length} recorded qualifications relevant to this topic
                                  </summary>
                                  <div className="mt-2 space-y-2">
                                    {notes.map((n) => (
                                      <p key={n.id}>
                                        {n.text}
                                        {n.citation && (
                                          <span className="block font-medium">{n.citation}</span>
                                        )}
                                      </p>
                                    ))}
                                  </div>
                                </details>
                              )}
                              {!notes.length && (
                                <p className="mt-1">
                                  This release has no matched topic-specific note. Absence of a note
                                  is not evidence that no exception exists.
                                </p>
                              )}
                            </div>
                          )}
                          {q.id === "minority" && answers.minority === "yes" && policy && (
                            <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
                              <label className="block text-sm font-medium">
                                Legally established date majority was attained
                                <input
                                  type="date"
                                  className={control}
                                  max={snapshot.snapshotDate}
                                  value={minority.majorityDate}
                                  onChange={(e) => {
                                    setMinority((old) => ({
                                      ...old,
                                      majorityDate: e.target.value,
                                      majorityDateConfirmed: false,
                                      conditionsConfirmed: false,
                                    }));
                                    setResult(null);
                                  }}
                                />
                                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                                  Enter the established date; no age-attainment rule or leap-day
                                  convention is inferred.
                                </span>
                              </label>
                              {(
                                [
                                  [
                                    "majorityDateConfirmed",
                                    "This is the legally correct majority date.",
                                  ],
                                  [
                                    "livingNoOtherDisability",
                                    "The claimant is living and no other disability changes the analysis.",
                                  ],
                                  [
                                    "ordinaryPrivateClaim",
                                    "This is an ordinary private-party injury claim, not a public, malpractice, sexual-abuse, product/latent-injury or special statutory claim.",
                                  ],
                                  [
                                    "conditionsConfirmed",
                                    "I reviewed the cited policy conditions and applicable statutory version.",
                                  ],
                                ] as const
                              ).map(([key, label]) => (
                                <label key={key} className="flex gap-2 text-xs leading-relaxed">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 shrink-0"
                                    checked={minority[key]}
                                    onChange={(e) => {
                                      setMinority((old) => ({ ...old, [key]: e.target.checked }));
                                      setResult(null);
                                    }}
                                  />
                                  {label}
                                </label>
                              ))}
                              <details className="text-xs">
                                <summary className="cursor-pointer font-medium">
                                  Policy authority and scope
                                </summary>
                                {policy.conditions.map((c) => (
                                  <p key={c} className="mt-2">
                                    {c}
                                  </p>
                                ))}
                                {policy.evidence.map((e) => (
                                  <blockquote
                                    key={e.sourceId + e.citation}
                                    className="mt-2 border-l-2 border-border pl-3"
                                  >
                                    {e.quote}
                                    <span className="block font-medium">{e.citation}</span>
                                  </blockquote>
                                ))}
                              </details>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-border pt-4">
                    <Button
                      variant="outline"
                      onClick={() => (groupIndex ? setGroupIndex(groupIndex - 1) : go(0))}
                    >
                      Back
                    </Button>
                    {groupIndex < groups.length - 1 ? (
                      <Button
                        disabled={!groupComplete}
                        onClick={() => setGroupIndex(groupIndex + 1)}
                      >
                        Next group →
                      </Button>
                    ) : (
                      <Button
                        disabled={answered < SCREENING_QUESTIONS.length}
                        onClick={() =>
                          document
                            .getElementById("review-recorded-qualifications")
                            ?.scrollIntoView({ behavior: "smooth", block: "center" })
                        }
                      >
                        Finish review ↓
                      </Button>
                    )}
                  </div>
                  {groupIndex === groups.length - 1 && (
                    <div className="mt-5 rounded-lg border border-border p-4">
                      <label
                        id="review-recorded-qualifications"
                        className="flex items-start gap-3 text-sm leading-relaxed"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={qualificationsReviewed}
                          onChange={(e) => {
                            setQualificationsReviewed(e.target.checked);
                            setResult(null);
                          }}
                        />
                        <span>
                          I reviewed all recorded qualifications below and my answers address their
                          applicability. Unknown or unmodelled law is not treated as resolved.
                        </span>
                      </label>
                      <Button
                        className="mt-4 w-full"
                        disabled={answered < SCREENING_QUESTIONS.length || !qualificationsReviewed}
                        onClick={calculate}
                      >
                        Show assessment
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {step === 2 && result && (
                <div className="space-y-5" data-testid="guided-result">
                  <div
                    className={
                      "rounded-xl border p-5 " +
                      (result.date
                        ? "border-primary/30 bg-primary/5"
                        : "border-warning/40 bg-warning/5")
                    }
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {result.date
                        ? result.tollingApplied
                          ? "Minority-adjusted statutory anniversary"
                          : "Conditional statutory anniversary"
                        : "Date withheld"}
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight">
                      {result.date ? (
                        <time dateTime={result.date}>{dateLabel(result.date)}</time>
                      ) : (
                        "Review required"
                      )}
                    </p>
                    {result.date && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Not a verified last day for filing. Filing calendars and service rules
                        remain separate.
                      </p>
                    )}
                    {result.tollingApplied && (
                      <p className="mt-3 text-sm">
                        Before minority tolling: {dateLabel(result.tollingApplied.ordinaryDate)}
                        <br />
                        Applied authority: {result.tollingApplied.citation}
                      </p>
                    )}
                    {result.adjustedDate && (
                      <p className="mt-3 text-sm font-medium">
                        Recorded weekend rule: {dateLabel(result.adjustedDate.date)} ·{" "}
                        {result.adjustedDate.citation}. Holidays are not included.
                      </p>
                    )}
                    {result.weekendNotice && (
                      <p className="mt-3 text-sm">
                        Weekend adjustment not applied.{" "}
                        {"note" in result.weekendNotice
                          ? result.weekendNotice.note
                          : (result.weekendNotice.reason ??
                            "No verified counting rule is recorded.")}
                      </p>
                    )}
                  </div>
                  {result.reasons.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold">
                        {result.date ? "Scope and outstanding checks" : "What needs attention"}
                      </h3>
                      <div className="mt-2 space-y-2 text-sm">
                        {[...new Set(result.reasons)].map((r) => (
                          <p key={r} className="border-l-2 border-border pl-3">
                            {r}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.suggestedSubtype && claim && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setInput(switchedVersionInput(input, result.suggestedSubtype!));
                        setAnswers({});
                        setMinority(emptyMinority());
                        setQualificationsReviewed(false);
                        setResult(null);
                        go(0);
                      }}
                    >
                      Review the suggested historical version
                    </Button>
                  )}
                  <details className="rounded-lg border border-border p-4">
                    <summary className="cursor-pointer text-sm font-semibold">
                      Calculation trace and review record
                    </summary>
                    <ol className="mt-4 space-y-3">
                      {result.steps.map((s, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="text-muted-foreground">{i + 1}.</span>
                          <div>
                            {s.text}
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {s.pinpoint}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Release {snapshot.ruleVersion} · rule {rule?.id}. Screening answers and
                      confirmations are supplied by the reviewer; they are not independent findings.
                    </p>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={printAssessment}>Print assessment</Button>
                    <Button variant="outline" onClick={() => go(1)}>
                      Edit exceptions
                    </Button>
                    <Button variant="ghost" onClick={() => go(0)}>
                      Edit facts
                    </Button>
                  </div>
                </div>
              )}
              {uiError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {uiError}
                </p>
              )}
            </div>
          </section>
          {rule && evidence}
        </div>
        <aside className={card + " p-5 xl:sticky xl:top-5"} aria-label="Assessment summary">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            At a glance
          </p>
          <h3 className="mt-3 text-base font-semibold">{stateName || "Choose governing law"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {claim ? CLAIM_LABELS[claim] : "Choose a claim to begin"}
          </p>
          {rule && (
            <>
              <div className="my-4 border-t border-border" />
              <p className="text-2xl font-semibold">
                {rule.period ? periodLabel(rule.period) : "Review needed"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{rule.pinpoint}</p>
              <div className="my-4 border-t border-border" />
              <div className="flex justify-between text-sm">
                <span>Exception screening</span>
                <span className="font-medium">
                  {answered}/{SCREENING_QUESTIONS.length}
                </span>
              </div>
              <progress
                aria-label="Exception questions answered"
                className="mt-2 h-1.5 w-full accent-primary"
                value={answered}
                max={SCREENING_QUESTIONS.length}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {selected.length
                  ? `${selected.length} affirmative or uncertain ${selected.length === 1 ? "topic" : "topics"}`
                  : "No affirmative topics recorded yet; unanswered questions remain open."}
              </p>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Required sources reviewed through {cutoff ?? "an unrecorded date"}. Source retrieval
                is not a complete review of applicable law.
              </p>
              <div className="my-4 border-t border-border" />
              <p className="text-xs font-medium">Filing calendars and service rules</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Confirm holidays, court closures, commencement, service and local cutoffs
                separately. No deadline is inferred from an unresolved issue.
              </p>
            </>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              className="text-left text-xs text-primary underline underline-offset-4"
              onClick={() => onNavigate({ state, claim, view: "sources" })}
            >
              Statutes and sources →
            </button>
            <button
              type="button"
              className="text-left text-xs text-primary underline underline-offset-4"
              onClick={() => onNavigate({ state, claim, view: "coverage" })}
            >
              All-state coverage →
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
