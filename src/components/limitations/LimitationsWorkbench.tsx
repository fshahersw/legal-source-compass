import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { STATES } from "@/lib/corpus/geo";
import { loadLimitations } from "@/lib/limitations/load";
import {
  baselineRule,
  calculateBaseline,
  periodLabel,
  sourceReviewDate,
} from "@/lib/limitations/engine";
import { NOT_RECORDED, ruleAuthorityFacts } from "./ruleAuthority";
import { StatuteCitation } from "./StatuteCitation";
import {
  guidedDateFields,
  isAccrualReposeRule,
  missingRequirements,
  reposeCapLabel,
  unconfirmedClaimInput,
} from "./calculatorGuidance";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  VERIFICATION_GRADE_LABELS,
  SPECIAL_ISSUES,
  type BaselineInput,
  type BaselineResult,
  type ClaimType,
  type JudicialReference,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";

type View = "calculator" | "coverage" | "sources";
type Navigation = { state: string; claim?: ClaimType; view: View };
const control =
  "mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const box = "rounded-xl border border-border bg-surface p-5";
const humanize = (slug: string) => slug.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const subtypeLabels: Record<string, string> = {
  general: "General claim",
  latent_toxic: "Latent substance / toxic injury",
  asbestos: "Asbestos-related injury",
  medical_device: "Implanted medical device",
  breast_implant: "Breast augmentation / reconstruction prosthesis",
  occupational_disease: "Workplace toxic disease contributing to death",
  chromium: "Chromium exposure",
  agent_orange: "Veteran's qualifying defoliant / herbicide exposure",
  synthetic_estrogen: "DES / nonsteroidal synthetic estrogen exposure",
};

const patternLabel = (slug: string) =>
  slug === "general"
    ? "General rule for this claim type"
    : `Variant, only if this fact pattern fits: ${subtypeLabels[slug] ?? humanize(slug)}`;
