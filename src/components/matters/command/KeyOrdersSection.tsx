/**
 * Key orders read from the master-docket text (rule orders/1): the entries per kind (replacing the former keyword
 * "Docket entries by type" bar), the CMO / PTO ledgers with every gap shown as "Not in collected docket text", Rule
 * 702 rulings by the outcome their own title states, and the bellwether, fact-sheet, trial, settlement, verdict and
 * bankruptcy-stay ledgers. Long lists sit behind "View data".
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChartCard, RankBars } from "@/components/charts/recharts";
import { Card, CardBody, DataDrawer, KpiStrip, type DataColumn } from "@/components/kit";
import {
  NOT_IN_COLLECTED_TEXT,
  ORDERS_RULE_VERSION,
  ORDER_KIND_LABEL,
  type CourtPageMatch,
  type OrderKind,
} from "@/lib/matters/orders";
import type { MdlCommandPayload, OrderDocumentsPayload } from "@/lib/matters/types";
import { mdlOrderDocumentsQuery } from "./commandQueries";
import { kindItems, kindRows, ledgerRows, type KindRow, type LedgerTableRow } from "./commandView";
import { EntryLink, Note, Out, collectedNote, day, docketSource, fmt } from "./shared";

const kindColumns: DataColumn<KindRow>[] = [
  { key: "date", label: "Entered", value: (r) => r.date },
  { key: "title", label: "Docket text (printed title)", value: (r) => r.title },
  { key: "outcome", label: "Outcome as stated", value: (r) => r.outcome },
  {
    key: "entry",
    label: "Entry",
    align: "right",
    value: (r) => r.entryNumber,
    render: (r) => <EntryLink n={r.entryNumber} href={r.sourceUrl} />,
  },
];

function documentsFor(docs: OrderDocumentsPayload | undefined, entry: number | null) {
  if (!docs?.connected || entry === null) return [];
  return docs.byEntry[String(entry)] ?? [];
}

function Ledger({
  cmd,
  kind,
  docs,
}: {
  cmd: MdlCommandPayload;
  kind: "cmo" | "pto";
  docs: OrderDocumentsPayload | undefined;
}) {
  const seq = cmd.orders!.ledger[kind];
  const rows = useMemo(() => ledgerRows(seq), [seq]);
  const court = cmd.courtPageOrders.filter((c) => c.kind === kind);
  if (!seq.rows.length && !court.length) return null;
  const name = kind === "cmo" ? "Case management orders" : "Pretrial orders";
  const columns: DataColumn<LedgerTableRow>[] = [
    { key: "label", label: "Order", value: (r) => r.label },
    { key: "date", label: "Entered", value: (r) => r.date },
    {
      key: "subject",
      label: "Subject as printed",
      value: (r) => r.subject,
      render: (r) =>
        r.missing ? <span className="text-muted-foreground">{NOT_IN_COLLECTED_TEXT}</span> : r.subject,
    },
    {
      key: "entry",
      label: "Docket entry",
      align: "right",
      value: (r) => r.entryNumber,
      render: (r) => (r.missing ? "" : <EntryLink n={r.entryNumber} href={r.sourceUrl} />),
    },
    {
      key: "pdf",
      label: "Document",
      value: (r) => documentsFor(docs, r.entryNumber)[0]?.sourceUrl ?? null,
      render: (r) => {
        const d = documentsFor(docs, r.entryNumber)[0];
        return d ? <Out href={d.sourceUrl}>{d.pageCount ? `${d.pageCount} pp.` : "PDF"}</Out> : "";
      },
    },
  ];
  const latest = seq.latest;
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-label text-foreground">{name}</h3>
          <DataDrawer
            title={`MDL ${cmd.mdl}: ${name.toLowerCase()} ledger`}
            rows={rows}
            rowKey={(r) => r.key}
            columns={columns}
            searchable
            source={{
              source: { label: docketSource(cmd).label, href: docketSource(cmd).url },
              about: <p>{collectedNote(cmd.orders!.coverage.collectedThrough)}</p>,
            }}
          />
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-body sm:grid-cols-4">
          <div>
            <dt className="text-meta text-muted-foreground">Numbers found</dt>
            <dd className="tabular-nums">{fmt(seq.distinctNumbers)}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Highest</dt>
            <dd className="tabular-nums">{seq.highest ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Entries (incl. amendments)</dt>
            <dd className="tabular-nums">{fmt(seq.issuedEntries)}</dd>
          </div>
          <div>
            <dt className="text-meta text-muted-foreground">Not in collected text</dt>
            <dd className="tabular-nums">{fmt(seq.missing.length)}</dd>
          </div>
        </dl>
        {latest ? (
          <p className="mt-2 text-body">
            Latest: <EntryLink n={latest.entry.entryNumber} href={latest.entry.sourceUrl} />{" "}
            {rows.find((r) => r.entryId === latest.entry.id)?.label}, {day(latest.entry.date)}
            {latest.subject ? ` · ${latest.subject}` : ""}
          </p>
        ) : null}
        {seq.missing.length ? (
          <Note>
            {kind.toUpperCase()} {seq.missing.slice(0, 12).join(", ")}
            {seq.missing.length > 12 ? ` and ${seq.missing.length - 12} more` : ""}:{" "}
            {NOT_IN_COLLECTED_TEXT.toLowerCase()} (withheld or not yet collected).
          </Note>
        ) : null}
        {court.length ? <CourtPageList orders={court} /> : null}
      </CardBody>
    </Card>
  );
}

function CourtPageList({ orders }: { orders: CourtPageMatch[] }) {
  const unmatched = orders.filter((o) => !o.docketEntryIds.length);
  return (
    <Note>
      The transferee court's page lists {fmt(orders.length)} of these numbered orders;{" "}
      {fmt(orders.length - unmatched.length)} match a docket entry on exact kind, number and suffix.
      {unmatched.length ? (
        <>
          {" "}
          Only on the court page:{" "}
          {unmatched.slice(0, 6).map((o, i) => (
            <span key={o.url + i}>
              {i ? ", " : ""}
              <Out href={o.url}>{o.title}</Out>
            </span>
          ))}
          {unmatched.length > 6 ? ` and ${unmatched.length - 6} more` : ""}.
        </>
      ) : null}
    </Note>
  );
}

/** A compact ledger card: count, the latest three entries, and the full list behind "View data". */
function KindCard({
  cmd,
  title,
  kinds,
  empty,
}: {
  cmd: MdlCommandPayload;
  title: string;
  kinds: readonly OrderKind[];
  empty: string;
}) {
  const rows = useMemo(() => kindRows(cmd.orders!.entries, kinds), [cmd.orders, kinds]);
  return (
    <Card>
      <CardBody className="pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-label text-foreground">
            {title} <span className="tabular-nums text-muted-foreground">· {fmt(rows.length)}</span>
          </h3>
          {rows.length > 3 ? (
            <DataDrawer
              title={`MDL ${cmd.mdl}: ${title.toLowerCase()}`}
              rows={rows}
              rowKey={(r) => r.id}
              columns={kindColumns}
              searchable
              source={{ source: { label: docketSource(cmd).label, href: docketSource(cmd).url } }}
            />
          ) : null}
        </div>
        {rows.length ? (
          <ul className="mt-2 space-y-1.5 text-body">
            {rows.slice(0, 3).map((r) => (
              <li key={r.id} className="min-w-0">
                <span className="tabular-nums text-muted-foreground">{day(r.date)}</span> ·{" "}
                <Out href={r.sourceUrl}>{r.title.length > 160 ? `${r.title.slice(0, 159)}…` : r.title}</Out>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-body text-muted-foreground">{empty}</p>
        )}
      </CardBody>
    </Card>
  );
}

const SMALL_LEDGERS: { title: string; kinds: OrderKind[]; empty: string }[] = [
  { title: "Bellwether orders", kinds: ["bellwether"], empty: "No bellwether order in the collected text." },
  { title: "Fact sheet orders", kinds: ["pfs"], empty: "No fact sheet order in the collected text." },
  { title: "Trial settings", kinds: ["trial_setting"], empty: "No trial setting in the collected text." },
  { title: "Leadership orders", kinds: ["leadership"], empty: "No leadership order in the collected text." },
  {
    title: "Settlement, common-benefit and special-master orders",
    kinds: ["settlement", "common_benefit", "special_master"],
    empty: "None in the collected text.",
  },
  {
    title: "Verdicts",
    kinds: ["verdict"],
    empty: "No jury verdict entry in the collected text.",
  },
  {
    title: "Bankruptcy and stay notices",
    kinds: ["bankruptcy_stay"],
    empty: "No suggestion of bankruptcy or stay notice in the collected text.",
  },
];

export function KeyOrdersSection({ cmd }: { cmd: MdlCommandPayload }) {
  const docs = useQuery({ ...mdlOrderDocumentsQuery(cmd.mdl), enabled: !!cmd.orders?.entries.length });
  if (!cmd.orders)
    return (
      <p className="text-body text-muted-foreground">
        {cmd.errors.includes("orders")
          ? "The master-docket text could not be read just now."
          : "No master-docket text is collected for this MDL."}
      </p>
    );
  const o = cmd.orders;
  const docket = docketSource(cmd);
  const items = kindItems(o.counts);
  const r = o.rule702;
  return (
    <div className="space-y-4">
      <ChartCard
        variant="editorial"
        title={
          items.length
            ? `${fmt(o.entries.length)} key docket entries classified in ${fmt(o.coverage.total ?? o.coverage.candidatesRead)} collected entries`
            : "Key docket entries by kind"
        }
        subtitle={`Entries per kind · master docket · rule ${ORDERS_RULE_VERSION}`}
        status={items.length ? { kind: "ready" } : { kind: "empty", reason: "No entry in the collected text matches an order pattern." }}
        sources={[docket]}
        partial={collectedNote(o.coverage.collectedThrough)}
        table={{
          caption: `MDL ${cmd.mdl}: classified docket entries by kind`,
          columns: [{ label: "Kind" }, { label: "Entries", align: "right" }, { label: "Latest", align: "right" }],
          rows: o.counts.map((c) => ({
            key: c.kind,
            cells: [ORDER_KIND_LABEL[c.kind], fmt(c.entries), c.latest ?? "Not recorded"],
          })),
        }}
        about={
          <p>
            Classified only from text that begins with the order's own wording; motions and notices
            keep their own kinds and are never counted as orders. An entry can carry more than one
            kind. {fmt(o.coverage.withheldTotal)} withheld entries are not classified.
          </p>
        }
      >
        <RankBars items={items} format={fmt} ariaLabel={`Classified docket entries by kind, MDL ${cmd.mdl}`} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Ledger cmd={cmd} kind="cmo" docs={docs.data} />
        <Ledger cmd={cmd} kind="pto" docs={docs.data} />
      </div>
      {docs.data && !docs.data.connected ? (
        <Note>Order documents are not linked yet: {docs.data.reason}</Note>
      ) : null}

      {r.rulings || r.motions ? (
        <KpiStrip
          label="Rule 702 rulings"
          cellBasis="basis-[calc(50%-1px)] xl:basis-[calc(20%-1px)]"
          items={[
            { key: "rulings", label: "Rule 702 rulings", value: fmt(r.rulings), meta: "Order entries" },
            { key: "denied", label: "Denied", value: fmt(r.byOutcome.denied) },
            { key: "granted", label: "Granted", value: fmt(r.byOutcome.granted) },
            { key: "part", label: "Granted in part", value: fmt(r.byOutcome.granted_in_part) },
            {
              key: "motions",
              label: "Rule 702 motions",
              value: fmt(r.motions),
              meta: `${fmt(r.byOutcome.not_stated)} rulings state no outcome`,
            },
          ]}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {r.rulings ? (
          <KindCard cmd={cmd} title="Rule 702 rulings" kinds={["rule702"]} empty="" />
        ) : null}
        {SMALL_LEDGERS.map((s) => (
          <KindCard key={s.title} cmd={cmd} title={s.title} kinds={s.kinds} empty={s.empty} />
        ))}
      </div>
    </div>
  );
}
