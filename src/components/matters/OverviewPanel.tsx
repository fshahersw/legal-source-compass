import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";

import { BarList } from "@/components/corpus/BarList";
import {
  DataTable,
  LinkOut,
  NotRecorded,
  Panel,
  Scope,
  StatTile,
  td,
  th,
} from "@/components/matters/common";
import { formatBytes } from "@/lib/matters/documents";
import { entryTypeLabel } from "@/lib/matters/entries";
import { getMatterDocumentsSummary, getMatterEntries } from "@/lib/matters/matters.functions";
import { orNotRecorded } from "@/lib/matters/overview";
import type { MatterOverviewPayload } from "@/lib/matters/types";

type TabSearch = "cases" | "docket" | "documents" | "parties" | "evidence";

function TabLink({ id, tab, children }: { id: string; tab: TabSearch; children: React.ReactNode }) {
  return (
    <Link
      to="/matters/$id"
      params={{ id }}
      search={{ tab }}
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

const asRows = (m: Record<string, number>) =>
  Object.entries(m)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

export function OverviewPanel({ payload }: { payload: MatterOverviewPayload }) {
  const o = payload.overview;
  const docsFn = useServerFn(getMatterDocumentsSummary);
  const entriesFn = useServerFn(getMatterEntries);
  const docs = useQuery({
    queryKey: ["matter-documents-summary", o.mdl],
    queryFn: () => docsFn({ data: { id: o.mdl } }),
    staleTime: 5 * 60_000,
  });
  const entries = useQuery({
    queryKey: ["matter-entries", o.mdl, "auto", "", "", 0],
    queryFn: () => entriesFn({ data: { id: o.mdl, source: "auto", type: null, q: "", offset: 0 } }),
    staleTime: 2 * 60_000,
  });
  const registry = docs.data && docs.data.connected ? docs.data.summary : null;
  const available = entries.data?.available;
  const cases = o.cases;
  const counsel = o.counsel;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Actions pending (JPML)"
          value={o.actions.pending !== null ? o.actions.pending.toLocaleString() : <NotRecorded />}
          note={
            o.actions.total !== null
              ? `${o.actions.total.toLocaleString()} total${o.asOf ? ` · JPML report ${o.asOf}` : ""}`
              : o.asOf
                ? `JPML report ${o.asOf}`
                : undefined
          }
        />
        <StatTile
          label="Cases in the corpus"
          value={
            cases?.total !== null && cases?.total !== undefined ? (
              cases.total.toLocaleString()
            ) : (
              <NotRecorded />
            )
          }
          note="Master docket plus the saved docket sample; never the size of the MDL"
        />
        <StatTile
          label="Docket entries"
          value={
            available ? (
              (available.clEntries ?? available.activity ?? 0).toLocaleString()
            ) : entries.isLoading ? (
              "…"
            ) : (
              <NotRecorded />
            )
          }
          note={
            available
              ? [
                  available.clEntries
                    ? `${available.clEntries.toLocaleString()} listed by CourtListener`
                    : null,
                  available.activity
                    ? `${available.activity.toLocaleString()} with docket text`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "None in the corpus yet"
              : undefined
          }
        />
        <StatTile
          label="Verified PDFs"
          value={
            registry ? registry.total.toLocaleString() : docs.isLoading ? "…" : <NotRecorded />
          }
          note={
            registry
              ? `${registry.open.toLocaleString()} open · ${registry.held.toLocaleString()} held${registry.openBytes ? ` · ${formatBytes(registry.openBytes)}` : ""}`
              : docs.data && !docs.data.connected
                ? "Registry not connected"
                : undefined
          }
        />
        <StatTile
          label="Counsel records"
          value={
            counsel?.totalFirms !== null && counsel?.totalFirms !== undefined ? (
              `${counsel.totalFirms.toLocaleString()} firms`
            ) : (
              <NotRecorded />
            )
          }
          note={
            counsel?.totalAttorneys
              ? `${counsel.totalAttorneys.toLocaleString()} attorneys in the saved sample`
              : "Open the Parties tab for the master-docket counsel records"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="JPML counts over time"
          note="Each row is a separate JPML report; the figures count actions, not the cases in this corpus."
        >
          {o.actions.snapshots.length ? (
            <DataTable caption="JPML action counts by report date" narrow>
              <thead>
                <tr>
                  <th className={th} scope="col">
                    Report date
                  </th>
                  <th className={`${th} text-right`} scope="col">
                    Total actions
                  </th>
                  <th className={`${th} text-right`} scope="col">
                    Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {o.actions.snapshots.map((s) => (
                  <tr key={s.asOf}>
                    <td className={`${td} font-mono`}>{s.asOf}</td>
                    <td className={`${td} text-right tabular-nums`}>{orNotRecorded(s.total)}</td>
                    <td className={`${td} text-right tabular-nums`}>{orNotRecorded(s.pending)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No dated JPML count snapshots are recorded for this MDL.
            </p>
          )}
        </Panel>

        <Panel title="Where to look" note="What the corpus holds for this matter, tab by tab.">
          <ul className="space-y-1.5 text-[13px]">
            <li>
              <TabLink id={o.mdl} tab="cases">
                Member cases
              </TabLink>{" "}
              —{" "}
              {cases?.total
                ? `${cases.total.toLocaleString()} dockets with membership evidence`
                : "none beyond the master docket"}
            </li>
            <li>
              <TabLink id={o.mdl} tab="docket">
                Docket entries
              </TabLink>{" "}
              —{" "}
              {available
                ? [
                    available.clEntries ? `${available.clEntries.toLocaleString()} listed` : null,
                    available.activity ? `${available.activity.toLocaleString()} with text` : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "none yet"
                : "loading"}
            </li>
            <li>
              <TabLink id={o.mdl} tab="documents">
                Documents
              </TabLink>{" "}
              —{" "}
              {registry
                ? `${registry.open.toLocaleString()} open and ${registry.held.toLocaleString()} held verified PDFs`
                : "verified PDFs, saved-sample documents and JPML reports"}
            </li>
            <li>
              <TabLink id={o.mdl} tab="parties">
                Parties and counsel
              </TabLink>{" "}
              — firms, attorneys and tracked-firm appearances
            </li>
            <li>
              <TabLink id={o.mdl} tab="evidence">
                Evidence and sources
              </TabLink>{" "}
              — reviewed MDL packet, JPML references and provenance
            </li>
          </ul>
        </Panel>
      </div>

      {cases &&
      (Object.keys(cases.byCourt).length > 1 || Object.keys(cases.byFiledYear).length > 1) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <BarList
            title="Sample cases by court"
            rows={asRows(cases.byCourt)}
            limit={8}
            unit="dockets in this matter's saved sample"
          />
          <BarList
            title="Sample cases by filing year"
            rows={asRows(cases.byFiledYear).sort((a, b) => b.label.localeCompare(a.label))}
            limit={10}
            unit="dockets in this matter's saved sample"
          />
        </div>
      ) : null}

      {o.activity && Object.keys(o.activity.byEntryType).length ? (
        <BarList
          title="Docket entries by type (saved sample)"
          rows={asRows(o.activity.byEntryType).map((r) => ({
            ...r,
            label: entryTypeLabel(r.label),
          }))}
          limit={9}
          unit="docket entries in the saved sample, classified from the docket text"
        />
      ) : null}

      <Panel
        title="Scope of this page"
        note="Every list on a matter page says which source it comes from and what it leaves out."
      >
        <div className="space-y-2">
          {[
            { title: "Cases", text: cases?.qualification },
            { title: "Docket text", text: o.activity?.qualification },
            { title: "Saved documents", text: o.docketDocuments?.qualification },
            { title: "Counsel", text: counsel?.qualification },
          ]
            .filter((x) => x.text)
            .map((x) => (
              <Scope key={x.title} title={x.title}>
                {x.text}
              </Scope>
            ))}
          {!cases?.qualification &&
          !o.activity?.qualification &&
          !o.docketDocuments?.qualification &&
          !counsel?.qualification ? (
            <p className="text-[13px] text-muted-foreground">
              No source qualifications are recorded for this matter's lists.
            </p>
          ) : null}
          {payload.master?.sourceAsOf ? (
            <p className="text-[12px] text-muted-foreground">
              Master-docket dates come from CourtListener docket metadata as of{" "}
              {payload.master.sourceAsOf}.{" "}
              {o.masterDocket.clDocketId ? (
                <LinkOut
                  href={`https://www.courtlistener.com/docket/${o.masterDocket.clDocketId}/`}
                >
                  Open the live docket
                </LinkOut>
              ) : null}
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