function Authority({ snapshot, rule }: { snapshot: LimitationsSnapshot; rule: LimitationRule }) {
  const facts = ruleAuthorityFacts(snapshot, rule);
  return (
    <div className="mt-3 rounded-lg border border-border p-3 text-sm" data-testid="rule-authority">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="font-medium">Citation</dt>
        <dd>
          <StatuteCitation state={rule.jurisdiction} citation={facts.citation} />
        </dd>
        <dt className="font-medium">Verification grade</dt>
        <dd>
          <span
            className="inline-block rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium"
            title={facts.gradeBasis}
            data-testid="verification-grade"
          >
            {facts.grade}
          </span>
          <span className="mt-1 block">{facts.gradeBasis}</span>
        </dd>
        <dt className="font-medium">Fetch route</dt>
        <dd data-testid="fetch-route">
          {facts.sources.length
            ? facts.sources.map((source) => (
                <span key={source.id} className="block">
                  {source.route}
                </span>
              ))
            : NOT_RECORDED}
        </dd>
        <dt className="font-medium">Effective date</dt>
        <dd>{facts.effective}</dd>
        <dt className="font-medium">Last amended</dt>
        <dd>{facts.lastAmended}</dd>
        <dt className="font-medium">Source</dt>
        <dd className="flex flex-col gap-1">
          {facts.sources.length ? (
            facts.sources.map((source) => (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="break-all text-primary underline"
              >
                {source.url}
                {source.route !== NOT_RECORDED ? ` (${source.route})` : ""}
              </a>
            ))
          ) : (
            <span>Not recorded</span>
          )}
        </dd>
        <dt className="font-medium">Retrieved</dt>
        <dd>{facts.retrieved}</dd>
        {facts.entryStatus !== "legacy" && (
          <>
            <dt className="font-medium">Accrual</dt>
            <dd>{facts.accrual}</dd>
            <dt className="font-medium">Verification</dt>
            <dd>
              {facts.entryStatus === "verified"
                ? "Period and quoted text matched to the official capture"
                : "Recorded with open issues; no date is issued"}
              {facts.confidence ? ` · confidence ${facts.confidence}` : ""}
            </dd>
          </>
        )}
      </dl>
      {facts.excerpt && (
        <blockquote className="mt-2 border-l-2 border-border pl-3 italic leading-relaxed">
          {facts.excerpt}
        </blockquote>
      )}
      {facts.repose.length > 0 && (
        <p className="mt-2">
          <span className="font-medium">Statute of repose: </span>
          {facts.repose.join("; ")}
        </p>
      )}
      {facts.tolling.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">Statutory tolling (not applied by the calculator)</p>
          <ul className="list-disc pl-5">
            {facts.tolling.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {facts.flags.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">Open issues</p>
          <ul className="list-disc pl-5">
            {facts.flags.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Citations({ snapshot, rule }: { snapshot: LimitationsSnapshot; rule: LimitationRule }) {
  return (
    <div className="mt-3 text-sm">
      <Authority snapshot={snapshot} rule={rule} />
      <details className="mt-2">
        <summary className="min-h-9 cursor-pointer py-2 font-medium text-primary">
          View cited authorities
        </summary>
        <div className="mt-1 flex flex-col items-start gap-2">
          {rule.sourceIds.map((id) => {
            const source = snapshot.sources.find((item) => item.id === id);
            return source ? (
              <a
                key={id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline"
              >
                {source.title}
              </a>
            ) : (
              <span key={id}>Source not recorded</span>
            );
          })}
          {rule.caseReferenceIds?.map((id) => {
            const item = snapshot.cases.find((c) => c.id === id);
            return item ? (
              <a
                key={id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                {item.citation}
              </a>
            ) : null;
          })}
        </div>
      </details>
    </div>
  );
}

function JudicialEvidence({ reference }: { reference: JudicialReference }) {
  return (
    <article className="rounded-lg border border-border p-4 text-sm">
      <a
        href={reference.url}
        target="_blank"
        rel="noreferrer"
        className="font-semibold text-primary underline"
      >
        {reference.title} · {reference.citation}
      </a>
      <p className="mt-1 text-muted-foreground">
        {reference.court} · {reference.decidedAt} · {reference.pinpoint}
      </p>
      <p className="mt-3 leading-relaxed">{reference.holding}</p>
      <details className="mt-3">
        <summary className="cursor-pointer">Application and source limits</summary>
        <p className="mt-2">{reference.applicationLimits}</p>
        {reference.textScope && <p className="mt-2">{reference.textScope}</p>}
        <PrivateDataLink
          className="mt-2 block text-primary underline"
          href={reference.textPath}
          target="_blank"
          rel="noreferrer"
        >
          Stored opinion text
        </PrivateDataLink>
        <p className="mt-1 break-all text-xs text-muted-foreground">SHA-256 {reference.sha256}</p>
      </details>
    </article>
  );
}

function RuleEvidence({ snapshot, rule }: { snapshot: LimitationsSnapshot; rule: LimitationRule }) {
  return (
    <article className="rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold">
        {CLAIM_LABELS[rule.claimType]} · {rule.ruleKind.replaceAll("_", " ")}
        {rule.subtype ? " · " + (subtypeLabels[rule.subtype] ?? humanize(rule.subtype)) : ""}
      </h3>
      <p className="mt-2 text-sm leading-relaxed">{rule.summary}</p>
      {rule.conditions.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {rule.conditions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <Citations snapshot={snapshot} rule={rule} />
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer">Rule version and application limits</summary>
        <p className="mt-2">
          {rule.id} · {rule.ruleVersion} · {rule.reviewStatus.replaceAll("_", " ")}
        </p>
        <p>
          {rule.validity} {rule.historicalApplicability}
        </p>
      </details>
    </article>
  );
}

function exportJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatCivilDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));
}

export function LimitationsWorkbench({
  state,
  claim,
  view,
  onNavigate,
}: {
  state: string;
  claim: ClaimType | undefined;
  view: View;
  onNavigate: (next: Navigation) => void;
}) {
  const query = useQuery({
    queryKey: ["limitations-snapshot-1"],
    queryFn: loadLimitations,
    staleTime: Infinity,
  });
  const [input, setInput] = useState<BaselineInput>(() =>
    unconfirmedClaimInput(state, claim ?? ""),
  );
  const [result, setResult] = useState<BaselineResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [issuesExpanded, setIssuesExpanded] = useState(false);
  const [exceptionAnswer, setExceptionAnswer] = useState<"unreviewed" | "issue" | "complete">(
    "unreviewed",
  );
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.focus({ preventScroll: true });
      resultRef.current.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [result]);
  const visibleReasons = (result?.reasons ?? []).filter(
    (reason) =>
      !result?.date ||
      ![
        "This is an unadjusted calendar anniversary, not a verified last day for filing.",
        "Court holidays, closure, commencement/service requirements and local filing cutoffs are not computed.",
      ].includes(reason),
  );
  const update = (patch: Partial<BaselineInput>) => {
    setInput((old) => ({
      ...old,
      ...patch,
      ...(Object.hasOwn(patch, "reposeActDate") ||
      Object.hasOwn(patch, "firstProductDeliveryDate") ||
      Object.hasOwn(patch, "injuryDate") ||
      Object.hasOwn(patch, "substantialCompletionDate") ||
      Object.hasOwn(patch, "accrualDate")
        ? { reposeApplicabilityConfirmed: false }
        : {}),
    }));
    setResult(null);
    setSubmitted(false);
  };
  const navigate = (
    nextView: View = "calculator",
    nextState = state,
    nextClaim: ClaimType | null | undefined = claim,
  ) => onNavigate({ state: nextState, ...(nextClaim ? { claim: nextClaim } : {}), view: nextView });
  if (query.isPending)
    return <p className="py-8 text-base text-muted-foreground">Loading cited state rules…</p>;
  if (query.error || !query.data)
    return (
      <div className={box} role="alert">
        <p>
          Limitations research could not load.{" "}
          {query.error instanceof Error ? query.error.message : "Please retry."}
        </p>
        <Button className="mt-3" variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );

  const snapshot = query.data;
  const selectedClaim = claim ?? "";
  const rule =
    state && selectedClaim
      ? baselineRule(snapshot.rules, state, selectedClaim, input.subtype)
      : null;
  const stateRules = snapshot.rules.filter(
    (item) => item.jurisdiction === state && item.claimType === selectedClaim,
  );
  const subtypes = [
    ...new Set(["general", ...stateRules.map((item) => item.subtype ?? "general")]),
  ];
  const stateSources = snapshot.sources.filter(
    (item) => item.state === state || item.state === "US",
  );
  const stateCases = snapshot.cases.filter(
    (item) => item.jurisdiction === state || item.jurisdiction === "US",
  );
  const stateCoverage = snapshot.coverage.find((item) => item.state === state);
  const retrievedStates = snapshot.coverage.filter(
    (item) => item.sourceStatus === "primary_text_retrieved",
  ).length;
  const dates = guidedDateFields(rule, state, input.subtype);
  const reposeMode = isAccrualReposeRule(rule);
  const reposeLabel = reposeCapLabel(rule);
  const ruleSourceCutoff = rule ? sourceReviewDate(snapshot, rule) : null;
  const missing = missingRequirements(input, rule, dates);
  const missingKeys = submitted ? missing.map((item) => item.id.replace(/^date-/, "")) : [];
  const stateName = STATES.find((item) => item.usps === state)?.name ?? state;
  const calculate = () => {
    setSubmitted(true);
    if (missing.length) {
      document.getElementById(missing[0].id)?.focus();
      return;
    }
    setResult(calculateBaseline(snapshot, input));
  };
  const nav = (
    <nav aria-label="Limitations research views" className="mb-5 flex flex-wrap gap-2">
      {(["calculator", "coverage", "sources"] as const).map((item) => (
        <Button
          key={item}
          size="sm"
          variant={view === item ? "default" : "outline"}
          aria-pressed={view === item}
          onClick={() => navigate(item)}
        >
          {item === "calculator"
            ? "Calculator"
            : item === "coverage"
              ? "State coverage"
              : "Sources"}
        </Button>
      ))}
    </nav>
  );

  return (
    <div>
      {view !== "calculator" && nav}
      {view === "calculator" && (
        <>
          {
            <section className={box}>
              <h2 className="text-xl font-semibold">1. Choose the law and claim</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Rule release {snapshot.ruleVersion}. Source version {snapshot.snapshotDate}. Both
                come from the loaded limitations snapshot.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Select the state law and claim category. Venue or residence alone does not determine
                governing law.
              </p>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  State or District of Columbia
                  <select
                    className={control}
                    value={state}
                    aria-label="Choose governing state"
                    onChange={(event) => navigate("calculator", event.target.value, null)}
                  >
                    <option value="">Choose a state</option>
                    {[...STATES]
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((item) => (
                        <option key={item.usps} value={item.usps}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Claim type
                  <select
                    className={control}
                    value={claim ?? ""}
                    aria-label="Choose claim type"
                    disabled={!state}
                    onChange={(event) =>
                      navigate("calculator", state, (event.target.value as ClaimType) || null)
                    }
                  >
                    <option value="">Choose a claim</option>
                    {CLAIM_TYPES.map((item) => (
                      <option key={item} value={item}>
                        {CLAIM_LABELS[item]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {state && claim && subtypes.length > 1 && (
                <label className="mt-5 block text-sm font-semibold">
                  Fact pattern
                  <select
                    className={control}
                    value={input.subtype ?? "general"}
                    onChange={(event) => {
                      setInput(unconfirmedClaimInput(state, claim, event.target.value));
                      setResult(null);
                      setSubmitted(false);
                      setExceptionAnswer("unreviewed");
                    }}
                  >
                    {subtypes.map((item) => (
                      <option key={item} value={item}>
                        {patternLabel(item)}
                        {baselineRule(snapshot.rules, state, claim, item)
                          ? ""
                          : " · legal review needed"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {state && claim && rule && (
                <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
                  <p className="text-base font-semibold">
                    {rule.period ? periodLabel(rule.period) : "Period requires legal review"}
                  </p>
                  {rule.subtype && rule.subtype !== "general" && (
                    <p className="mt-1 text-sm font-medium">
                      Variant rule: applies only to{" "}
                      {subtypeLabels[rule.subtype] ?? humanize(rule.subtype)}, not to the claim type
                      generally.
                    </p>
                  )}
                  {reposeLabel && <p className="mt-1 text-sm font-medium">{reposeLabel}</p>}
                  <p className="mt-1 text-sm leading-relaxed">{rule.scope}</p>
                  <Citations snapshot={snapshot} rule={rule} />
                </div>
              )}
              {state && claim && !rule && (
                <div className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                  <p>
                    No unique baseline is available for this selection. No date will be calculated.
                  </p>
                  {(() => {
                    const recorded = stateRules.find(
                      (item) =>
                        (item.subtype ?? "general") === (input.subtype ?? "general") &&
                        item.ruleKind === "limitations" &&
                        item.period,
                    );
                    const cell = stateCoverage?.claimCoverage?.find(
                      (item) => item.claimType === claim,
                    );
                    return recorded?.period ? (
                      <div className="mt-3">
                        <p className="font-semibold">
                          Recorded statutory period: {periodLabel(recorded.period)}
                          {recorded.provenance?.entryStatus === "flagged" ? " · open issues" : ""}
                        </p>
                        <Citations snapshot={snapshot} rule={recorded} />
                      </div>
                    ) : (
                      <p className="mt-2 font-medium">
                        Not recorded
                        {cell?.reason ? `: ${cell.reason}` : ": no verified primary-source entry."}
                      </p>
                    );
                  })()}
                </div>
              )}
              {state && claim && !rule && (
                <div className="mt-4">
                  <Button variant="outline" onClick={() => navigate("sources")}>
                    Review sources
                  </Button>
                </div>
              )}
            </section>
          )}

          {state && claim && rule && (
            <section id="limitations-dates" className={box + " mt-5 scroll-mt-24"}>
              <h2 className="text-xl font-semibold">2. Dates and confirmations</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Enter only the dates this rule needs. Leave unknown dates blank; none are inferred.
              </p>
              {
                <>
                  <div className="h-5" />
                  <div className="mb-5 rounded-lg border border-border p-4 text-sm">
                    <h3 className="font-semibold">Supported trigger dates</h3>
                    {rule.effectiveFrom && (
                      <p className="mt-1">
                        Use this branch from {formatCivilDate(rule.effectiveFrom)}. Earlier dates
                        need historical-law review.
                      </p>
                    )}
                    {rule.effectiveThrough && (
                      <p className="mt-1">
                        This branch ends {formatCivilDate(rule.effectiveThrough)}.
                      </p>
                    )}
                    <p className="mt-1 text-muted-foreground">
                      Authorities checked through{" "}
                      {ruleSourceCutoff ? formatCivilDate(ruleSourceCutoff) : "a date not recorded"}
                      .
                      {!rule.effectiveFrom &&
                        " Confirm the statutory version that applies to your dates."}
                    </p>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2">
                    {dates.map((field) => {
                      const value = input[field.key] ?? "";
                      const missing = missingKeys.includes(field.key);
                      return (
                        <label key={field.key} className="block text-sm font-semibold">
                          {field.label}
                          <input
                            id={"date-" + field.key}
                            className={control}
                            type="date"
                            min="1900-01-01"
                            max={snapshot.snapshotDate}
                            value={value}
                            aria-invalid={missing}
                            aria-describedby={
                              field.key + "-help" + (missing ? " " + field.key + "-error" : "")
                            }
                            onChange={(event) => update({ [field.key]: event.target.value })}
                          />
                          <span
                            id={field.key + "-help"}
                            className="mt-1 block text-sm font-normal leading-relaxed text-muted-foreground"
                          >
                            {field.help}
                          </span>
                          {missing && (
                            <span
                              id={field.key + "-error"}
                              className="mt-1 block text-sm font-medium text-destructive"
                            >
                              Enter this date to continue.
                            </span>
                          )}
                        </label>
                      );
                    })}
                    {rule.calculation?.deathCapYears && (
                      <>
                        <label className="block text-sm font-semibold">
                          Is the injured person living?
                          <select
                            className={control}
                            value={input.vitalStatus ?? "unknown"}
                            onChange={(event) =>
                              update({
                                vitalStatus: event.target.value as NonNullable<
                                  BaselineInput["vitalStatus"]
                                >,
                                deathDate: "",
                              })
                            }
                          >
                            <option value="unknown">Select status</option>
                            <option value="alive">Alive</option>
                            <option value="deceased">Deceased</option>
                          </select>
                        </label>
                        {input.vitalStatus === "deceased" && (
                          <label className="block text-sm font-semibold">
                            Date of death
                            <input
                              id="date-deathDate"
                              className={control}
                              type="date"
                              min="1900-01-01"
                              max={snapshot.snapshotDate}
                              value={input.deathDate ?? ""}
                              aria-invalid={missingKeys.includes("deathDate")}
                              onChange={(event) => update({ deathDate: event.target.value })}
                            />
                            {missingKeys.includes("deathDate") && (
                              <span className="mt-1 block text-sm text-destructive">
                                Enter this date to continue.
                              </span>
                            )}
                          </label>
                        )}
                      </>
                    )}
                  </div>
                  <fieldset className="mt-7 space-y-3">
                    <legend className="mb-3 text-base font-semibold">Confirm</legend>
                    {reposeMode && (
                      <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
                        <input
                          id="repose-applicability-confirmed"
                          type="checkbox"
                          className="mt-1 h-4 w-4"
                          checked={input.reposeApplicabilityConfirmed === true}
                          onChange={(event) =>
                            update({ reposeApplicabilityConfirmed: event.target.checked })
                          }
                        />
                        <span>
                          This repose rule applies to this claim and defendant, and the repose date
                          above is legally relevant.
                        </span>
                      </label>
                    )}
                    {(
                      [
                        [
                          "governingLawConfirmed",
                          "I checked that this state’s law governs, including transfer, direct-filing, or borrowing-law questions.",
                        ],
                        [
                          "accrualConfirmed",
                          "I checked the legally relevant start or discovery dates under the cited rule.",
                        ],
                        [
                          "applicabilityConfirmed",
                          "I checked that this claim category, statutory version, and listed conditions fit these facts.",
                        ],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key} className="text-sm leading-relaxed">
                        <label className="flex min-h-11 items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={input[key]}
                            onChange={(event) => update({ [key]: event.target.checked })}
                          />
                          <span>{label}</span>
                        </label>
                        {key === "applicabilityConfirmed" && rule && (
                          <details className="ml-7 mt-1 rounded-md border border-border px-3">
                            <summary className="min-h-10 cursor-pointer py-2 font-medium">
                              Check this rule’s conditions
                            </summary>
                            <div className="pb-3 text-sm">
                              {rule.conditions.length > 0 ? (
                                <ul className="list-disc space-y-1 pl-5">
                                  {rule.conditions.map((condition) => (
                                    <li key={condition}>{condition}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p>No additional conditions are recorded for this rule.</p>
                              )}
                              {rule.exclusions.length > 0 && (
                                <>
                                  <p className="mt-3 font-semibold">Exclusions</p>
                                  <ul className="mt-1 list-disc space-y-1 pl-5">
                                    {rule.exclusions.map((exclusion) => (
                                      <li key={exclusion}>{exclusion}</li>
                                    ))}
                                  </ul>
                                </>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </fieldset>
                  <fieldset className="mt-7">
                    <legend className="text-base font-semibold">
                      Any tolling or exception facts?
                    </legend>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      For example prior filings or orders, tolling, age or disability, other-state
                      law, or special claim requirements. Anything unresolved means no date.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
                      {(
                        [
                          ["complete", "No"],
                          ["issue", "Yes"],
                          ["unreviewed", "Not sure"],
                        ] as const
                      ).map(([answer, label]) => (
                        <Button
                          key={answer}
                          type="button"
                          size="sm"
                          role="radio"
                          aria-checked={exceptionAnswer === answer}
                          variant={exceptionAnswer === answer ? "default" : "outline"}
                          disabled={answer === "complete" && input.issues.length > 0}
                          onClick={() => {
                            setExceptionAnswer(answer);
                            setIssuesExpanded(answer === "issue");
                            update({
                              exceptionReview:
                                answer === "complete" && input.issues.length === 0
                                  ? "no_unresolved_issues"
                                  : "unresolved",
                            });
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    {issuesExpanded && (
                      <div className="mt-3 grid gap-3 rounded-lg border border-border p-4 md:grid-cols-2">
                        {SPECIAL_ISSUES.map((issue) => (
                          <label
                            key={issue.id}
                            className="flex min-h-11 items-start gap-3 text-sm leading-relaxed"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={input.issues.includes(issue.id)}
                              onChange={(event) => (
                                event.target.checked && setExceptionAnswer("issue"),
                                update({
                                  issues: event.target.checked
                                    ? [...input.issues, issue.id]
                                    : input.issues.filter((item) => item !== issue.id),
                                  exceptionReview: "unresolved",
                                })
                              )}
                            />
                            <span>{issue.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                  <div className="mt-8 flex flex-wrap items-start justify-between gap-3">
                    <div className="text-sm">
                      {missing.length > 0 ? (
                        <>
                          <p className="font-semibold">Still needed before calculating:</p>
                          <ul className="mt-1 space-y-1">
                            {missing.map((item) => (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  className="text-left text-primary underline"
                                  onClick={() => document.getElementById(item.id)?.focus()}
                                >
                                  {item.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="text-muted-foreground">
                          Unchecked confirmations or unresolved exceptions produce no date.
                        </p>
                      )}
                    </div>
                    <Button type="button" disabled={missing.length > 0} onClick={calculate}>
                      Calculate
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}

          {result && (
            <section
              ref={resultRef}
              tabIndex={-1}
              id="limitations-result"
              aria-live="polite"
              className={
                "scroll-mt-56 rounded-2xl border-2 p-6 outline-none " +
                (result.date ? "border-primary bg-primary/5" : "border-warning/60 bg-warning/5")
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {result.date ? "Statutory anniversary · conditional" : "No date issued"}
                  </p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight">
                    {result.date ? (
                      <time dateTime={result.date}>{formatCivilDate(result.date)}</time>
                    ) : result.status === "invalid" ? (
                      "Check the information"
                    ) : (
                      "Legal review needed"
                    )}
                  </h2>
                  {result.date && (
                    <div className="mt-2 space-y-1 text-sm">
                      <p className="font-medium">
                        Unadjusted calendar anniversary · not a verified filing deadline
                      </p>
                      <p>
                        Check court calendars, filing and service requirements, and local cutoffs.
                      </p>
                      {result.adjustedDate && (
                        <div className="rounded-md border border-border bg-background p-2 font-medium">
                          This date falls on a weekend. Under{" "}
                          <StatuteCitation state={state} citation={result.adjustedDate.citation} />{" "}
                          the period extends to{" "}
                          <time dateTime={result.adjustedDate.date}>
                            {formatCivilDate(result.adjustedDate.date)}
                          </time>
                          . Legal holidays are not computed.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    document
                      .getElementById("limitations-dates")
                      ?.scrollIntoView({ block: "start", behavior: "instant" })
                  }
                >
                  Edit answers
                </Button>
              </div>
              {result.rule && (
                <div className="mt-5 rounded-lg bg-background p-4">
                  <p className="text-sm font-semibold">
                    {stateName} · {claim ? CLAIM_LABELS[claim] : ""} ·{" "}
                    {result.rule.period
                      ? periodLabel(result.rule.period)
                      : "Period requires review"}
                  </p>
                  {reposeCapLabel(result.rule) && (
                    <p className="mt-1 text-sm font-medium">{reposeCapLabel(result.rule)}</p>
                  )}
                  <Citations snapshot={snapshot} rule={result.rule} />
                </div>
              )}
              {visibleReasons.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-base font-semibold">
                    {result.date ? "Cautions" : "What needs attention"}
                  </h3>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                    {visibleReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="mt-5 rounded-lg border border-border bg-background p-4">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
                  Calculation steps and assumptions
                </summary>
                <p className="mt-2 text-sm">
                  Governing law: {input.governingLawConfirmed ? "marked checked" : "not confirmed"};
                  start dates: {input.accrualConfirmed ? "marked checked" : "not confirmed"}; rule
                  applicability: {input.applicabilityConfirmed ? "marked checked" : "not confirmed"}
                  ; exception review:{" "}
                  {exceptionAnswer === "complete"
                    ? "marked complete"
                    : exceptionAnswer === "issue"
                      ? "an issue may apply"
                      : "not reviewed"}
                  .{input.issues.length ? " Selected issues require separate review." : ""} These
                  are user-provided confirmations, not independent verification.
                </p>
                {result.steps.length > 0 && (
                  <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                    {result.steps.map((item, index) => (
                      <li key={index}>
                        {item.text}
                        <p className="mt-1 text-sm text-muted-foreground">{item.pinpoint}</p>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-3 text-sm text-muted-foreground">
                  Rule version {result.rule?.ruleVersion ?? "not recorded"} · required authority
                  review through{" "}
                  {result.rule
                    ? (sourceReviewDate(snapshot, result.rule) ?? "not recorded")
                    : "not applicable"}
                  .
                </p>
              </details>
            </section>
          )}

          {state && claim && (
            <details className="mt-5 rounded-xl border border-border bg-surface p-5">
              <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">
                Sources &amp; methodology
              </summary>
              <p className="mt-3 text-sm leading-relaxed">
                {snapshot.reviewMeaning} Source version: {snapshot.snapshotDate}. Retrieval and
                legal review are separate.
              </p>
              <div className="mt-4 space-y-3">
                {stateRules.map((item) => (
                  <RuleEvidence key={item.id} snapshot={snapshot} rule={item} />
                ))}
                {!stateRules.length && (
                  <p className="text-sm">Claim-specific source review is pending.</p>
                )}
              </div>
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
                  Coverage and source inventory
                </summary>
                <p className="mt-2 text-sm">
                  {retrievedStates} of 51 jurisdictions have primary text retrieved ·{" "}
                  {snapshot.rules.length} cited rule records.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <Button size="sm" variant="outline" onClick={() => navigate("coverage")}>
                    All-state coverage
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => navigate("sources")}>
                    Source snapshots
                  </Button>
                  <PrivateDataLink
                    href="/data/limitations/rules.json"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center text-sm text-primary underline"
                  >
                    Versioned rules
                  </PrivateDataLink>
                  <PrivateDataLink
                    href="/data/limitations/sources.json"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center text-sm text-primary underline"
                  >
                    Source manifest
                  </PrivateDataLink>
                </div>
              </details>
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
                  Historical third-party summaries
                </summary>
                <p className="text-sm leading-relaxed">
                  These historical records are secondary context and do not replace the cited
                  current rule or case-specific legal review.
                </p>
                <a
                  href="/law?ds=limitation_periods"
                  className="mt-2 inline-block min-h-10 py-2 text-sm font-medium text-primary underline"
                >
                  Browse historical limitation-period records
                </a>
              </details>
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
                  MDL, transfer, and prior filing considerations
                </summary>
                <p className="mt-2 text-sm leading-relaxed">
                  Centralization coordinates pretrial proceedings. Transferor forum, governing state
                  law, direct-filing terms, and prior orders require separate analysis. A master
                  complaint, registry entry, or MDL transfer is not treated as proof of tolling or a
                  timely individual claim.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {snapshot.sources
                    .filter((item) => item.state === "US")
                    .map((item) => (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary underline"
                      >
                        {item.title}
                      </a>
                    ))}
                </div>
                <div className="mt-3 space-y-3">
                  {snapshot.cases
                    .filter((item) => item.jurisdiction === "US")
                    .map((item) => (
                      <JudicialEvidence key={item.id} reference={item} />
                    ))}
                </div>
              </details>
              <Button
                className="mt-4"
                size="sm"
                variant="outline"
                onClick={() =>
                  exportJson(
                    {
                      schemaVersion: snapshot.schemaVersion,
                      snapshotDate: snapshot.snapshotDate,
                      ruleVersion: snapshot.ruleVersion,
                      rules: stateRules,
                      sources: stateSources,
                      cases: stateCases,
                      coverage: stateCoverage,
                    },
                    "limitations-research.json",
                  )
                }
              >
                Export research details
              </Button>
            </details>
          )}
        </>
      )}

      {view === "coverage" && (
        <section className={box}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Coverage by state and DC</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportJson(snapshot.coverage, "limitations-all-state-coverage.json")}
            >
              Export coverage
            </Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed">
            Source retrieval and computation are separate. Coverage does not represent a complete
            legal review.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-3">Jurisdiction</th>
                  <th className="p-3">Primary text</th>
                  <th className="p-3">Conditional baselines</th>
                  <th className="p-3">Coverage and unresolved work</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.coverage.map((item) => (
                  <tr key={item.state} className="border-b border-border align-top">
                    <td className="p-3">
                      <button
                        className="min-h-10 text-primary underline"
                        onClick={() => {
                          navigate("calculator", item.state, claim);
                          setStep(1);
                        }}
                      >
                        {item.name}
                      </button>
                      {item.publisherLinks.slice(0, 2).map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block text-primary underline"
                        >
                          {source.title}
                        </a>
                      ))}
                    </td>
                    <td className="p-3">
                      {item.sourceIds.length
                        ? item.sourceIds.length + " source records"
                        : "Retrieval pending"}
                    </td>
                    <td className="p-3">
                      {item.baselineRuleIds.length || "No reviewed branch"}
                      {item.claimCoverage && (
                        <ul className="mt-2 space-y-1 text-xs" aria-label="Coverage by claim type">
                          {item.claimCoverage.map((cell) => (
                            <li key={cell.claimType}>
                              {CLAIM_LABELS[cell.claimType]}:{" "}
                              <span className="font-medium">
                                {cell.status === "baseline"
                                  ? "baseline"
                                  : cell.status === "research_only"
                                    ? "period recorded, no date"
                                    : cell.status === "flagged"
                                      ? "recorded with open issues"
                                      : "Not recorded"}
                              </span>
                              {cell.grade ? ` · ${VERIFICATION_GRADE_LABELS[cell.grade]}` : ""}
                              {cell.variants?.length
                                ? ` · ${cell.variants.length} narrow variant${cell.variants.length === 1 ? "" : "s"} selectable`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="p-3">
                      <details>
                        <summary className="min-h-10 cursor-pointer py-2">
                          {item.coverage.replaceAll("_", " ")}
                        </summary>
                        <ul className="mt-2 list-disc pl-5">
                          {item.gaps.map((gap) => (
                            <li key={gap}>{gap}</li>
                          ))}
                        </ul>
                        {item.metadataOnlyReferences.map((ref) => (
                          <p key={ref.url} className="mt-2">
                            <a
                              href={ref.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline"
                            >
                              {ref.title} · {ref.format}
                            </a>{" "}
                            · {ref.note}
                          </p>
                        ))}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === "sources" && (
        <section className={box}>
          <h2 className="text-xl font-semibold">Sources · {stateName || "choose a state"}</h2>
          <p className="mt-2 text-sm leading-relaxed">
            Read the stored source text and review its capture details.
          </p>
          {stateCoverage && !stateSources.some((item) => item.state === state) && (
            <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
              <p>State-specific text capture is pending. Official publication sources:</p>
              {stateCoverage.publisherLinks.map((item) => (
                <a
                  key={item.url}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block text-primary underline"
                >
                  {item.title} · {item.status.replaceAll("_", " ")}
                </a>
              ))}
              {stateCoverage.metadataOnlyReferences.map((item) => (
                <p key={item.url} className="mt-2">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {item.title}
                  </a>{" "}
                  · {item.note}
                </p>
              ))}
            </div>
          )}
          <details className="mt-5">
            <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">
              Judicial references · {stateCases.length}
            </summary>
            <div className="mt-3 space-y-3">
              {stateCases.map((item) => (
                <JudicialEvidence key={item.id} reference={item} />
              ))}
            </div>
          </details>
          <div className="mt-5 space-y-4">
            {stateSources.map((item) => (
              <article key={item.id} className="rounded-lg border border-border p-4">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-base font-semibold text-primary underline"
                >
                  {item.title}
                </a>
                <p className="mt-1 text-sm">
                  {item.authorityKind.replaceAll("_", " ")} · {item.publisher} · captured{" "}
                  {item.capturedAt.slice(0, 10)}
                </p>
                <PrivateDataLink
                  href={item.textPath}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm text-primary underline"
                >
                  Inspect stored text
                </PrivateDataLink>
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="min-h-9 cursor-pointer py-2">Capture details</summary>
                  <p>Retrieved {item.capturedAt}</p>
                  <p>{item.method}</p>
                  <p className="break-all">
                    SHA-256 {item.sha256} · {item.byteLength.toLocaleString()} bytes · schema{" "}
                    {item.schemaVersion}
                  </p>
                </details>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
