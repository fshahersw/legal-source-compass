import { useState } from "react";
import {
  isLocalRelationshipSource,
  type EnrichmentSnapshot,
} from "@/lib/external/enrichmentSchema";

const providers = new Map([
  ["courtlistener", "CourtListener"],
  ["ecfr", "eCFR"],
  ["corpus-legal-review", "Reviewed legal evidence"],
  ["openfda", "openFDA"],
  ["jpml-html", "JPML and court HTML"],
  ["local-sw-catalog", "Local catalog producer / extraction evidence"],
  ["local-vaquill-open-us-law", "Local secondary state-law evidence"],
  ["local-source-registry", "Local source-registry evidence"],
]);
const label = (value: string) => providers.get(value) ?? value.replaceAll("-", " ");
const number = (value: number) => value.toLocaleString("en-US");

export function RelationshipCoverage({
  rows,
}: {
  rows: NonNullable<EnrichmentSnapshot["relationshipCoverage"]>;
}) {
  const [source, setSource] = useState("");
  const selected = rows.filter((row) => !source || row.source === source);
  const total = selected.reduce((sum, row) => sum + row.records, 0);
  const unresolved = selected.reduce((sum, row) => sum + row.unresolvedEdges, 0);
  const inferred = selected.reduce((sum, row) => sum + row.inferredEdges, 0);
  const matched = total - unresolved;
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Source-qualified relationship edges</h2>
          <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
            See which source relationships have an exact active imported target. Counts are
            source-version edges: different versions can repeat an association. A matched target
            establishes an identity link, not legal relevance, judicial treatment, causation or an
            outcome. An unavailable target is absent or held in quarantine at this checkpoint. Local
            catalog pointers connect exact local records and extraction references; their producer
            claims remain separate from publisher-native or legally causal relationships.
          </p>
        </div>
        <label className="text-[12px]">
          Source collection
          <select
            className="ml-2 rounded border border-input bg-background p-2"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">All source collections</option>
            {[...new Set(rows.map((row) => row.source))].sort().map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 text-[12px]">
        {[
          ["Edges with active imported targets", matched],
          ["Edges without active imported targets", unresolved],
          ["Edges marked as inferred", inferred],
        ].map(([name, value]) => (
          <div key={String(name)} className="rounded border border-border p-3">
            <div className="text-muted-foreground">{name}</div>
            <div className="mt-1 text-lg font-semibold">{number(value as number)}</div>
          </div>
        ))}
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-medium">
          Explore the reference paths · {number(total)} source-version edges
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="p-2">Source and reference path</th>
                <th className="p-2">Edges</th>
                <th className="p-2">Active target matching</th>
                <th className="p-2">Target unavailable</th>
                <th className="p-2">Inferred</th>
              </tr>
            </thead>
            <tbody>
              {selected.map((row) => {
                const percentage = row.records
                  ? (100 * (row.records - row.unresolvedEdges)) / row.records
                  : null;
                return (
                  <tr
                    key={`${row.source}/${row.from}/${row.to}`}
                    className="border-b border-border align-top"
                  >
                    <td className="p-2">
                      <div className="font-medium">{label(row.source)}</div>
                      {row.from.replaceAll("-", " ")} → {row.to.replaceAll("-", " ")}
                      {isLocalRelationshipSource(row.source) ? (
                        <div className="mt-1 max-w-sm text-muted-foreground">
                          Exact local producer / extraction pointers. A match does not verify the
                          underlying legal relationship or applicability.
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2 tabular-nums">{number(row.records)}</td>
                    <td className="min-w-36 p-2">
                      <div className="mb-1 tabular-nums">
                        {percentage == null ? "No edges" : `${percentage.toFixed(1)}%`}
                      </div>
                      {percentage != null && (
                        <div
                          className="h-2 overflow-hidden rounded bg-warning/30"
                          role="img"
                          aria-label={`${number(row.records - row.unresolvedEdges)} source-version edges with active imported targets out of ${number(row.records)} source-version edges`}
                        >
                          <div
                            className="h-full bg-primary/70"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="p-2 tabular-nums">{number(row.unresolvedEdges)}</td>
                    <td className="p-2 tabular-nums">{number(row.inferredEdges)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
