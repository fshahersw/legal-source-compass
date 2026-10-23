import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Adviser,
  BrokerDealer,
  CompanyRegulatory,
  FrbAction,
} from "@/lib/external/regulatoryRecords.functions";
import { cn } from "@/lib/utils";
import { Chip } from "../actions/bits";
import { MoreToggle, Panel, SourceLink, StateNote } from "../parts";
import {
  companyRegulatoryQuery,
  dayLabel,
  fmtInt,
  monthLabel,
  NOT_RECORDED,
  usdLabel,
} from "./regulatoryView";

const SHOWN = 8;

function SectionHead({
  title,
  count,
  total,
  note,
}: {
  title: string;
  count: number;
  total: number | null;
  note?: ReactNode;
}) {
  return (
    <div className="px-3 pb-1 pt-2.5">
      <h4 className="text-xs font-semibold">
        {title}{" "}
        <span className="font-normal text-muted-foreground">
          · {fmtInt(count)}
          {total != null && total > count ? ` of ${fmtInt(total)}` : ""}
        </span>
      </h4>
      {note ? <p className="text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Capped<T>({
  rows,
  id,
  noun,
  children,
}: {
  rows: T[];
  id: string;
  noun: string;
  children: (shown: T[]) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  return (
    <div className="px-2 pb-1">
      {children(all ? rows : rows.slice(0, SHOWN))}
      <div className="px-1">
        <MoreToggle
          total={rows.length}
          limit={SHOWN}
          expanded={all}
          onToggle={() => setAll((v) => !v)}
          controls={id}
          noun={noun}
        />
      </div>
    </div>
  );
}

const TH = "px-2 py-1.5 font-medium";

function FedTable({ rows, affiliation }: { rows: FrbAction[]; affiliation: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" id={affiliation ? "fed-affiliation" : "fed-subject"}>
        <caption className="sr-only">
          {affiliation
            ? "Federal Reserve actions against individuals affiliated with this company"
            : "Federal Reserve actions naming this company"}
        </caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Effective
            </th>
            <th scope="col" className={TH}>
              {affiliation ? "Individual (affiliation as listed)" : "Named (as listed)"}
            </th>
            <th scope="col" className={TH}>
              Action
            </th>
            <th scope="col" className={cn(TH, "hidden sm:table-cell")}>
              Terminated
            </th>
            <th scope="col" className={cn(TH, "hidden sm:table-cell")}>
              Document
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((a) => (
            <tr key={a.id} className="align-top">
              <td className="whitespace-nowrap px-2 py-1 font-mono">{a.effectiveDate}</td>
              <td className="min-w-[12rem] break-words px-2 py-1">
                {affiliation ? (
                  <>
                    <span className="font-medium">{a.individual ?? NOT_RECORDED}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {a.individualAffiliation ?? NOT_RECORDED}
                    </span>
                  </>
                ) : (
                  <span className="font-medium">{a.bankingOrganization ?? NOT_RECORDED}</span>
                )}
              </td>
              <td className="min-w-[8rem] break-words px-2 py-1">
                {a.type}
                {a.note ? (
                  <span className="block text-[11px] text-muted-foreground">{a.note}</span>
                ) : null}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-1 font-mono sm:table-cell">
                {a.terminationDate ?? (
                  <span className="font-sans text-muted-foreground">None published</span>
                )}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-1 sm:table-cell">
                {a.url ? (
                  <SourceLink href={a.url}>{a.urlLabel ?? "Board document"}</SourceLink>
                ) : (
                  <span className="text-muted-foreground">No link published</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BdTable({ rows }: { rows: BrokerDealer[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">SEC broker-dealer registration for this CIK</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Broker-dealer (as listed)
            </th>
            <th scope="col" className={cn(TH, "hidden sm:table-cell")}>
              File no.
            </th>
            <th scope="col" className={TH}>
              Listed on the SEC monthly lists
            </th>
            <th scope="col" className={cn(TH, "hidden md:table-cell")}>
              Address (as listed)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((b) => (
            <tr key={b.id} className="align-top">
              <td className="min-w-[12rem] break-words px-2 py-1">
                <SourceLink href={b.listingUrl}>{b.name}</SourceLink>
                {b.nameHistory.length > 1 ? (
                  <span className="block text-[11px] text-muted-foreground">
                    Also listed as{" "}
                    {b.nameHistory
                      .filter((h) => h.name !== b.name)
                      .map((h) => `${h.name} (${monthLabel(h.first)} to ${monthLabel(h.last)})`)
                      .join("; ")}
                  </span>
                ) : null}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-1 font-mono sm:table-cell">
                {b.fileNumber ?? NOT_RECORDED}
              </td>
              <td className="px-2 py-1">
                {monthLabel(b.firstListed)} to {monthLabel(b.lastListed)}
                <span className="block text-[11px] text-muted-foreground">
                  {fmtInt(b.monthsListed)} monthly files
                </span>
                <Chip tone="muted">
                  {b.inLatestFile
                    ? `In the ${monthLabel(b.latestFileMonth)} file`
                    : `Not in the ${monthLabel(b.latestFileMonth)} file`}
                </Chip>
              </td>
              <td className="hidden break-words px-2 py-1 md:table-cell">
                {[b.address, b.city, b.state].filter(Boolean).join(", ") || NOT_RECORDED}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdviserTable({ rows }: { rows: Adviser[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" id="advisers">
        <caption className="sr-only">SEC investment adviser registrations for this company</caption>
        <thead className="text-left text-[11px] text-muted-foreground">
          <tr>
            <th scope="col" className={TH}>
              Adviser (legal name as listed)
            </th>
            <th scope="col" className={TH}>
              Type
            </th>
            <th scope="col" className={cn(TH, "hidden sm:table-cell")}>
              CRD# / SEC#
            </th>
            <th
              scope="col"
              className={cn(TH, "text-right")}
              title="Item 5.F.(2)(c) of Form ADV, registered advisers only"
            >
              Regulatory AUM
            </th>
            <th
              scope="col"
              className={cn(TH, "hidden md:table-cell")}
              title="Form ADV Part 1A Item 11 question numbers answered Yes, as the SEC lists them (A and B criminal; C to E regulatory actions; F authorization revoked; G and H pending proceedings and court actions). The adviser's IAPD page has the disclosure text."
            >
              Item 11 Yes
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((a) => (
            <tr key={a.id} className="align-top">
              <td className="min-w-[12rem] break-words px-2 py-1">
                <SourceLink href={`https://adviserinfo.sec.gov/firm/summary/${a.crd}`}>
                  {a.legalName}
                </SourceLink>
                <span className="block text-[11px] text-muted-foreground">
                  {[a.city, a.state].filter(Boolean).join(", ") || NOT_RECORDED}
                  {a.status
                    ? ` · ${a.status}${a.statusEffectiveDate ? ` since ${dayLabel(a.statusEffectiveDate)}` : ""}`
                    : ""}
                </span>
                {a.matchMethod ? (
                  <span className="block text-[11px] text-muted-foreground">
                    Matched on {a.matchMethod}
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-2 py-1">
                {a.firmType === "Registered" ? "SEC-registered" : "Exempt reporting"}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-1 font-mono sm:table-cell">
                {a.crd}
                <span className="block">{a.secNumber ?? NOT_RECORDED}</span>
              </td>
              <td className="whitespace-nowrap px-2 py-1 text-right font-mono">
                {a.firmType === "Registered" ? (
                  usdLabel(a.regulatoryAumUsd)
                ) : (
                  <span className="font-sans text-muted-foreground">Not applicable</span>
                )}
              </td>
              <td className="hidden px-2 py-1 md:table-cell">
                {a.disclosureAny === "N" ? (
                  "None"
                ) : a.disclosureAny === "Y" ? (
                  a.disclosureYesItems.length ? (
                    a.disclosureYesItems.map((d) => d.item).join(", ")
                  ) : (
                    "Yes"
                  )
                ) : (
                  <span className="text-muted-foreground">{NOT_RECORDED}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RegulatoryBody({ d }: { d: CompanyRegulatory }) {
  const none =
    !d.fedSubject.length &&
    !d.fedAffiliation.length &&
    !d.brokerDealers.length &&
    !d.advisers.length;
  if (none)
    return (
      <div className="p-2">
        <StateNote>
          No Federal Reserve action names this company, and no SEC broker-dealer or
          investment-adviser registration carries its CIK.
          {d.nameKeyNote === "shared"
            ? " Another registrant has the same normalised name, so Federal Reserve actions are not matched by name."
            : d.nameKeyNote === "unknown"
              ? " This CIK has no company profile, so Federal Reserve actions cannot be matched by name."
              : " Names are matched only on the exact registrant name, so actions against subsidiaries or differently written names are not listed."}
        </StateNote>
      </div>
    );
  return (
    <div className="divide-y divide-border/60">
      {d.fedSubject.length ? (
        <section aria-label="Federal Reserve actions naming this company">
          <SectionHead
            title="Federal Reserve actions naming this company"
            count={d.fedSubject.length}
            total={d.totals.fedSubject}
          />
          <Capped rows={d.fedSubject} id="fed-subject" noun="actions">
            {(rows) => <FedTable rows={rows} affiliation={false} />}
          </Capped>
        </section>
      ) : null}
      {d.fedAffiliation.length ? (
        <section aria-label="Federal Reserve actions against individuals affiliated with this company">
          <SectionHead
            title="Federal Reserve actions against individuals affiliated with this company"
            count={d.fedAffiliation.length}
            total={d.totals.fedAffiliation}
            note="The Board names the person; this company appears only as the affiliation the Board lists for them. These are not actions against the company."
          />
          <Capped rows={d.fedAffiliation} id="fed-affiliation" noun="actions">
            {(rows) => <FedTable rows={rows} affiliation />}
          </Capped>
        </section>
      ) : null}
      {d.brokerDealers.length ? (
        <section aria-label="SEC broker-dealer registration">
          <SectionHead
            title="SEC broker-dealer registration"
            count={d.brokerDealers.length}
            total={d.totals.brokerDealers}
            note="Matched on the CIK. The SEC lists active broker-dealers monthly; the range is the first and last monthly list that includes this CIK."
          />
          <div className="px-2 pb-1">
            <BdTable rows={d.brokerDealers} />
          </div>
        </section>
      ) : null}
      {d.advisers.length ? (
        <section aria-label="SEC investment adviser registrations">
          <SectionHead
            title="SEC investment adviser registrations"
            count={d.advisers.length}
            total={d.totals.advisers}
            note="Matched on the CIK the adviser reports on Form ADV, or on an exact normalised legal name. From the SEC's October 2026 Form ADV report."
          />
          <Capped rows={d.advisers} id="advisers" noun="advisers">
            {(rows) => <AdviserTable rows={rows} />}
          </Capped>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Company-page panel: Federal Reserve enforcement actions, SEC broker-dealer registration and SEC investment-adviser
 * registrations for one company. Registrations match on the CIK; Federal Reserve actions only on an exact normalised name.
 */
export function RegulatoryRecordPanel({ cik, className }: { cik: string; className?: string }) {
  const q = useQuery(companyRegulatoryQuery(cik));
  const body = q.isLoading ? (
    <div className="p-2">
      <div
        className="h-24 animate-pulse rounded-md bg-muted/50"
        aria-busy="true"
        aria-label="Loading financial-regulator records"
      />
    </div>
  ) : q.isError ? (
    <div className="p-2">
      <StateNote
        tone="error"
        action={
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        }
      >
        Financial-regulator records could not be loaded.
      </StateNote>
    </div>
  ) : q.data ? (
    <RegulatoryBody d={q.data} />
  ) : null;
  return (
    <Panel
      title="Financial regulators"
      subtitle="Federal Reserve enforcement actions and SEC broker-dealer and investment-adviser registrations for this company"
      className={cn(className)}
      footnote="Federal Reserve rows are matched only when the banking organization's name equals this registrant's name after exact normalisation (case, punctuation, corporate suffixes) and no other registrant shares it. SEC registrations are matched on the CIK. Names, dates and actions are as the publishers list them; a termination date appears only where the Board publishes one."
    >
      {body}
    </Panel>
  );
}

/** Federal Reserve section only (for pages that already show registrations elsewhere). */
export function BankEnforcementPanel({ cik, className }: { cik: string; className?: string }) {
  const q = useQuery(companyRegulatoryQuery(cik));
  const d = q.data;
  return (
    <Panel
      title="Federal Reserve enforcement"
      subtitle="Formal actions the Board lists against this banking organization"
      className={cn(className)}
      footnote="Matched only on an exact normalised registrant name; the Board publishes no CIK. Dates and actions are as the Board lists them."
    >
      {q.isLoading ? (
        <div className="p-2">
          <div
            className="h-16 animate-pulse rounded-md bg-muted/50"
            aria-busy="true"
            aria-label="Loading Federal Reserve actions"
          />
        </div>
      ) : q.isError ? (
        <div className="p-2">
          <StateNote
            tone="error"
            action={
              <button type="button" className="underline" onClick={() => void q.refetch()}>
                Retry
              </button>
            }
          >
            Federal Reserve actions could not be loaded.
          </StateNote>
        </div>
      ) : d && d.fedSubject.length ? (
        <div className="px-2 py-1">
          <FedTable rows={d.fedSubject} affiliation={false} />
        </div>
      ) : (
        <div className="p-2">
          <StateNote>No Federal Reserve action names this company exactly.</StateNote>
        </div>
      )}
    </Panel>
  );
}
