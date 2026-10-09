import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  Download,
  FileCheck2,
  RotateCcw,
  RefreshCw,
  Scale,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { STATES } from "@/lib/corpus/geo";
import {
  baselineRule,
  calculateBaseline,
  parseCivilDate,
  periodLabel,
  sourceReviewDate,
} from "@/lib/limitations/engine";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  type BaselineInput,
  type ClaimType,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";
import {
  assessDeadline,
  createAssessmentExport,
  type DeadlineAssessment,
} from "@/lib/limitations/deadlineAssessment";
import {
  buildReviewInventory,
  reviewContextKey,
  reviewProgress,
  type ReviewDecisions,
  type ReviewState,
} from "@/lib/limitations/reviewInventory";
import {
  guidedDateFields,
  isAccrualReposeRule,
  missingRequirements,
  reposeCapLabel,
  switchedVersionInput,
  unconfirmedClaimInput,
  versionWindowLabel,
} from "./calculatorGuidance";
import { ReviewChecklist } from "./ReviewChecklist";

const control =
  "mt-1 block min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring";
const box = "min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-6";
const humanize = (text: string) => text.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
import { reviseCaseFacts, CASE_VARIANT_LABELS } from "./caseFacts";

function displayDate(value: string | null): string {
  if (!value || !parseCivilDate(value)) return "Not established";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
}
const steps = [
  { label: "Case & law", icon: Scale },
  { label: "Timeline", icon: CalendarDays },
  { label: "Review & result", icon: FileCheck2 },
];
type Navigation = { state: string; claim?: ClaimType; view: "calculator" | "coverage" | "sources" };
type Props = {
  sourceRefreshFailed?: boolean;
  sourceRefreshing?: boolean;
  onRefreshSources?: () => void;
  snapshot: LimitationsSnapshot;
  state: string;
  claim: ClaimType | undefined;
  onNavigate: (next: Navigation) => void;
  renderAuthority: (rule: LimitationRule) => ReactNode;
};

