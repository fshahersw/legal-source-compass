import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { STATES } from "@/lib/corpus/geo";
import { loadLimitations } from "@/lib/limitations/load";
import {
  NOT_RECORDED,
  ruleAuthorityFacts,
  sourceCurrencyFacts,
  type CrossReferenceFacts,
  sectionLabel,
} from "./ruleAuthority";
import { StatuteCitation } from "./StatuteCitation";
import { StateStatutePanel } from "./StateStatutePanel";
import { ReviewedCalculator } from "./ReviewedCalculator";
import { versionWindowLabel } from "./calculatorGuidance";
import {
  CLAIM_LABELS,
  VERIFICATION_GRADE_LABELS,
  type ClaimType,
  type JudicialReference,
  type LimitationRule,
  type LimitationsSnapshot,
} from "@/lib/limitations/types";

type View = "calculator" | "coverage" | "sources";
type Navigation = { state: string; claim?: ClaimType; view: View };
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
const variantName = (rule: LimitationRule) =>
  subtypeLabels[rule.subtype ?? "general"] ??
  (versionWindowLabel(rule)
    ? `the statutory version for ${versionWindowLabel(rule)}`
    : humanize(rule.subtype ?? "general"));
const toneClass: Record<"ok" | "partial" | "lost" | "unknown", string> = {
  ok: "border-border bg-muted",
  partial: "border-border bg-muted",
  lost: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-dashed border-border bg-background text-muted-foreground",
};

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
        <dt className="font-medium">Last re-checked</dt>
        <dd data-testid="rule-currency">
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${toneClass[facts.currency.tone]}`}
          >
            {facts.currency.label}
          </span>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              What was checked
            </summary>
            <p className="mt-1 leading-relaxed">{facts.currency.detail}</p>
          </details>
        </dd>
        <dt className="font-medium">Fetch route</dt>
        <dd data-testid="fetch-route">
          {facts.sources.length
            ? Object.entries(
                facts.sources.reduce<Record<string, number>>((acc, source) => {
                  acc[source.route] = (acc[source.route] ?? 0) + 1;
                  return acc;
                }, {}),
              )
                .map(([route, count]) =>
                  facts.sources.length > 1
                    ? `${count} ${count === 1 ? "source" : "sources"}: ${route.charAt(0).toLowerCase()}${route.slice(1)}`
                    : route,
                )
                .join(" · ")
            : NOT_RECORDED}
        </dd>
        <dt className="font-medium">Effective date</dt>
        <dd>{facts.effective}</dd>
        {versionWindowLabel(rule) && (
          <>
            <dt className="font-medium">Calculator applies to</dt>
            <dd>{versionWindowLabel(rule)}</dd>
          </>
        )}
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
            <dt className="font-medium">{facts.accrualLabel}</dt>
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
        <div className="mt-2">
          <p className="font-medium">Statute of repose</p>
          <ul className="list-disc pl-5">
            {facts.repose.map((item, index) => (
              <li key={item}>
                {item}
                <CrossReferenceNote link={facts.reposeLinks[index] ?? null} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {facts.tolling.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">Statutory tolling (not automatically applied)</p>
          <ul className="list-disc pl-5">
            {facts.tolling.map((item, index) => (
              <li key={item}>
                {item}
                <CrossReferenceNote link={facts.tollingLinks[index] ?? null} />
              </li>
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
      {facts.history.length > 0 && (
        <div className="mt-2" data-testid="rule-history">
          <p className="font-medium">Change history</p>
          <ul className="list-disc pl-5">
            {facts.history.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Where a tolling / repose note's cited section is held in the corpus, and whether the note's periods are
 * printed there. Rendered only when the release carries a link for the note; nothing is inferred otherwise.
 */
function CrossReferenceNote({ link }: { link: CrossReferenceFacts | null }) {
  if (!link) return null;
  const tone =
    link.termCheck === "all_present"
      ? "border-primary/40 text-primary"
      : link.termCheck === "not_all_present"
        ? "border-destructive/50 text-destructive"
        : "border-border text-muted-foreground";
  return (
    <span
      className="ml-1 inline-flex flex-wrap items-center gap-1 align-baseline text-xs"
      data-testid="cross-reference"
    >
      <span className={`inline-block rounded border px-1.5 py-0.5 ${tone}`} title={link.detail}>
        {link.label}
      </span>
      {link.sectionIds.map((nativeId) => (
        <Link
          key={nativeId}
          to="/law/codes/$state"
          params={{ state: link.state }}
          search={{ section: nativeId }}
          className="text-primary underline"
          title={`Open ${nativeId.slice(nativeId.indexOf(":") + 1)} in the state code reader`}
        >
          {sectionLabel(nativeId)}
        </Link>
      ))}
    </span>
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
            if (!source) return <span key={id}>Source not recorded</span>;
            const currency = sourceCurrencyFacts(source.currency);
            return (
              <div key={id} className="flex flex-col items-start gap-1" data-testid="cited-source">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline"
                >
                  {source.title}
                </a>
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-xs ${toneClass[currency.tone]}`}
                  title={currency.detail}
                >
                  {currency.label}
                </span>
                {currency.codeSections.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Matched in{" "}
                    {currency.codeSections.map((nativeId, index) => (
                      <span key={nativeId}>
                        {index > 0 ? ", " : ""}
                        <Link
                          to="/law/codes/$state"
                          params={{ state: source.state }}
                          search={{ section: nativeId }}
                          className="text-primary underline"
                        >
                          {nativeId.slice(nativeId.indexOf(":") + 1)}
                        </Link>
                      </span>
                    ))}
                  </span>
                )}
                {currency.freshTextPath && (
                  <PrivateDataLink
                    className="text-xs text-primary underline"
                    href={currency.freshTextPath}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Fresh official text ({currency.checked})
                  </PrivateDataLink>
                )}
              </div>
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
    staleTime: 60_000,
  });
  const navigate = (
    nextView: View = "calculator",
    nextState = state,
    nextClaim: ClaimType | null | undefined = claim,
  ) => onNavigate({ state: nextState, ...(nextClaim ? { claim: nextClaim } : {}), view: nextView });
  if (query.isPending)
    return <p className="py-8 text-base text-muted-foreground">Loading cited state rules…</p>;
  if (!query.data)
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
  const stateName = STATES.find((item) => item.usps === state)?.name ?? state;
  const stateCases = snapshot.cases.filter(
    (item) => item.jurisdiction === state || item.jurisdiction === "US",
  );
  return (
    <div>
      {query.error && view !== "calculator" && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          Source refresh failed. Your assessment is preserved, but calculation is paused until the
          source release can be checked.
          <Button size="sm" variant="outline" className="ml-3" onClick={() => query.refetch()}>
            Retry source refresh
          </Button>
        </div>
      )}
      <div hidden={view !== "calculator"}>
        <ReviewedCalculator
          key={state + ":" + (claim ?? "")}
          snapshot={snapshot}
          sourceRefreshFailed={!!query.error}
          sourceRefreshing={query.isFetching}
          onRefreshSources={() => void query.refetch()}
          state={state}
          claim={claim}
          onNavigate={onNavigate}
          renderAuthority={(rule) => <Citations snapshot={snapshot} rule={rule} />}
        />
      </div>
      {view !== "calculator" && (
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
                  : "Statutes & sources"}
            </Button>
          ))}
        </nav>
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
                        onClick={() => navigate("calculator", item.state, claim)}
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
        <StateStatutePanel
          snapshot={snapshot}
          state={state}
          stateName={stateName || "choose a state"}
          cases={stateCases}
          variantName={variantName}
          onOpenClaim={(nextClaim) => navigate("calculator", state, nextClaim)}
          renderCase={(item) => <JudicialEvidence key={item.id} reference={item} />}
        />
      )}
    </div>
  );
}
