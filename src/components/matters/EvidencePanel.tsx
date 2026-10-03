import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { entityQuery } from "@/components/corpus/EntityPage";
import { Chip, Fact, LinkOut, Loading, NotRecorded, Panel } from "@/components/matters/common";
import { MdlEvidence } from "@/components/legal/MdlEvidence";
import { buildEntityView } from "@/lib/external/entityView";
import { displayValue } from "@/lib/external/domainRegistry";
import type { MatterOverviewPayload } from "@/lib/matters/types";

const KIND_LABELS: Record<string, string> = {
  "court-master-references": "Court's MDL information page",
  "order-locators": "JPML panel-orders index entry",
  "mdl-motion-observations": "JPML motion index observation",
  "judge-profile-references": "Court page naming the judge",
  "source-caption-conflicts": "Caption conflict audit",
};

export function EvidencePanel({ payload }: { payload: MatterOverviewPayload }) {
  const o = payload.overview;
  const record = useQuery(entityQuery("mdls", o.mdl));
  const view = record.data?.raw ? buildEntityView(record.data.raw) : null;
  const j = o.judge;
  return (
    <div className="space-y-4">
      <MdlEvidence id={o.mdl} />

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
