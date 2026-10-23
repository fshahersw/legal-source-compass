import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Landmark } from "lucide-react";
import { Segmented, SourceLink, StateNote } from "@/components/enforcement/parts";
import { StaticTrend, TrendGrid } from "@/components/trends/ProfileTrend";
import { staticDef } from "@/components/trends/trendDefs";
import { Button } from "@/components/ui/button";
import { districtText, type Member, type MemberTerm } from "@/lib/external/congressMembers";
import {
  getMemberCosponsored,
  getMemberSponsored,
  type MemberBillsResult,
} from "@/lib/external/congressMembers.functions";
import { displayCitation, ordinal, TYPE_CITE, type BillType } from "@/lib/external/legislation";
import {
  buildMemberBillsByCongress,
  memberBillsTitle,
  type MemberBillsKind,
} from "@/lib/trends/congressMember";
import { fmtDay, fmtN, NR } from "./format";
import { Capped, Section, StatusChip } from "./parts";
import { PartyChip } from "./MemberSearch";
/** The member's portrait exactly as Congress.gov gives it, with the credit the API gives; nothing is drawn if it fails. */
export function MemberPortrait({ member }: { member: Member }) {
  const [failed, setFailed] = useState(false);
  const p = member.portrait;
  if (!p || failed) return null;
  return (
    <figure className="m-0 w-28 shrink-0">
      <img
        src={p.imageUrl}
        alt={`${member.directName ?? member.name}, official portrait`}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-36 w-28 rounded-md border border-border object-cover object-top"
        onError={() => setFailed(true)}
      />
      {p.creditText ? (
        <figcaption className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {p.creditUrl ? (
            <a
              href={p.creditUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2"
            >
              {p.creditText}
            </a>
          ) : (
            p.creditText
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}

const dash = (a: number | null, b: number | null, open: string) =>
  a === null ? NR : b === null ? `${a}–${open}` : a === b ? String(a) : `${a}–${b}`;

export function MemberView({ member: m }: { member: Member }) {
  const latestParty = m.partyHistory.length ? m.partyHistory[m.partyHistory.length - 1]! : null;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <MemberPortrait member={m} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <PartyChip
              party={latestParty?.party ?? null}
              abbreviation={latestParty?.abbreviation ?? null}
            />
            {m.current === true ? (
              <StatusChip status="became_law" label="Currently serving" />
            ) : m.current === false ? (
              <StatusChip status="introduced" label="Not currently serving" />
            ) : (
              <StatusChip status="introduced" label="Current status not recorded" />
            )}
            <span className="text-[12.5px] text-muted-foreground">
              {[m.memberType ?? m.chamber, m.state, districtText(m.district, m.chamber)]
                .filter(Boolean)
                .join(" · ") || NR}
            </span>
          </div>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="m-0">{m.name}</dd>
            <dt className="text-muted-foreground">Years of service</dt>
            <dd className="m-0">{m.years ?? NR}</dd>
            <dt className="text-muted-foreground">Born / died</dt>
            <dd className="m-0">
              {m.birthYear ?? NR} / {m.deathYear ?? NR}
            </dd>
            <dt className="text-muted-foreground">Bioguide ID</dt>
            <dd className="m-0 font-mono text-[12px]">{m.id}</dd>
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            {m.website ? (
              <Button asChild size="sm">
                <a href={m.website} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1 size-3.5" />
                  Official website
                </a>
              </Button>
            ) : null}
            {m.source.bioguide ? (
              <Button asChild size="sm" variant="outline">
                <a href={m.source.bioguide} target="_blank" rel="noreferrer">
                  <Landmark className="mr-1 size-3.5" />
                  Biographical Directory
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {!m.source.detailFetched ? (
        <StateNote>
          Only the member list entry is stored for this person: party history, terms by Congress,
          the official website and Congress.gov's counts are not recorded.
        </StateNote>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <BillCharts member={m} />
          <MemberBillsList member={m} />
          <Committees />
        </div>
        <aside className="min-w-0 space-y-4">
          <Terms member={m} />
          <Parties member={m} />
          {m.leadership.length ? <Leadership member={m} /> : null}
          <Reported member={m} />
          <SourceBox member={m} />
        </aside>
      </div>
    </div>
  );
}

function BillCharts({ member: m }: { member: Member }) {
  const cards = useMemo(
    () =>
      (["sponsored", "cosponsored"] as const).map((kind) => ({
        kind,
        block: buildMemberBillsByCongress(m, kind),
        def: staticDef({
          id: `member-${kind}-${m.id}`,
          title: memberBillsTitle(kind),
          measure: kind === "sponsored" ? "Measures sponsored" : "Measures cosponsored",
          detail: { to: "/law/legislation", label: "Browse bills" },
          group: "rulemaking",
        }),
      })),
    [m],
  );
  return (
    <TrendGrid columns={2}>
      {cards.map((c) => (
        <StaticTrend
          key={c.kind}
          def={c.def}
          block={c.block}
          emptyReason={
            m.bills
              ? "No term of this member falls in the 108th–119th Congress, the range of the stored bill records, so no count is shown."
              : "The bill counts for this member are not recorded."
          }
        />
      ))}
    </TrendGrid>
  );
}

function Reported({ member: m }: { member: Member }) {
  const r = m.reported;
  const b = m.bills;
  return (
    <Section title="Legislation counts">
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-muted-foreground">Sponsored, as Congress.gov counts it</dt>
        <dd className="m-0 text-right tabular-nums">{fmtN(r.sponsored)}</dd>
        <dt className="text-muted-foreground">Cosponsored, as Congress.gov counts it</dt>
        <dd className="m-0 text-right tabular-nums">{fmtN(r.cosponsored)}</dd>
        {b ? (
          <>
            <dt className="text-muted-foreground">Sponsored, in the stored bill records</dt>
            <dd className="m-0 text-right tabular-nums">{fmtN(b.sponsoredTotal)}</dd>
            <dt className="text-muted-foreground">Cosponsored, in the stored bill records</dt>
            <dd className="m-0 text-right tabular-nums">{fmtN(b.cosponsoredTotal)}</dd>
          </>
        ) : null}
      </dl>
      <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
        Congress.gov's totals{r.retrieved ? ` (retrieved ${fmtDay(r.retrieved)})` : ""} span every
        Congress in its data. The lists behind them can include amendments, which the stored bill
        records do not hold, and cosponsored totals exclude withdrawn cosponsorships. The stored
        bill records cover the {b?.coverage ?? "108th–119th Congress"} only
        {b?.retrieved ? ` (taken ${fmtDay(b.retrieved)})` : ""}; a measure counts as sponsored when
        the member is its first-listed sponsor.{" "}
        {b && !b.servedOnlyInCollection
          ? "This member also served before the 108th Congress, so the two sets of totals are not expected to match."
          : "The two sets are therefore not expected to match: amendments, and measures or cosponsorships added after the bill records were taken, can account for the difference."}
      </p>
    </Section>
  );
}

function Terms({ member: m }: { member: Member }) {
  return (
    <Section
      title="Service by Congress"
      aside={`${m.terms.length} term${m.terms.length === 1 ? "" : "s"}`}
    >
      {m.terms.length ? (
        <Capped
          items={[...m.terms].reverse()}
          limit={8}
          noun="terms"
          className="space-y-1"
          render={(t: MemberTerm, i) => (
            <li key={`${t.congress}-${t.startYear}-${i}`} className="text-[12.5px]">
              <span className="font-medium">
                {t.congress ? `${ordinal(t.congress)} Congress` : "Congress not recorded"}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {[
                  t.memberType ?? t.chamber,
                  t.stateName,
                  districtText(t.district, t.chamber),
                  dash(t.startYear, t.endYear, ""),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          )}
        />
      ) : (
        <p className="m-0 text-[12.5px] text-muted-foreground">Terms {NR.toLowerCase()}.</p>
      )}
      <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
        As published by Congress.gov. A term with no end year is not over, or the end is not
        recorded.
      </p>
    </Section>
  );
}

function Parties({ member: m }: { member: Member }) {
  return (
    <Section title="Party history">
      {m.partyHistory.length ? (
        <ul className="m-0 list-none space-y-0.5 p-0 text-[12.5px]">
          {m.partyHistory.map((p, i) => (
            <li key={`${p.party}-${p.startYear}-${i}`}>
              <span className="font-medium">{p.party}</span>
              {p.abbreviation ? (
                <span className="text-muted-foreground"> ({p.abbreviation})</span>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {p.listOnly
                  ? " · current party on the member list"
                  : p.startYear
                    ? ` · from ${p.startYear}`
                    : " · start year not recorded"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[12.5px] text-muted-foreground">Party {NR.toLowerCase()}.</p>
      )}
      <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
        Congress.gov gives the year each party began; it does not give when an earlier one ended, so
        none is shown.
      </p>
    </Section>
  );
}

function Leadership({ member: m }: { member: Member }) {
  return (
    <Section title="Leadership posts">
      <ul className="m-0 list-none space-y-0.5 p-0 text-[12.5px]">
        {m.leadership.map((l, i) => (
          <li key={`${l.type}-${l.congress}-${i}`}>
            {l.type}
            <span className="text-[11px] text-muted-foreground">
              {l.congress ? ` · ${ordinal(l.congress)} Congress` : ""}
              {l.current ? " · current" : ""}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Committees() {
  return (
    <Section title="Committee assignments">
      <p className="m-0 text-[12.5px] text-muted-foreground">
        The Congress.gov API publishes no committee membership, so none is shown here and none is
        taken from another source.{" "}
        <Link to="/law/legislation/committees" className="text-primary underline">
          Browse committees
        </Link>
      </p>
    </Section>
  );
}

function SourceBox({ member: m }: { member: Member }) {
  return (
    <Section title="Source">
      <ul className="m-0 list-none space-y-1 p-0 text-[12px]">
        {m.source.api ? (
          <li>
            <SourceLink href={m.source.api}>Congress.gov API record</SourceLink>
          </li>
        ) : null}
        {m.source.bioguide ? (
          <li>
            <SourceLink href={m.source.bioguide}>
              Biographical Directory of the United States Congress
            </SourceLink>
          </li>
        ) : null}
        {m.website ? (
          <li>
            <SourceLink href={m.website}>Official website</SourceLink>
          </li>
        ) : null}
      </ul>
      <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
        Congress.gov (Library of Congress), retrieved{" "}
        {m.source.retrievedAt ? fmtDay(m.source.retrievedAt.slice(0, 10)) : NR}; record last updated
        there {fmtDay(m.source.updateDate)}. Names, terms and parties are shown as published;
        nothing is inferred.
      </p>
    </Section>
  );
}

/* ---------- the member's measures ---------- */

const PAGE = 25;

function MemberBillsList({ member: m }: { member: Member }) {
  const [kind, setKind] = useState<MemberBillsKind>("sponsored");
  const [congress, setCongress] = useState<string>("");
  const [page, setPage] = useState(1);
  const sponsoredFn = useServerFn(getMemberSponsored);
  const cosponsoredFn = useServerFn(getMemberCosponsored);
  const served = m.bills?.congressesServed ?? [];
  const q = useQuery({
    queryKey: ["member-bills", m.id, kind, congress, page],
    queryFn: () => {
      const data = { bioguide: m.id, page, ...(congress ? { congress } : {}) };
      return kind === "sponsored" ? sponsoredFn({ data }) : cosponsoredFn({ data });
    },
    placeholderData: keepPreviousData,
    staleTime: 10 * 60 * 1000,
    enabled: !!m.bills,
  });
  return (
    <Section
      title="Measures in the stored bill records"
      aside={m.bills ? m.bills.coverage : undefined}
      id="measures"
    >
      {!m.bills ? (
        <p className="m-0 text-[12.5px] text-muted-foreground">
          No bill counts are recorded for this member.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Segmented
              label="Sponsored or cosponsored"
              value={kind}
              options={[
                { id: "sponsored", label: `Sponsored (${fmtN(m.bills.sponsoredTotal)})` },
                { id: "cosponsored", label: `Cosponsored (${fmtN(m.bills.cosponsoredTotal)})` },
              ]}
              onChange={(id) => {
                setKind(id);
                setPage(1);
              }}
            />
            <select
              aria-label="Congress"
              value={congress}
              onChange={(e) => {
                setCongress(e.target.value);
                setPage(1);
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-[12.5px] focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value="">All Congresses served in the collection</option>
              {[...served].reverse().map((c) => (
                <option key={c} value={String(c)}>
                  {ordinal(c)} Congress
                </option>
              ))}
            </select>
          </div>
          {q.isLoading ? (
            <div className="space-y-1.5" aria-busy="true" aria-label="Loading measures">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-md border border-border bg-muted/40"
                />
              ))}
            </div>
          ) : q.isError ? (
            <StateNote
              tone="error"
              action={
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => void q.refetch()}
                >
                  Retry
                </button>
              }
            >
              The measures could not be loaded.
            </StateNote>
          ) : q.data ? (
            <BillRows r={q.data} kind={kind} onPage={setPage} fetching={q.isFetching} />
          ) : (
            <p className="m-0 text-[12.5px] text-muted-foreground">
              The cosponsored list for this member is not stored.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function BillRows({
  r,
  kind,
  onPage,
  fetching,
}: {
  r: MemberBillsResult;
  kind: MemberBillsKind;
  onPage: (p: number) => void;
  fetching: boolean;
}) {
  const last = r.total != null ? Math.max(1, Math.ceil(r.total / r.pageSize)) : null;
  const shown = r.rows.length + r.missing.length;
  const from = (r.page - 1) * r.pageSize + 1;
  return (
    <div aria-busy={fetching} className={fetching ? "opacity-70" : undefined}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span role="status">
          {shown
            ? `${fmtN(from)}–${fmtN(from + shown - 1)} of ${r.total != null ? fmtN(r.total) : "too large to count"} measures ${kind === "sponsored" ? "sponsored" : "cosponsored"}`
            : `No measure ${kind === "sponsored" ? "sponsored" : "cosponsored"} is stored for this selection.`}
        </span>
        {shown ? (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={r.page <= 1}
              onClick={() => onPage(r.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular-nums">
              Page {r.page}
              {last ? ` of ${fmtN(last)}` : ""}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={(last != null && r.page >= last) || shown < r.pageSize}
              onClick={() => onPage(r.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </span>
        ) : null}
      </div>
      {shown ? (
        <ol className="m-0 list-none divide-y divide-border/70 overflow-hidden rounded-md border border-border p-0">
          {r.rows.map((h) => (
            <li key={h.id} className="px-3 py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to="/law/legislation/federal/$congress/$type/$number"
                  params={{ congress: String(h.congress), type: h.type, number: h.number }}
                  className="font-semibold text-primary hover:underline"
                >
                  {h.citation}
                </Link>
                <StatusChip status={h.status} label={h.statusLabel} />
              </div>
              <p className="m-0 line-clamp-2 text-[12.5px]">{h.title}</p>
              <p className="m-0 text-[11px] text-muted-foreground">
                Introduced {fmtDay(h.introduced)}
                {kind === "cosponsored" && h.sponsor ? ` · Sponsor ${h.sponsor}` : ""}
              </p>
            </li>
          ))}
          {r.missing.map((x) => (
            <li key={`${x.congress}-${x.type}-${x.number}`} className="px-3 py-1.5 text-[12.5px]">
              {displayCitation(x.type as BillType, x.number, x.congress)}
              <span className="block text-[11px] text-muted-foreground">
                No stored bill record for this measure ({TYPE_CITE[x.type as BillType]} {x.number});
                not linked.
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