export function ReviewedCalculator({
  snapshot,
  state,
  claim,
  onNavigate,
  renderAuthority,
  sourceRefreshFailed = false,
  sourceRefreshing = false,
  onRefreshSources,
}: Props) {
  const [input, setInput] = useState<BaselineInput>(() =>
    unconfirmedClaimInput(state, claim ?? ""),
  );
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [resultRecord, setResultRecord] = useState<{
    contextKey: string;
    decisionsKey: string;
    assessment: DeadlineAssessment;
  } | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const rule = useMemo(
    () => (state && claim ? baselineRule(snapshot.rules, state, claim, input.subtype) : null),
    [snapshot.rules, state, claim, input.subtype],
  );
  const factors = useMemo(() => (rule ? buildReviewInventory(rule) : []), [rule]);
  const contextKey = useMemo(
    () => (rule ? reviewContextKey(snapshot, rule, input) : ""),
    [snapshot, rule, input],
  );
  const sourceContextKey = useMemo(
    () =>
      rule
        ? reviewContextKey(
            snapshot,
            rule,
            unconfirmedClaimInput(rule.jurisdiction, rule.claimType, rule.subtype ?? "general"),
          )
        : "",
    [snapshot, rule],
  );
  const [boundEvidence, setBoundEvidence] = useState(sourceContextKey);
  const [sourceChanged, setSourceChanged] = useState(false);
  // Reset only the legal decisions, not the entered facts, when evidence changes.
  // Conditional render-time state adjustment prevents a stale frame before an effect.
  if (boundEvidence !== sourceContextKey) {
    setBoundEvidence(sourceContextKey);
    setSourceChanged(true);
    setInput((previous) => ({
      ...previous,
      governingLawConfirmed: false,
      accrualConfirmed: false,
      applicabilityConfirmed: false,
      reposeApplicabilityConfirmed: false,
      exceptionReview: "unresolved",
    }));
    setReview(null);
    setResultRecord(null);
    setSubmitted(false);
    setStep(rule ? 1 : 0);
  }
  const currentReview = review?.contextKey === contextKey ? review : null;
  const decisions = currentReview?.decisions ?? {};
  const progress = reviewProgress(factors, decisions);
  const result =
    !sourceRefreshFailed &&
    resultRecord?.contextKey === contextKey &&
    resultRecord.decisionsKey === JSON.stringify(decisions)
      ? resultRecord.assessment
      : null;
  const dates = guidedDateFields(rule, state, input.subtype);
  const missing = missingRequirements(input, rule, dates);
  const invalidDates = dates.filter(
    (field) => !!input[field.key] && !parseCivilDate(input[field.key]!),
  );
  const needsRepose = isAccrualReposeRule(rule);
  const confirmationCount = [
    input.governingLawConfirmed,
    input.accrualConfirmed,
    input.applicabilityConfirmed,
    ...(needsRepose ? [input.reposeApplicabilityConfirmed] : []),
  ].filter(Boolean).length;
  const requiredConfirmationCount = needsRepose ? 4 : 3;
  const timelineComplete =
    !!rule &&
    missing.length === 0 &&
    invalidDates.length === 0 &&
    confirmationCount === requiredConfirmationCount &&
    (!rule.calculation?.deathCapYears || (input.vitalStatus !== "unknown" && !!input.vitalStatus));
  const stateName = STATES.find((s) => s.usps === state)?.name ?? state;
  const candidates = snapshot.rules.filter(
    (r) => r.jurisdiction === state && r.claimType === claim && r.ruleKind === "limitations",
  );
  const subtypes = [...new Set(["general", ...candidates.map((r) => r.subtype ?? "general")])];
  const cell = snapshot.coverage
    .find((c) => c.state === state)
    ?.claimCoverage?.find((c) => c.claimType === claim);
  const selectedFacts = rule ? calculateBaseline(snapshot, input) : null;
  const suggestedSubtype = selectedFacts?.suggestedSubtype;
  const sourceCutoff = rule ? sourceReviewDate(snapshot, rule) : null;
  const instructions = Object.values(decisions).filter((d) => d.status === "instruction").length;
  const navigate = (view: Navigation["view"], nextState = state, nextClaim = claim) =>
    onNavigate({ state: nextState, view, ...(nextClaim ? { claim: nextClaim } : {}) });
  const edit = (patch: Partial<BaselineInput>) => {
    setInput((old) => reviseCaseFacts(old, patch));
    setReview(null);
    setResultRecord(null);
    setSubmitted(false);
  };
  const setDecisions = (next: ReviewDecisions) => {
    setReview({ contextKey, decisions: next });
    setResultRecord(null);
  };
  const chooseVersion = (subtype: string) => {
    setInput((old) => switchedVersionInput(old, subtype));
    setReview(null);
    setResultRecord(null);
    setSubmitted(false);
    setStep(1);
  };
  const calculate = () => {
    if (sourceRefreshFailed) return;
    setSubmitted(true);
    if (!timelineComplete) {
      setStep(1);
      return;
    }
    const assessment = assessDeadline(snapshot, input, currentReview, { sourceRefreshFailed });
    setResultRecord({ contextKey, decisionsKey: JSON.stringify(decisions), assessment });
    requestAnimationFrame(() => {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  const exportReview = () => {
    const data = createAssessmentExport(snapshot, input, currentReview, new Date().toISOString(), {
      sourceRefreshFailed,
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `limitations-${state || "unselected"}-${claim || "review"}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div data-testid="guided-calculator" className="space-y-5">
      {sourceRefreshFailed && (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-semibold">Source refresh failed</p>
          <p className="mt-1">
            Your facts are preserved, but calculation is paused until the source release reloads
            successfully. An exported review will record this failure and withhold the assessment
            date.
          </p>
        </div>
      )}
      {sourceChanged && (
        <div role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          <p className="font-semibold">Rule or source evidence changed</p>
          <p className="mt-1">
            Your dates are preserved. Prior confirmations, factor decisions and results were cleared
            so they cannot be applied to different evidence. Review the legal starting point again.
          </p>
        </div>
      )}
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">
            Time limits
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Deadline assessment</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Work through the cited rule, relevant dates and factors that may change the clock.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("sources")}>
          <BookOpen className="mr-2 h-4 w-4" aria-hidden="true" />
          Statutes & sources
        </Button>
      </header>
      <nav
        aria-label="Calculation steps"
        className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/30 p-2"
      >
        {steps.map((item, index) => {
          const done = index === 0 ? !!rule : index === 1 ? timelineComplete : progress.complete;
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.label}
              disabled={index > 0 && !rule}
              aria-current={step === index ? "step" : undefined}
              onClick={() => setStep(index)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${step === index ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
            >
              <span className="hidden sm:block">
                {done ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Icon className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <span>
                {index + 1}. {item.label}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={box} aria-label="Claim assessment form">
          {step === 0 && (
            <section aria-label="Case and law" className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold">Which claim are you assessing?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose the governing law—not automatically the venue or the claimant's residence.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Governing state
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
                <label className="block text-sm font-medium">
                  Claim type
                  <select
                    className={control}
                    aria-label="Choose claim type"
                    value={claim ?? ""}
                    disabled={!state}
                    onChange={(e) =>
                      onNavigate({
                        state,
                        view: "calculator",
                        ...(e.target.value ? { claim: e.target.value as ClaimType } : {}),
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
                  Fact pattern or statutory version
                  <select
                    className={control}
                    value={input.subtype ?? "general"}
                    aria-label="Fact pattern or statutory version"
                    onChange={(e) => chooseVersion(e.target.value)}
                  >
                    {subtypes.map((sub) => {
                      const r = baselineRule(snapshot.rules, state, claim, sub);
                      const label =
                        sub === "general"
                          ? "General claim"
                          : (CASE_VARIANT_LABELS[sub] ?? humanize(sub));
                      return (
                        <option key={sub} value={sub}>
                          {label}
                          {r && versionWindowLabel(r) ? ` — ${versionWindowLabel(r)}` : ""}
                          {r ? "" : " — legal review needed"}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}
              {rule && (
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-lg font-semibold">
                    {rule.period ? periodLabel(rule.period) : "Period not established"}
                  </p>
                  <p className="mt-1 text-sm font-medium text-primary">{rule.pinpoint}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{rule.scope}</p>
                  {versionWindowLabel(rule) && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Recorded applicability: {versionWindowLabel(rule)}
                    </p>
                  )}
                  {reposeCapLabel(rule) && (
                    <p className="mt-2 text-sm font-medium">{reposeCapLabel(rule)}</p>
                  )}
                </div>
              )}
              {state && claim && !rule && (
                <div
                  className="rounded-lg border border-warning/40 bg-warning/10 p-4"
                  role="status"
                >
                  <h4 className="font-semibold">No supported calculation</h4>
                  <p className="mt-2 text-sm leading-relaxed">
                    {cell?.reason ??
                      "No uniquely supported rule exists for this state, claim and fact pattern. A different claim's period will not be substituted."}
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate("sources")}
                  >
                    Review recorded sources
                  </Button>
                </div>
              )}
              {!claim && (
                <div className="rounded-lg border border-dashed border-border p-5 text-sm leading-relaxed text-muted-foreground">
                  Start with one claim and one defendant. The next step asks only for dates required
                  by the selected rule; the review then exposes its recorded tolling notes,
                  conditions and exclusions.
                </div>
              )}
              <div className="flex justify-end border-t border-border pt-4">
                <Button disabled={!rule} onClick={() => setStep(1)}>
                  Continue to timeline
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </section>
          )}
          {step === 1 && rule && (
            <section aria-label="Timeline" className="space-y-5">
              <div>
                <h3 className="text-lg font-semibold">Enter the legally relevant dates</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Exposure, injury, diagnosis and discovery are not interchangeable. Changing a fact
                  resets its confirmations and the exception review.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {dates.map((field) => (
                  <label key={field.key} className="block text-sm font-medium">
                    {field.label}
                    <input
                      className={control}
                      id={`guided-date-${field.key}`}
                      type="date"
                      min="1900-01-01"
                      max={snapshot.snapshotDate}
                      value={input[field.key] ?? ""}
                      aria-invalid={
                        submitted && (!input[field.key] || !parseCivilDate(input[field.key]!))
                      }
                      aria-describedby={`help-${field.key}`}
                      onChange={(e) => edit({ [field.key]: e.target.value })}
                    />
                    <span
                      id={`help-${field.key}`}
                      className="mt-1.5 block text-xs font-normal leading-relaxed text-muted-foreground"
                    >
                      {field.help}
                    </span>
                  </label>
                ))}
              </div>
              {rule.calculation?.deathCapYears && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium">
                    Injured person's status
                    <select
                      className={control}
                      value={input.vitalStatus ?? "unknown"}
                      onChange={(e) =>
                        edit({
                          vitalStatus: e.target.value as NonNullable<BaselineInput["vitalStatus"]>,
                        })
                      }
                    >
                      <option value="unknown">Not established</option>
                      <option value="alive">Alive</option>
                      <option value="deceased">Deceased</option>
                    </select>
                  </label>
                  {input.vitalStatus === "deceased" &&
                    !dates.some((d) => d.key === "deathDate") && (
                      <label className="text-sm font-medium">
                        Date of death
                        <input
                          className={control}
                          type="date"
                          value={input.deathDate ?? ""}
                          min="1900-01-01"
                          max={snapshot.snapshotDate}
                          onChange={(e) => edit({ deathDate: e.target.value })}
                        />
                      </label>
                    )}
                </div>
              )}
              {suggestedSubtype && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                  <p>
                    A separately recorded statutory version may fit these dates. Your facts are
                    preserved, but the legal review must be repeated.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => chooseVersion(suggestedSubtype)}
                  >
                    Use suggested historical version
                  </Button>
                </div>
              )}
              <fieldset className="rounded-lg border border-border p-4">
                <legend className="px-1 text-sm font-semibold">
                  Confirm the legal starting point
                </legend>
                <div className="space-y-3">
                  {(
                    [
                      [
                        "governingLawConfirmed",
                        "I checked that this state's limitations law governs this claim.",
                      ],
                      [
                        "accrualConfirmed",
                        "I checked the legally relevant start dates under the cited rule.",
                      ],
                      [
                        "applicabilityConfirmed",
                        "I checked this claim category and statutory version against the facts.",
                      ],
                      ...(needsRepose
                        ? [
                            [
                              "reposeApplicabilityConfirmed",
                              "I checked the separate repose rule, defendant and triggering event.",
                            ] as const,
                          ]
                        : []),
                    ] as const
                  ).map(([key, label]) => (
                    <label className="flex items-start gap-3 text-sm leading-relaxed" key={key}>
                      <input
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        type="checkbox"
                        checked={input[key] === true}
                        onChange={(e) => edit({ [key]: e.target.checked })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Oldest required-authority review: {displayDate(sourceCutoff)}. The software will not
                assume that later events are governed by unchanged law.
              </p>
              {submitted && !timelineComplete && (
                <p className="rounded-lg bg-warning/10 p-3 text-sm" role="alert">
                  Complete the required dates, status and confirmations before calculating. Unknown
                  facts are not filled automatically.
                </p>
              )}
              <div className="flex justify-between border-t border-border pt-4">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Back
                </Button>
                <Button
                  onClick={() => {
                    setSubmitted(true);
                    if (timelineComplete) {
                      setSourceChanged(false);
                      setSubmitted(false);
                      setStep(2);
                    }
                  }}
                >
                  Continue to review
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </section>
          )}
          {step === 2 && rule && (
            <section aria-label="Review and result" className="space-y-5">
              {!timelineComplete && (
                <div className="rounded-lg bg-warning/10 p-3 text-sm">
                  Some timeline facts or confirmations are missing.{" "}
                  <button className="font-medium underline" onClick={() => setStep(1)}>
                    Return to the timeline.
                  </button>
                </div>
              )}
              <ReviewChecklist
                key={contextKey}
                state={state}
                factors={factors}
                decisions={decisions}
                onChange={setDecisions}
                onInspectEvidence={() => {
                  setShowEvidence(true);
                  requestAnimationFrame(() =>
                    document
                      .getElementById("guided-evidence")
                      ?.scrollIntoView({ block: "start", behavior: "smooth" }),
                  );
                }}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                The factor inventory covers the loaded rule, not an exhaustive survey of applicable
                law. A reviewed instruction changes arithmetic only; it never promotes a source or
                resolves a special-claim exclusion.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                  Timeline
                </Button>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <Button
                    variant="outline"
                    onClick={exportReview}
                    title="Export facts, unresolved issues and recorded instructions"
                  >
                    <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                    Export review
                  </Button>
                  <Button onClick={calculate} disabled={sourceRefreshFailed}>
                    {instructions ? "Calculate reviewed scenario" : "Assess deadline"}
                    <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </section>
          )}
        </section>
        <aside className="space-y-4 xl:sticky xl:top-6" aria-label="Assessment summary">
          <section className={box}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Your assessment</h3>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Reset dates and review"
                onClick={() => {
                  setInput(unconfirmedClaimInput(state, claim ?? ""));
                  setReview(null);
                  setResultRecord(null);
                  setStep(0);
                  setSubmitted(false);
                }}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-3 font-semibold">{stateName || "No state selected"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {claim ? CLAIM_LABELS[claim] : "Choose a claim to begin"}
            </p>
            {rule && (
              <>
                <p className="mt-3 border-t border-border pt-3 text-sm font-medium">
                  {rule.period ? periodLabel(rule.period) : "Review required"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{rule.pinpoint}</p>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Required dates</dt>
                    <dd>
                      {
                        dates.filter((d) => !!input[d.key] && !!parseCivilDate(input[d.key]!))
                          .length
                      }
                      /{dates.length}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Legal confirmations</dt>
                    <dd>
                      {confirmationCount}/{requiredConfirmationCount}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Factors addressed</dt>
                    <dd>
                      {progress.resolved}/{progress.total}
                    </dd>
                  </div>
                  {instructions > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Reviewed instructions</dt>
                      <dd>{instructions}</dd>
                    </div>
                  )}
                </dl>
              </>
            )}
            {!result && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  {progress.unresolved
                    ? `${progress.unresolved} unresolved factors are blocking a date.`
                    : rule
                      ? "Complete the timeline and recorded-factor review before a result is presented."
                      : "A date appears only when a supported rule and sufficient facts are available."}
                </span>
              </div>
            )}
          </section>
          {result && (
            <div
              ref={resultRef}
              tabIndex={-1}
              className={box + " scroll-mt-6 outline-none"}
              data-testid="guided-result"
              role="status"
              aria-live="polite"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {result.status === "reviewed_scenario"
                  ? "Reviewed scenario date"
                  : result.status === "baseline"
                    ? "Unadjusted statutory baseline"
                    : "No deadline established"}
              </p>
              {result.date && (
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {displayDate(result.date)}
                </p>
              )}
              {result.status === "reviewed_scenario" && (
                <div className="mt-3 rounded-lg border border-border p-3 text-xs leading-relaxed">
                  <p className="font-semibold">Conditional on your recorded legal instructions</p>
                  <p className="mt-1">
                    Original baseline: {displayDate(result.baseline.date)}. Excluded days counted
                    once: {result.scenario?.excludedDays ?? 0}.
                  </p>
                </div>
              )}
              {result.calendar?.adjustedDate && (
                <div className="mt-3 text-sm">
                  <p className="font-medium">
                    Weekend-only candidate: {displayDate(result.calendar.adjustedDate.date)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.calendar.adjustedDate.citation}. Holidays and court cutoffs are not
                    resolved by this extension.
                  </p>
                </div>
              )}
              {result.calendar?.weekendNotice && (
                <p className="mt-3 text-sm leading-relaxed">{result.calendar.weekendText}</p>
              )}
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                {result.reasons.map((reason, index) => (
                  <p key={index}>{reason}</p>
                ))}
              </div>
              {result.date && (
                <p className="mt-4 border-t border-border pt-3 text-xs font-medium leading-relaxed">
                  Not a verified final filing deadline. Confirm complete operative law, the court
                  calendar, service requirements and all case-specific assumptions.
                </p>
              )}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  Calculation and evidence trail
                </summary>
                <div className="mt-3 space-y-3 text-xs leading-relaxed">
                  {result.baseline.steps.map((s, i) => (
                    <p key={`base-${i}`}>
                      {s.text}
                      {s.pinpoint ? ` (${s.pinpoint})` : ""}
                    </p>
                  ))}
                  {result.scenario?.steps.map((s, i) => (
                    <p key={`adj-${i}`}>
                      {s.text}
                      {s.date ? ` Result: ${s.date}.` : ""}
                    </p>
                  ))}
                </div>
              </details>
              <Button className="mt-4 w-full" variant="outline" size="sm" onClick={exportReview}>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Export full assessment
              </Button>
            </div>
          )}
          <section className="rounded-xl border border-border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Source-linked, not assumption-free</p>
            <p className="mt-1">
              Release {snapshot.ruleVersion}. Review data stays in this page unless you export it.
              Nothing is automatically saved or sent to an AI service.
            </p>
            {onRefreshSources && (
              <button
                type="button"
                onClick={onRefreshSources}
                disabled={sourceRefreshing}
                aria-label="Refresh source release"
                className="mt-3 flex min-h-9 items-center gap-2 font-semibold text-primary disabled:opacity-50"
              >
                <RefreshCw
                  className={"h-4 w-4 " + (sourceRefreshing ? "animate-spin" : "")}
                  aria-hidden="true"
                />
                {sourceRefreshing ? "Checking source release…" : "Refresh source release"}
              </button>
            )}
            {rule && (
              <button
                type="button"
                className="mt-3 flex items-center gap-2 font-semibold text-primary"
                aria-expanded={showEvidence}
                onClick={() => setShowEvidence(!showEvidence)}
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                {showEvidence ? "Hide" : "Show"} source evidence
              </button>
            )}
          </section>
        </aside>
      </div>
      {showEvidence && rule && (
        <section
          id="guided-evidence"
          className={box + " scroll-mt-6"}
          aria-label="Selected rule evidence"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">The selected rule and its retained evidence</h3>
            <Button size="sm" variant="ghost" onClick={() => setShowEvidence(false)}>
              Close
            </Button>
          </div>
          {renderAuthority(rule)}
        </section>
      )}
    </div>
  );
}
