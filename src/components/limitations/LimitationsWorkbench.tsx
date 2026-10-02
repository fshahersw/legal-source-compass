import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { STATES } from "@/lib/corpus/geo";
import { loadLimitations } from "@/lib/limitations/load";
import { baselineRule, calculateBaseline } from "@/lib/limitations/engine";
import { guidedDateFields, unconfirmedClaimInput } from "./calculatorGuidance";
import {
  CLAIM_LABELS,
  CLAIM_TYPES,
  SPECIAL_ISSUES,
  type BaselineInput,
  type BaselineResult,
  type ClaimType,
  type JudicialReference,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";

const control =
  "mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-[13px]";
const box = "rounded-xl border border-border bg-surface p-4";
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

function JudicialEvidence({ reference }: { reference: JudicialReference }) {
  return (
    <article className="rounded-md border border-border p-3 text-[12px]">
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
      <p className="mt-2 leading-relaxed">{reference.holding}</p>
      <details className="mt-2 text-muted-foreground">
        <summary className="cursor-pointer">Application and source limits</summary>
        <p className="mt-2">{reference.applicationLimits}</p>
        <p className="mt-1">
          Subsequent treatment: {reference.subsequentTreatment.replaceAll("_", " ")}. Copy:{" "}
          {reference.copyPublisher}.
        </p>
        <a
          className="mt-1 block text-primary underline"
          href={reference.textPath}
          target="_blank"
          rel="noreferrer"
        >
          Stored opinion text
        </a>
        <p className="mt-1 break-all">SHA-256: {reference.sha256}</p>
        {reference.officialPdfUrl && (
          <a
            className="mt-1 block text-primary underline"
            href={reference.officialPdfUrl}
            target="_blank"
            rel="noreferrer"
          >
            Official opinion PDF URL · metadata only, not downloaded
          </a>
        )}
      </details>
    </article>
  );
}

function exportJson(value: unknown, name: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Citations({ snapshot, rule }: { snapshot: LimitationsSnapshot; rule: LimitationRule }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
      {rule.sourceIds.map((id) => {
        const source = snapshot.sources.find((s) => s.id === id);
        return source ? (
          <a
            key={id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {source.title}
          </a>
        ) : (
          <span key={id}>Source not recorded</span>
        );
      })}
      <span className="text-muted-foreground">{rule.pinpoint}</span>
      {rule.caseReferenceIds?.map((id) => {
        const reference = snapshot.cases.find((c) => c.id === id);
        return reference ? (
          <a
            key={id}
            href={reference.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {reference.citation}
          </a>
        ) : null;
      })}
    </div>
  );
}

function RuleEvidence({ snapshot, rule }: { snapshot: LimitationsSnapshot; rule: LimitationRule }) {
  return (
    <article className={box}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[14px] font-semibold">
          {CLAIM_LABELS[rule.claimType]} · {rule.ruleKind.replaceAll("_", " ")}
          {rule.subtype ? ` · ${subtypeLabels[rule.subtype] ?? rule.subtype}` : ""}
        </h3>
        <span className="rounded bg-muted px-2 py-1 text-[10px]">
          {rule.computation === "baseline_only" ? "Conditional baseline" : "Further legal review"}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed">{rule.summary}</p>
      {rule.conditions.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
          {rule.conditions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {rule.ruleKind === "validity" && (
        <p className="mt-2 rounded border border-warning/40 bg-warning/10 p-2 text-[12px]">
          {rule.validity}
        </p>
      )}
      <Citations snapshot={snapshot} rule={rule} />
      <details className="mt-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Rule version & application limits</summary>
        <p className="mt-2">
          {rule.id} · {rule.ruleVersion} · {rule.reviewStatus.replaceAll("_", " ")}
        </p>
        <p className="mt-1">
          {rule.validity}. {rule.historicalApplicability}.
        </p>
        <p className="mt-1">
          Effective window: {rule.effectiveFrom ?? "Not independently established"} →{" "}
          {rule.effectiveThrough ?? "Not independently established"}.
        </p>
        {rule.exclusions.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {rule.exclusions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}

function Result({
  snapshot,
  result,
  input,
}: {
  snapshot: LimitationsSnapshot;
  result: BaselineResult;
  input: BaselineInput;
}) {
  return (
    <section
      aria-live="polite"
      className={`${box} mt-4 ${result.status === "baseline" ? "border-primary/40" : "border-warning/40"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="eyebrow">
            {result.status === "baseline" ? "Conditional calendar baseline" : "No date issued"}
          </div>
          <h2 className="mt-2 text-2xl">
            {result.date ??
              (result.status === "invalid" ? "Check the dates" : "Legal facts need review")}
          </h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            exportJson(
              {
                schemaVersion: snapshot.schemaVersion,
                snapshotDate: snapshot.snapshotDate,
                ruleVersion: snapshot.ruleVersion,
                facts: input,
                analysis: result,
                sources: snapshot.sources.filter((s) => result.rule?.sourceIds.includes(s.id)),
                cases: snapshot.cases.filter((c) => result.rule?.caseReferenceIds?.includes(c.id)),
              },
              "limitations-analysis.json",
            )
          }
        >
          Export cited analysis
        </Button>
      </div>
      {result.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px]">
          {result.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {result.steps.length > 0 && (
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-[13px]">
          {result.steps.map((step, i) => (
            <li key={i}>
              {step.text}
              <div className="mt-1 text-[11px] text-muted-foreground">{step.pinpoint}</div>
            </li>
          ))}
        </ol>
      )}
      {result.rule && <Citations snapshot={snapshot} rule={result.rule} />}
      <p className="mt-3 text-[12px] text-muted-foreground">
        {STATES.find((state) => state.usps === input.jurisdiction)?.name} ·{" "}
        {CLAIM_LABELS[input.claimType]} · source version {snapshot.snapshotDate}.
        {result.status === "baseline"
          ? " Governing law, the legal start dates, rule applicability and exception review were explicitly confirmed for this result. Calendar, filing and service adjustments still require verification."
          : " A date stays withheld while required dates or legal facts remain unresolved."}
      </p>
    </section>
  );
}

export function LimitationsWorkbench({
  initialState,
  initialClaim,
  initialView,
}: {
  initialState: string;
  initialClaim: ClaimType | undefined;
  initialView: "calculator" | "coverage" | "sources";
}) {
  const query = useQuery({
    queryKey: ["limitations-snapshot-1"],
    queryFn: loadLimitations,
    staleTime: Infinity,
  });
  const [state, setState] = useState(initialState),
    [claim, setClaim] = useState<ClaimType | "">(initialClaim ?? ""),
    [view, setView] = useState(initialView);
  const empty = (): BaselineInput => unconfirmedClaimInput(state, claim);
  const [showIssues, setShowIssues] = useState(false);
  const [input, setInput] = useState<BaselineInput>(empty),
    [result, setResult] = useState<BaselineResult | null>(null);
  const update = (patch: Partial<BaselineInput>) => {
    setInput((previous) => ({ ...previous, ...patch }));
    setResult(null);
  };
  const reset = (jurisdiction: string, claimType: ClaimType | "", subtype = "general") => {
    setInput(unconfirmedClaimInput(jurisdiction, claimType, subtype));
    setShowIssues(false);
    setResult(null);
  };
  if (query.isPending)
    return (
      <p className="py-8 text-[13px] text-muted-foreground">
        Loading statutory sources and coverage inventory…
      </p>
    );
  if (query.error || !query.data)
    return (
      <div className={box}>
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
  const rule = state && claim ? baselineRule(snapshot.rules, state, claim, input.subtype) : null;
  const stateRules = snapshot.rules.filter(
    (r) => r.jurisdiction === state && r.claimType === claim,
  );
  const subtypes = [...new Set(["general", ...stateRules.map((r) => r.subtype ?? "general")])];
  const stateSources = snapshot.sources.filter((s) => s.state === state || s.state === "US");
  const stateCases = snapshot.cases.filter(
    (c) => c.jurisdiction === state || c.jurisdiction === "US",
  );
  const stateCoverage = snapshot.coverage.find((c) => c.state === state);
  const sourceStates = snapshot.coverage.filter(
    (c) => c.sourceStatus === "primary_text_retrieved",
  ).length;
  const dates = guidedDateFields(rule, state, input.subtype);
  const researchNavigation = (
    <details className={`${box} mb-4`} open={view !== "calculator"}>
      <summary className="cursor-pointer text-[13px] font-medium">
        Research sources, coverage and versions
      </summary>
      <div className="mb-4 mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Jurisdiction inventory", "51"],
          ["Primary text retrieved", `${sourceStates} / 51`],
          ["Cited rule records", String(snapshot.rules.length)],
          ["Source version", snapshot.snapshotDate],
        ].map(([label, value]) => (
          <div key={label} className={box}>
            <div className="eyebrow">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <nav aria-label="Limitations views" className="mb-4 flex flex-wrap gap-2">
        {(["calculator", "coverage", "sources"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "default" : "outline"}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === "calculator"
              ? "Back to calculator"
              : v === "coverage"
                ? "All-state coverage"
                : "Statutory sources"}
          </Button>
        ))}
      </nav>
      <p className="text-[12px] text-muted-foreground">{snapshot.reviewMeaning}</p>
    </details>
  );
  const mdlContext = (
    <details className={`${box} mb-4`}>
      <summary className="cursor-pointer text-[13px] font-medium">
        How MDL transfer, direct filing and prior filings affect this research
      </summary>
      <p className="mt-2 text-[13px] leading-relaxed">
        Centralization is for coordinated or consolidated pretrial proceedings. The transferor
        forum, governing state law, direct-filing terms and prior orders require separate analysis.
        A master complaint, registry entry or MDL transfer is not treated here as proof of tolling
        or a timely individual claim.
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
        {snapshot.sources
          .filter((s) => s.state === "US")
          .map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {s.title}
            </a>
          ))}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] font-medium">
          Primary decisions on transfer, direct filing and governing law
        </summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {snapshot.cases
            .filter((c) => c.jurisdiction === "US")
            .map((reference) => (
              <JudicialEvidence key={reference.id} reference={reference} />
            ))}
        </div>
      </details>
    </details>
  );
  return (
    <div>
      {view !== "calculator" && researchNavigation}
      <div className="mb-4 rounded-xl border border-primary/25 bg-primary/5 p-4 text-[13px] leading-relaxed">
        <strong>A cited starting point for review.</strong> Any date shown is a conditional calendar
        baseline, not a verified filing deadline. Required legal facts and exceptions must be
        checked first. Sources captured through {snapshot.snapshotDate}.
      </div>

      {view !== "coverage" && (
        <section className={`${box} mb-4`} aria-label="Choose state and claim">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[12px] font-medium">
              1. Which state's law are you reviewing?
              <select
                className={control}
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  reset(e.target.value, claim);
                }}
              >
                <option value="">Choose a state or DC</option>
                {[...STATES]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.usps} value={s.usps}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <span className="mt-2 block font-normal text-muted-foreground">
                Residence, injury location and MDL venue do not automatically select the governing
                law.
              </span>
            </label>
            {state && (
              <label className="text-[12px] font-medium">
                2. What type of claim?
                <select
                  className={control}
                  value={claim}
                  onChange={(e) => {
                    const c = e.target.value as ClaimType;
                    setClaim(c);
                    reset(state, c);
                  }}
                >
                  <option value="">Choose a claim type</option>
                  {CLAIM_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {CLAIM_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>
      )}
      {view === "calculator" && state && claim && (
        <>
          <form
            className={box}
            onSubmit={(e) => {
              e.preventDefault();
              setResult(calculateBaseline(snapshot, input));
            }}
          >
            <h2 className="text-base font-semibold">3. Enter the dates this rule needs</h2>
            {subtypes.length > 1 && (
              <label className="mt-3 block text-[12px] font-medium">
                Which fact pattern fits this claim?
                <select
                  className={control}
                  value={input.subtype ?? "general"}
                  onChange={(e) => reset(state, claim, e.target.value)}
                >
                  {subtypes.map((s) => (
                    <option key={s} value={s}>
                      {subtypeLabels[s] ?? s}
                      {baselineRule(snapshot.rules, state, claim, s) ? "" : " · needs legal review"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {rule ? (
              <div className="mt-3 rounded-md border border-border bg-muted/35 p-3">
                <p className="text-[13px] font-medium">
                  {rule.period
                    ? `${rule.period.amount} calendar years`
                    : "Period requires legal review"}{" "}
                  · conditional statutory baseline
                </p>
                <p className="mt-1 text-[13px]">{rule.scope}</p>
                <Citations snapshot={snapshot} rule={rule} />
                {rule.conditions.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
                    {rule.conditions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div
                role="status"
                className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px]"
              >
                <p>
                  This claim and fact pattern need further legal review. No uniquely supported rule
                  is available, so no date will be calculated.
                </p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setView("sources")}
                >
                  View this state's sources
                </Button>
              </div>
            )}
            {rule && (
              <>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {dates.map((d) => (
                    <label key={d.key} className="text-[12px] font-medium">
                      {d.label}
                      <input
                        className={control}
                        type="date"
                        aria-required="true"
                        aria-describedby={`date-help-${d.key}`}
                        value={(input as unknown as Record<string, string>)[d.key] ?? ""}
                        min="1900-01-01"
                        max={snapshot.snapshotDate}
                        onChange={(e) => update({ [d.key]: e.target.value })}
                      />
                      <span
                        id={`date-help-${d.key}`}
                        className="mt-1 block font-normal leading-relaxed text-muted-foreground"
                      >
                        {d.help}
                      </span>
                    </label>
                  ))}
                </div>
                {rule?.calculation?.deathCapYears && (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-[12px] font-medium">
                      Is the injured person living?
                      <select
                        className={control}
                        value={input.vitalStatus ?? "unknown"}
                        onChange={(e) =>
                          update({
                            vitalStatus: e.target.value as NonNullable<
                              BaselineInput["vitalStatus"]
                            >,
                            deathDate: "",
                          })
                        }
                      >
                        <option value="unknown">Choose a status · required for this rule</option>
                        <option value="alive">Alive</option>
                        <option value="deceased">Deceased</option>
                      </select>
                    </label>
                    {input.vitalStatus === "deceased" && (
                      <label className="text-[12px] font-medium">
                        Date of death · required for this rule's cap
                        <input
                          type="date"
                          className={control}
                          value={input.deathDate ?? ""}
                          max={snapshot.snapshotDate}
                          onChange={(e) => update({ deathDate: e.target.value })}
                        />
                      </label>
                    )}
                  </div>
                )}
                <fieldset className="mt-5 space-y-3">
                  <legend className="mb-2 text-[13px] font-semibold">
                    4. Check the legal facts before calculating
                  </legend>
                  {(
                    [
                      [
                        "governingLawConfirmed",
                        "I have checked that this state's law governs the claim, including any transfer, direct-filing or borrowing issues.",
                      ],
                      [
                        "accrualConfirmed",
                        "I have verified the start / discovery dates under the cited rule, rather than assuming the exposure or diagnosis date applies.",
                      ],
                      [
                        "applicabilityConfirmed",
                        "I have checked that this claim type, statutory version and the listed rule conditions apply to these facts.",
                      ],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-start gap-2 text-[12px] leading-relaxed">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={input[key]}
                        onChange={(e) => update({ [key]: e.target.checked })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="mt-5">
                  <legend className="mb-2 text-[13px] font-semibold">
                    Has the exception review been completed?
                  </legend>
                  <p
                    id="exception-help"
                    className="mb-2 text-[12px] leading-relaxed text-muted-foreground"
                  >
                    Check tolling, age or disability, product repose, earlier filings or MDL orders,
                    other states' law and special claims. An unresolved issue prevents a date.
                  </p>
                  <select
                    className={control}
                    aria-label="Exception review status"
                    aria-describedby="exception-help"
                    value={
                      input.exceptionReview === "no_unresolved_issues"
                        ? "none"
                        : showIssues || input.issues.length
                          ? "issues"
                          : ""
                    }
                    onChange={(e) => {
                      setShowIssues(e.target.value === "issues");
                      update({
                        exceptionReview:
                          e.target.value === "none" && !input.issues.length
                            ? "no_unresolved_issues"
                            : "unresolved",
                      });
                    }}
                  >
                    <option value="">Not reviewed / not sure</option>
                    <option value="issues">An issue may apply · review required</option>
                    <option value="none" disabled={input.issues.length > 0}>
                      Review completed · no unresolved issues
                    </option>
                  </select>
                  <details
                    className="mt-3 rounded-md border border-border p-3"
                    open={showIssues || input.issues.length > 0}
                    onToggle={(e) => setShowIssues(e.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-[12px] font-medium">
                      Review the possible exceptions and special claims
                    </summary>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {SPECIAL_ISSUES.map((issue) => (
                        <label
                          key={issue.id}
                          className="flex items-start gap-2 text-[12px] leading-relaxed"
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={input.issues.includes(issue.id)}
                            onChange={(e) =>
                              update({
                                issues: e.target.checked
                                  ? [...input.issues, issue.id]
                                  : input.issues.filter((x) => x !== issue.id),
                                exceptionReview: "unresolved",
                              })
                            }
                          />
                          <span>{issue.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                </fieldset>
                <Button className="mt-4" type="submit">
                  Check cited baseline
                </Button>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  No date is issued until every required date and legal assumption is confirmed.
                  Court calendars, filing, service and cutoff adjustments still need separate
                  verification.
                </p>
              </>
            )}
          </form>
          {result && <Result snapshot={snapshot} result={result} input={input} />}
          <details className={`${box} mt-6`}>
            <summary className="cursor-pointer text-[13px] font-medium">
              Detailed authority and claim research · {STATES.find((s) => s.usps === state)?.name}
            </summary>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {STATES.find((s) => s.usps === state)?.name} · cited claim evidence
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  exportJson(
                    {
                      schemaVersion: snapshot.schemaVersion,
                      snapshotDate: snapshot.snapshotDate,
                      rules: stateRules,
                      sources: stateSources,
                      cases: stateCases,
                      coverage: stateCoverage,
                    },
                    `limitations-${state}-${claim}.json`,
                  )
                }
              >
                Export rule evidence
              </Button>
            </div>
            <div className="space-y-3">
              {stateRules.map((r) => (
                <RuleEvidence key={r.id} snapshot={snapshot} rule={r} />
              ))}
              {!stateRules.length && (
                <p className={box}>
                  Claim-level primary-source review is pending. Consult the statutory-source and
                  all-state inventory views.
                </p>
              )}
            </div>
          </details>
        </>
      )}
      {view === "coverage" && (
        <section className={box}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">50 states + District of Columbia</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportJson(snapshot.coverage, "limitations-all-state-coverage.json")}
            >
              Export coverage inventory
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Source retrieval and computation are separate. No state is represented as having a
            complete legal review.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2">Jurisdiction</th>
                  <th className="p-2">Primary text</th>
                  <th className="p-2">Conditional baselines</th>
                  <th className="p-2">Coverage & unresolved work</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.coverage.map((c) => (
                  <tr key={c.state} className="border-b border-border align-top">
                    <td className="p-2">
                      <button
                        className="text-primary underline"
                        onClick={() => {
                          setState(c.state);
                          reset(c.state, claim);
                          setView("calculator");
                        }}
                      >
                        {c.name}
                      </button>
                      {c.publisherLinks.slice(0, 2).map((p) => (
                        <a
                          key={p.url}
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block text-primary underline"
                        >
                          {p.title}
                        </a>
                      ))}
                      <div className="mt-1">
                        <a
                          href={c.discoverySource}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground underline"
                        >
                          DOJ source directory
                        </a>
                      </div>
                    </td>
                    <td className="p-2">
                      {c.sourceIds.length
                        ? `${c.sourceIds.length} source records`
                        : "Retrieval pending"}
                    </td>
                    <td className="p-2">{c.baselineRuleIds.length || "No reviewed branch"}</td>
                    <td className="p-2">
                      <details>
                        <summary className="cursor-pointer">
                          {c.coverage.replaceAll("_", " ")}
                        </summary>
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          {c.gaps.map((g) => (
                            <li key={g}>{g}</li>
                          ))}
                        </ul>
                        {c.metadataOnlyReferences.map((m) => (
                          <p key={m.url} className="mt-2">
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline"
                            >
                              {m.title} · {m.format} URL only
                            </a>{" "}
                            — {m.note}
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
          <h2 className="text-base font-semibold">
            Source snapshots · {state} and federal context
          </h2>
          <p className="mt-2 text-[12px] text-muted-foreground">
            The stored statute text is an extraction of official HTML or XML, with its own SHA-256.
            It is not a downloaded PDF or a claim that all historical amendments and case law have
            been verified.
          </p>
          {!stateSources.some((s) => s.state === state) && stateCoverage && (
            <div className="mt-3 rounded-md border border-warning/40 p-3 text-[12px]">
              <p>
                Statutory text capture is pending. Official publication routes and format
                constraints:
              </p>
              {stateCoverage.publisherLinks.map((p) => (
                <a
                  key={p.url}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block text-primary underline"
                >
                  {p.title} · {p.status.replaceAll("_", " ")}
                </a>
              ))}
              {stateCoverage.metadataOnlyReferences.map((m) => (
                <p key={m.url} className="mt-2">
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {m.title} · URL only
                  </a>{" "}
                  — {m.note}
                </p>
              ))}
            </div>
          )}
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-semibold">
              Judicial references · {stateCases.length} selected opinions
            </summary>
            <div className="mt-3 space-y-3">
              {stateCases.map((reference) => (
                <JudicialEvidence key={reference.id} reference={reference} />
              ))}
            </div>
          </details>
          <div className="mt-4 space-y-4">
            {stateSources.map((s) => (
              <article key={s.id} className="rounded-lg border border-border p-3">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] font-semibold text-primary underline"
                >
                  {s.title}
                </a>
                <p className="mt-1 text-[12px]">
                  {s.publisher} · captured {s.capturedAt} · {s.method}
                </p>
                <a
                  href={s.textPath}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[12px] text-primary underline"
                >
                  Inspect stored extraction
                </a>
                <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                  SHA-256 {s.sha256} · {s.byteLength.toLocaleString()} bytes · schema{" "}
                  {s.schemaVersion}
                </p>
              </article>
            ))}
            {!stateSources.some((s) => s.state === state) && (
              <p className="text-[13px]">Jurisdiction-specific statutory text remains pending.</p>
            )}
          </div>
        </section>
      )}
      {view === "calculator" && researchNavigation}
      {mdlContext}
      <div className="mt-5 flex flex-wrap gap-4 text-[12px]">
        <Link to="/insights" className="text-primary underline">
          Research workbench
        </Link>
        <Link to="/law" className="text-primary underline">
          Law & regulation
        </Link>
      </div>
      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer text-muted-foreground">
          Data exports and source versions
        </summary>
        <div className="mt-2 flex flex-wrap gap-4">
          <a
            href="/data/limitations/rules.json"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            Versioned rules JSON
          </a>
          <a
            href="/data/limitations/sources.json"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            Source manifest
          </a>
        </div>
      </details>
    </div>
  );
}
