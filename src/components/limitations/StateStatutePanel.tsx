import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { PrivateDataLink } from "@/components/atlas/PrivateDataLink";
import { Button } from "@/components/ui/button";
import type {
  ClaimCoverageStatus,
  ClaimType,
  JudicialReference,
  LimitationRule,
  LimitationsSnapshot,
} from "@/lib/limitations/types";
import { NOT_RECORDED } from "./ruleAuthority";
import { citedStatutes, claimMatrix, statuteSummary, type CitedStatute } from "./stateStatutes";

const toneClass: Record<"ok" | "partial" | "lost" | "unknown", string> = {
  ok: "border-border bg-muted text-foreground",
  partial: "border-border bg-muted text-foreground",
  lost: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-dashed border-border bg-background text-muted-foreground",
};
const statusClass: Record<ClaimCoverageStatus, string> = {
  baseline: "border-border bg-muted text-foreground",
  research_only: "border-border bg-background text-foreground",
  flagged: "border-warning/50 bg-warning/10 text-foreground",
  not_recorded: "border-dashed border-border bg-background text-muted-foreground",
};
const kindLabel: Record<string, string> = {
  statute: "Statute",
  constitution: "Constitution",
  legislative_history: "Legislative history",
  publisher_guidance: "Publisher guidance",
  publisher_table: "Publisher table",
};

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function StatuteCard({
  state,
  statute,
  onOpenClaim,
}: {
  state: string;
  statute: CitedStatute;
  onOpenClaim: (claim: ClaimType) => void;
}) {
  const { source, currency, codeSections, citedBy } = statute;
  const [open, setOpen] = useState(false);
  return (
    <article
      className="rounded-lg border border-border bg-background p-4"
      aria-label={source.title}
      data-testid="cited-statute"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-base font-semibold text-primary underline"
          >
            {source.title}
          </a>
          <p className="mt-1 text-xs text-muted-foreground">
            {kindLabel[source.authorityKind] ?? source.authorityKind} · {source.publisher} ·
            captured {source.capturedAt.slice(0, 10)}
          </p>
        </div>
        <Chip className={toneClass[currency.tone]}>{currency.label}</Chip>
      </div>

      {codeSections.length ? (
        <p className="mt-2 text-sm">
          Current code text searched:{" "}
          {codeSections.map((nativeId, index) => (
            <span key={nativeId}>
              {index ? ", " : ""}
              <Link
                to="/law/codes/$state"
                params={{ state }}
                search={{ section: nativeId, q: "" }}
                className="text-primary underline"
              >
                {nativeId}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      {citedBy.length ? (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border" aria-label="Rules citing this source">
          {citedBy.map((entry) => (
            <li key={entry.ruleId} className="flex flex-wrap items-start justify-between gap-2 p-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="text-left text-sm font-medium text-primary underline"
                  onClick={() => onOpenClaim(entry.claimType)}
                >
                  {entry.claimLabel}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">
                  {entry.ruleKind}
                  {entry.variant ? ` · ${entry.variant}` : ""}
                </span>
                <p className="mt-0.5 text-xs text-muted-foreground">{entry.citation}</p>
                {entry.excerpt ? (
                  <blockquote className="mt-1 border-l-2 border-border pl-3 text-sm leading-relaxed">
                    {entry.excerpt}
                  </blockquote>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Quoted passage: {NOT_RECORDED}</p>
                )}
              </div>
              <span className="text-sm tabular-nums">{entry.period}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No rule in this release quotes this source; it is kept as a captured authority.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <PrivateDataLink
          href={source.textPath}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Stored text
        </PrivateDataLink>
        {currency.freshTextPath ? (
          <PrivateDataLink
            href={currency.freshTextPath}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            Fresh copy ({currency.checked})
          </PrivateDataLink>
        ) : null}
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide capture details" : "Capture details"}
        </button>
      </div>
      {open ? (
        <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt>Recheck</dt>
          <dd>{currency.detail}</dd>
          <dt>Retrieved</dt>
          <dd>{source.capturedAt}</dd>
          <dt>Method</dt>
          <dd>{source.method}</dd>
          <dt>SHA-256</dt>
          <dd className="break-all">
            {source.sha256} · {source.byteLength.toLocaleString()} bytes · schema {source.schemaVersion}
          </dd>
        </dl>
      ) : null}
    </article>
  );
}

/**
 * Per-state statute panel: the claim matrix (every claim type, its recorded status, period, citation,
 * variants and recheck), then every official source with the rules that quote it.
 */
export function StateStatutePanel({
  snapshot,
  state,
  stateName,
  cases,
  variantName,
  onOpenClaim,
  renderCase,
}: {
  snapshot: LimitationsSnapshot;
  state: string;
  stateName: string;
  cases: JudicialReference[];
  variantName: (rule: LimitationRule) => string;
  onOpenClaim: (claim: ClaimType) => void;
  renderCase: (reference: JudicialReference) => React.ReactNode;
}) {
  const rows = claimMatrix(snapshot, state, variantName);
  const statutes = citedStatutes(snapshot, state, variantName);
  const summary = statuteSummary(statutes);
  const coverage = snapshot.coverage.find((row) => row.state === state);
  const [onlyRecorded, setOnlyRecorded] = useState(false);
  const visibleRows = onlyRecorded ? rows.filter((row) => row.status !== "not_recorded") : rows;
  const recorded = rows.filter((row) => row.status !== "not_recorded").length;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby="claim-matrix-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="claim-matrix-title" className="text-xl font-semibold">
              Claim types · {stateName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {recorded} of {rows.length} claim types have an entry read from official text in release{" "}
              {snapshot.ruleVersion}. A missing entry means nothing was recorded, not that no period
              exists.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyRecorded}
              onChange={(e) => setOnlyRecorded(e.target.checked)}
            />
            Recorded only
          </label>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed text-left text-sm" data-testid="claim-matrix">
            <colgroup>
              <col className="w-[17%]" />
              <col className="w-[24%]" />
              <col className="w-[11%]" />
              <col className="w-[14%]" />
              <col className="w-[18%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Claim type</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Period</th>
                <th className="py-2 pr-3 font-semibold">Citation</th>
                <th className="py-2 pr-3 font-semibold">Variants</th>
                <th className="py-2 font-semibold">Last re-checked</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.claimType} className="border-b border-border align-top">
                  <td className="py-2.5 pr-3">
                    {row.status === "not_recorded" ? (
                      <span>{row.label}</span>
                    ) : (
                      <button
                        type="button"
                        className="text-left font-medium text-primary underline"
                        onClick={() => onOpenClaim(row.claimType)}
                      >
                        {row.label}
                      </button>
                    )}
                    {row.grade ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.grade}</p>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Chip className={statusClass[row.status]}>{row.statusLabel}</Chip>
                    {row.flags.length ? (
                      <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                        {row.flags.map((flag) => (
                          <li key={flag}>{flag}</li>
                        ))}
                      </ul>
                    ) : null}
                    {row.reason && row.status === "not_recorded" ? (
                      <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">{row.period}</td>
                  <td className="py-2.5 pr-3">{row.citation ?? NOT_RECORDED}</td>
                  <td className="py-2.5 pr-3">
                    {row.variants.length ? (
                      <ul className="space-y-0.5 text-xs">
                        {row.variants.map((variant) => (
                          <li key={variant.ruleId}>
                            {variant.name.charAt(0).toUpperCase() + variant.name.slice(1)}
                            <span className="text-muted-foreground">
                              {" "}
                              · {variant.status === "baseline" ? "computable" : variant.status.replaceAll("_", " ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {row.currency ? (
                      <Chip className={toneClass[row.currency.tone]} >
                        {row.currency.label}
                      </Chip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby="cited-statutes-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="cited-statutes-title" className="text-xl font-semibold">
              Cited statutes and sources · {stateName}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.sources} official source records · {summary.confirmed} re-checked with the
              quoted passages present · {summary.lost} with a passage no longer found ·{" "}
              {summary.unchecked} not re-read since capture.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const blob = new Blob(
                [JSON.stringify({ state, rules: rows, sources: statutes.map((s) => ({ ...s.source, currency: s.currency, citedBy: s.citedBy })) }, null, 2)],
                { type: "application/json" },
              );
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `limitations-${state}-statutes.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export this state
          </Button>
        </div>

        {coverage && !statutes.some((s) => s.source.state === state) ? (
          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <p>No state-specific text has been captured. Official publication sources:</p>
            {coverage.publisherLinks.map((item) => (
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
            {coverage.metadataOnlyReferences.map((item) => (
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
        ) : null}

        <div className="mt-4 space-y-3">
          {statutes.map((statute) => (
            <StatuteCard
              key={statute.source.id}
              state={state}
              statute={statute}
              onOpenClaim={onOpenClaim}
            />
          ))}
        </div>

        {coverage?.gaps.length ? (
          <details className="mt-5">
            <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">
              Unresolved work recorded for {stateName} · {coverage.gaps.length}
            </summary>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {coverage.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">
            Judicial references · {cases.length}
          </summary>
          <div className="mt-3 space-y-3">{cases.map((item) => renderCase(item))}</div>
        </details>
      </section>
    </div>
  );
}
