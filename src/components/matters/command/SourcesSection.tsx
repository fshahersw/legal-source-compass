/**
 * Sources and coverage: what the collected docket text covers (entries, withheld entries by reason, capture date, the
 * classifier rule), the transferee court page and its order-list cap, the master-docket record with its source links,
 * the registry's membership evidence and the matter's evidence records.
 */
import { CourtPageCard } from "@/components/lens/MdlLens";
import { EvidencePanel } from "@/components/matters/EvidencePanel";
import { MatterHeader } from "@/components/matters/MatterHeader";
import { CoverageDetails, RegistryCard } from "@/components/matters/OverviewPanel";
import { Card, CardBody } from "@/components/kit";
import { ORDERS_RULE_VERSION } from "@/lib/matters/orders";
import type { MdlCommandPayload } from "@/lib/matters/types";
import { Disclosure, Note, day, fmt } from "./shared";

const REASON_LABEL: Record<string, string> = {
  sealed_or_restricted_text: "Text mentions sealed or restricted material",
  contact_or_access_data: "Contact or access data",
  sealed_document: "Sealed document on the entry",
};

const SECTION_LABEL: Record<string, string> = {
  overview: "MDL record",
  lens: "Court, judge and agency records",
  orders: "Master-docket orders",
  dates: "Docketed dates",
  jpml: "JPML report series",
};

function Coverage({ cmd }: { cmd: MdlCommandPayload }) {
  const c = cmd.orders?.coverage ?? null;
  const page = cmd.lens?.courtPage ?? null;
  const rows: [string, string][] = [
    ["Master-docket entries collected", c?.total != null ? fmt(c.total) : "Not recorded"],
    ["Collected through", c?.collectedThrough ? day(c.collectedThrough) : "Not recorded"],
    ["Entries read by the order classifier", c ? fmt(c.candidatesRead) : "Not recorded"],
    ["Entries with no text", c?.noText != null ? fmt(c.noText) : "Not recorded"],
    ["Entries withheld (never classified)", c ? fmt(c.withheldTotal) : "Not recorded"],
    ...(c?.withheld ?? []).map(
      (w) => [`  · ${REASON_LABEL[w.reason] ?? w.reason}`, fmt(w.count)] as [string, string],
    ),
    ["Classifier rule", ORDERS_RULE_VERSION],
    [
      "Court-page orders listed",
      page ? `${fmt(page.latestOrders.length)} of ${fmt(page.ordersTotal)} on the page` : "No court page recorded",
    ],
  ];
  return (
    <Card>
      <CardBody className="pt-4">
        <h3 className="text-label text-foreground">Docket text coverage</h3>
        <table className="mt-2 w-full text-body">
          <caption className="sr-only">Coverage of the collected master-docket text, MDL {cmd.mdl}</caption>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k} className="border-t border-border first:border-t-0">
                <th scope="row" className="whitespace-pre py-1.5 pr-3 text-left font-normal text-muted-foreground">
                  {k}
                </th>
                <td className="py-1.5 text-right tabular-nums">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note>
          Withheld entries are counted here and never summarised. Any number missing from a CMO or
          PTO sequence reads "Not in collected docket text".
        </Note>
      </CardBody>
    </Card>
  );
}

export function SourcesSection({ cmd, open }: { cmd: MdlCommandPayload; open: boolean }) {
  const lens = cmd.lens;
  const failed = cmd.errors.map((e) => SECTION_LABEL[e] ?? e);
  return (
    <div className="space-y-4">
      {failed.length ? (
        <p role="alert" className="rounded-lg border border-border px-4 py-3 text-meta text-muted-foreground">
          Could not be read just now: {failed.join(", ")}. The rest of the page is complete.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Coverage cmd={cmd} />
        {lens ? (
          <CourtPageCard
            page={lens.courtPage}
            sourceUrl={lens.courtPageSourceUrl}
            sourceLabel={lens.courtPageSourceLabel}
          />
        ) : null}
      </div>
      {cmd.overview ? (
        <>
          <MatterHeader payload={cmd.overview} />
          <RegistryCard payload={cmd.overview} />
          <CoverageDetails payload={cmd.overview} />
          <Disclosure title="Evidence records" defaultOpen={open}>
            <EvidencePanel payload={cmd.overview} />
          </Disclosure>
        </>
      ) : (
        <Note>
          MDL {cmd.mdl} has no record in the MDL directory or the Seeger Weiss registry; this page
          shows what other datasets record for this exact MDL number.
        </Note>
      )}
    </div>
  );
}
