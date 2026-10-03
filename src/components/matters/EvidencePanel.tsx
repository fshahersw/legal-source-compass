import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { entityQuery } from "@/components/corpus/EntityPage";
import {
  Chip,
  DataTable,
  Fact,
  LinkOut,
  Loading,
  NotRecorded,
  Panel,
  td,
  th,
} from "@/components/matters/common";
import { MdlEvidence } from "@/components/legal/MdlEvidence";
import { buildEntityView } from "@/lib/external/entityView";
import { displayValue } from "@/lib/external/domainRegistry";
import { evidenceKindLabel } from "@/lib/matters/cases";
import { formatUtc, type RegistryMatter } from "@/lib/matters/registry";
import type { MatterOverviewPayload } from "@/lib/matters/types";

const KIND_LABELS: Record<string, string> = {
  "court-master-references": "Court's MDL information page",
  "order-locators": "JPML panel-orders index entry",
  "mdl-motion-observations": "JPML motion index observation",
  "judge-profile-references": "Court page naming the judge",
  "source-caption-conflicts": "Caption conflict audit",
};

const ROLE_NAMES: Record<string, string> = {
  master: "MDL master docket",
  jpml_panel: "JPML panel proceeding",
};

/** Explicit provider ids for the master and JPML dockets, and the JPML orders the registry parsed. */
function RegistryEvidence({ registry }: { registry: RegistryMatter }) {
  return (
    <Panel
      title="Matter registry: identities and orders"
      note="The explicit provider case ids the Seeger Weiss matter registry records for the master and JPML dockets, with how each was resolved, and the JPML orders it read member dockets from."
      aside={
        registry.projectedAt ? <span>Projected {formatUtc(registry.projectedAt)}</span> : undefined
      }
    >
      <div className="space-y-4">
        {registry.caseIds.length ? (
          <DataTable caption="Master and JPML dockets with provider case ids">
            <thead>
              <tr>
                <th className={th} scope="col">
                  Docket
                </th>
                <th className={th} scope="col">
                  Court
                </th>
                <th className={th} scope="col">
                  Provider case ids
                </th>
                <th className={th} scope="col">
                  Evidence
                </th>
              </tr>
            </thead>
            <tbody>
              {registry.caseIds.map((c) => (
                <tr key={c.docketKey}>
                  <td className={td}>
                    <div className="font-mono text-[12px]">{c.docketNumber ?? <NotRecorded />}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {ROLE_NAMES[c.role] ?? c.role.replace(/_/g, " ")}
                    </div>
                  </td>
                  <td className={td}>{c.courtId ?? <NotRecorded />}</td>
                  <td className={td}>
                    {c.nativeCaseIds.length ? (
                      <ul className="space-y-0.5">
                        {c.nativeCaseIds.map((n) => (
                          <li key={`${n.provider}:${n.id}`}>
                            <span className="text-muted-foreground">{n.provider}</span>{" "}
                            <span className="font-mono text-[11px]">{n.id}</span>
                            {n.basis ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                ({n.basis.replace(/_/g, " ")})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <NotRecorded />
                    )}
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {c.basis.map((b) => (
                        <Chip key={b}>{evidenceKindLabel(b)}</Chip>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : null}
        {registry.jpmlOrders.length ? (
          <DataTable caption="JPML orders parsed for Schedule A">
            <thead>
              <tr>
                <th className={th} scope="col">
                  Order
                </th>
                <th className={th} scope="col">
                  Date
                </th>
                <th className={`${th} text-right`} scope="col">
                  Rows read
                </th>
                <th className={th} scope="col">
                  Source
                </th>
                <th className={th} scope="col">
                  SHA-256
                </th>
              </tr>
            </thead>
            <tbody>
              {registry.jpmlOrders.map((ord) => (
                <tr key={ord.url}>
                  <td className={td}>
                    {ord.docType ? ord.docType.replace(/_/g, " ") : <NotRecorded />}
                    {ord.ctoNo ? ` · CTO ${ord.ctoNo}` : ""}
                  </td>
                  <td className={`${td} whitespace-nowrap font-mono`}>
                    {ord.docDate ?? <NotRecorded />}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {ord.rows !== null ? ord.rows.toLocaleString() : <NotRecorded />}
                  </td>
                  <td className={td}>
                    <LinkOut href={ord.url}>jpml.uscourts.gov</LinkOut>
                    {ord.altCopies.map((a) => (
                      <div key={a.url} className="text-[11px]">
                        <LinkOut href={a.url}>Other copy</LinkOut>
                      </div>
                    ))}
                  </td>
                  <td className={`${td} font-mono text-[11px]`} title={ord.sha256 ?? undefined}>
                    {ord.sha256 ? `${ord.sha256.slice(0, 12)}…` : <NotRecorded />}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No JPML order has been parsed for this matter yet. <NotRecorded />
          </p>
        )}
        {registry.unassignedNativeCaseIds.length ? (
          <p className="text-[12px] text-muted-foreground">
            Case ids the registry could not attach to a docket (held, not guessed):{" "}
            <span className="font-mono">{registry.unassignedNativeCaseIds.join(", ")}</span>
          </p>
        ) : null}
        {registry.runIds.length ? (
          <p className="text-[11px] text-muted-foreground">
            Registry run{registry.runIds.length === 1 ? "" : "s"}:{" "}
            <span className="font-mono">{registry.runIds.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

export function EvidencePanel({ payload }: { payload: MatterOverviewPayload }) {
  const o = payload.overview;
  const record = useQuery(entityQuery("mdls", o.mdl));
  const view = record.data?.raw ? buildEntityView(record.data.raw) : null;
  const j = o.judge;
  return (
    <div className="space-y-4">
      <MdlEvidence id={o.mdl} />

      {payload.registry ? <RegistryEvidence registry={payload.registry} /> : null}

      <Panel
        title="Presiding judge link"
        note="A judge profile is linked only when a native identifier ties it to this MDL; a printed name is never enough."
      >
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Printed by the JPML">{j.printedName}</Fact>
          <Fact label="Profile name">{j.profileName}</Fact>
          <Fact label="Link status">
            {payload.judgeProfile ? (
              <Link
                to="/judges/$id"
                params={{ id: payload.judgeProfile.id }}
                className="text-primary underline-offset-2 hover:underline"
              >
                Linked · open profile
              </Link>
            ) : j.entityId ? (
              <Chip tone="warning">A candidate profile exists but no native id confirms it</Chip>
            ) : (
              <Chip>No profile link</Chip>
            )}
          </Fact>
          <Fact label="FJC judge id (jid / nid)">
            {j.fjcJid || j.fjcNid ? `${j.fjcJid ?? "—"} / ${j.fjcNid ?? "—"}` : null}
          </Fact>
          <Fact label="CourtListener person id">{j.clPersonId}</Fact>
          <Fact label="Evidence">{j.evidenceNote ?? j.linkBasis}</Fact>
        </dl>
      </Panel>

      <Panel
        title="Official references"
        note="Dated captures of official JPML and court pages that mention this MDL. Document bodies are not acquired."
      >
        {payload.jpmlReferences.length ? (
          <ul className="divide-y divide-border text-[12px]">
            {payload.jpmlReferences.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5"
              >
                <span className="min-w-0">
                  <span className="font-medium">{r.title}</span>
                  <span className="ml-2 text-muted-foreground">
                    {KIND_LABELS[r.kind] ?? r.kind}
                  </span>
                </span>
                <LinkOut href={r.url}>Open source</LinkOut>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No official page capture names this MDL yet. <NotRecorded />
          </p>
        )}
      </Panel>

      <Panel
        title="Record details and provenance"
        note="The MDL record exactly as the corpus stores it, for audit."
      >
        {record.isLoading ? <Loading what="the MDL record" /> : null}
        {view ? (
          <div className="space-y-3 text-[12px]">
            {view.technical.length ? (
              <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-3 gap-y-1">
                {view.technical.map(([k, v], i) => (
                  <div key={i} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{displayValue(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {view.provenanceJson ? (
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  Source provenance (JSON)
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 text-[11px]">
                  {view.provenanceJson}
                </pre>
              </details>
            ) : null}
            {view.empty.length ? (
              <p className="text-muted-foreground">
                Not recorded for this entry: {view.empty.join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
