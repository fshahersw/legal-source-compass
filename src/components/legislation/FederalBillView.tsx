import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Segmented, SourceLink } from "@/components/enforcement/parts";
import { Button } from "@/components/ui/button";
import { BIOGUIDE } from "@/lib/external/congressMembers";
import { getKnownMembers } from "@/lib/external/congressMembers.functions";
import type { CrsHit, FederalBill, Person } from "@/lib/external/legislation";
import { fmtDay, fmtN, NR } from "./format";
import { Capped, MilestoneTrack, Section, StatusChip } from "./parts";

const MILESTONE_RULE =
  "Derived only from published Congress.gov action codes (for example 8000 Passed/agreed to in House, 28000 Presented to President, 36000 Became Public Law); a stage without such an action is not recorded.";

/** Stages that can apply to the measure type: simple resolutions stay in one chamber, concurrent resolutions never go to
 * the President; bills and joint resolutions can reach every stage. A stage that happened is always shown. */
function applicable(b: FederalBill) {
  const own = b.type === "hres" ? "passed_house" : b.type === "sres" ? "passed_senate" : null;
  const skip = new Set<string>(
    own
      ? ["passed_house", "passed_senate", "to_president", "vetoed", "became_law"].filter(
          (k) => k !== own,
        )
      : b.type === "hconres" || b.type === "sconres"
        ? ["to_president", "vetoed", "became_law"]
        : [],
  );
  return b.milestones.filter((m) => m.date || !skip.has(m.key));
}

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Could not copy the ${what.toLowerCase()}`),
  );
}

export function FederalBillView({
  bill: b,
  crs,
  crsFailed = false,
}: {
  bill: FederalBill;
  crs: CrsHit[];
  crsFailed?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={b.status} label={b.statusLabel} />
        <span className="text-[12px] text-muted-foreground">
          {b.typeLabel} · introduced {fmtDay(b.introduced)}
          {b.policyArea ? ` · ${b.policyArea}` : ""}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {b.congressGovUrl ? (
            <Button asChild size="sm">
              <a href={b.congressGovUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 size-3.5" />
                Congress.gov
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => copy(b.display, "Citation")}>
            <Copy className="mr-1 size-3.5" />
            Copy citation
          </Button>
        </span>
      </div>
      {b.laws.length ? <LawCallout bill={b} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <LatestAction bill={b} />
          <Summary bill={b} />
          <Actions bill={b} />
          {b.votes.length ? <Votes bill={b} /> : null}
          {b.reports.length || b.cbo.length ? <Reports bill={b} /> : null}
          {b.texts.length ? <Texts bill={b} /> : null}
          {b.related.length ? <Related bill={b} /> : null}
          {crs.length || crsFailed ? <Crs items={crs} failed={crsFailed} /> : null}
        </div>
        <aside className="min-w-0 space-y-4">
          <MilestoneTrack milestones={applicable(b)} rule={MILESTONE_RULE} />
          <Sponsors bill={b} />
          {b.committees.length ? <Committees bill={b} /> : null}
          <Titles bill={b} />
          {b.subjects.length ? <Subjects bill={b} /> : null}
          <SourceBox bill={b} />
        </aside>
      </div>
    </div>
  );
}

function LawCallout({ bill: b }: { bill: FederalBill }) {
  const enacted = b.laws.filter((l) => l.resolution !== "inconsistent");
  return (
    <section
      aria-label="Resulting law"
      className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5"
    >
      <h2 className="m-0 flex items-center gap-1.5 text-sm font-semibold">
        <Landmark className="size-4" aria-hidden />
        {enacted.length
          ? `Became ${enacted.map((l) => l.label).join(" and ")}`
          : "Law number listed in the record"}
      </h2>
      <ul className="m-0 mt-1 list-none space-y-1 p-0 text-[12.5px]">
        {b.laws.map((l) => (
          <li key={l.number} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-medium">{l.label}</span>
            {l.recordId ? (
              <Link
                to="/records/$dataset/$id"
                params={{ dataset: "public_laws_enacted", id: l.recordId }}
                className="text-primary hover:underline"
              >
                Law record in the corpus
              </Link>
            ) : (
              <span className="text-[11.5px] text-muted-foreground">
                {l.resolution === "inconsistent"
                  ? "Listed in the Bill Status file, but this number's Congress is not the measure's Congress; shown as published, not linked."
                  : l.resolution === "ambiguous"
                    ? "The number matches more than one enacted-law record, so none is linked."
                    : l.resolution === "not_found"
                      ? "Not yet in the enacted-laws collection."
                      : "No corpus law record checked."}
              </span>
            )}
            {l.govinfo ? <SourceLink href={l.govinfo}>GovInfo</SourceLink> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LatestAction({ bill: b }: { bill: FederalBill }) {
  return (
    <Section title="Latest action" aside={b.latestAction ? fmtDay(b.latestAction.date) : undefined}>
      <p className="m-0 text-[13px]">{b.latestAction?.text ?? NR}</p>
    </Section>
  );
}

const SUMMARY_PREVIEW = 8;

function Summary({ bill: b }: { bill: FederalBill }) {
  const [open, setOpen] = useState(false);
  if (!b.summary)
    return (
      <Section title="CRS summary">
        <p className="m-0 text-[12.5px] text-muted-foreground">
          No CRS summary is published for this measure.
        </p>
      </Section>
    );
  const blocks = b.summary.blocks;
  const shown = open ? blocks : blocks.slice(0, SUMMARY_PREVIEW);
  return (
    <Section
      title="CRS summary"
      aside={`${b.summary.version ?? "Version not recorded"} · ${fmtDay(b.summary.date)}${b.summaryCount > 1 ? ` · latest of ${b.summaryCount}` : ""}`}
    >
      <div
        id="crs-summary"
        className="flex max-w-[80ch] flex-col gap-1.5 text-[13.5px] leading-relaxed"
      >
        {shown.map((blk, i) =>
          blk.kind === "li" ? (
            <p key={i} className="m-0 pl-4 before:-ml-3 before:mr-1.5 before:content-['•']">
              {blk.text}
            </p>
          ) : (
            <p key={i} className={blk.kind === "h" ? "m-0 font-semibold" : "m-0"}>
              {blk.text}
            </p>
          ),
        )}
      </div>
      {blocks.length > SUMMARY_PREVIEW ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="crs-summary"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 rounded text-[12px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {open ? "Show less" : `Show the full summary (${fmtN(blocks.length)} paragraphs)`}
        </button>
      ) : null}
      <p className="m-0 mt-2 text-[10.5px] text-muted-foreground">
        Written by the Congressional Research Service for the version named above, as published in
        the Bill Status file.
      </p>
    </Section>
  );
}

function Actions({ bill: b }: { bill: FederalBill }) {
  const [view, setView] = useState<"all" | "key">("all");
  const key = b.actions.filter((a) => a.code && /^\d+$/.test(a.code));
  const items = view === "key" ? key : b.actions;
  return (
    <Section
      title="Actions"
      aside={`${fmtN(b.actions.length)} action${b.actions.length === 1 ? "" : "s"}${
        b.actionsDroppedIdentical
          ? ` · ${fmtN(b.actionsDroppedIdentical)} identical ${b.actionsDroppedIdentical === 1 ? "copy" : "copies"} from another source system not repeated`
          : ""
      }`}
    >
      {key.length && key.length < b.actions.length ? (
        <div className="mb-2">
          <Segmented
            label="Which actions"
            value={view}
            options={[
              { id: "all", label: "All actions" },
              { id: "key", label: `Coded stages (${key.length})` },
            ]}
            onChange={setView}
          />
        </div>
      ) : null}
      {items.length ? (
        <Capped
          items={items}
          limit={12}
          noun="actions"
          className="divide-y divide-border/60"
          render={(a, i) => (
            <li
              key={i}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-1.5 text-[12.5px]"
            >
              <span className="tabular-nums text-muted-foreground">{fmtDay(a.date)}</span>
              <span className="min-w-0">
                {a.text}
                <span className="block text-[10.5px] text-muted-foreground">
                  {[a.chamber, a.source, a.code ? `code ${a.code}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  {a.votes.map((v) => {
                    const vote = b.votes[v];
                    return vote?.url ? (
                      <a
                        key={v}
                        href={vote.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-primary hover:underline"
                      >
                        Roll call {vote.roll ?? ""}
                      </a>
                    ) : null;
                  })}
                </span>
              </span>
            </li>
          )}
        />
      ) : (
        <p className="m-0 text-[12.5px] text-muted-foreground">No actions are published.</p>
      )}
    </Section>
  );
}

function Votes({ bill: b }: { bill: FederalBill }) {
  return (
    <Section title="Recorded votes" aside={`${b.votes.length}`}>
      <Capped
        items={b.votes}
        limit={8}
        noun="votes"
        className="space-y-1"
        render={(v, i) => (
          <li key={i} className="text-[12.5px]">
            <span className="tabular-nums text-muted-foreground">{fmtDay(v.date)}</span> ·{" "}
            {v.chamber ?? NR} roll call {v.roll ?? NR}
            {v.session ? ` (session ${v.session})` : ""}
            {v.url ? (
              <a
                href={v.url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-primary hover:underline"
              >
                Vote record
              </a>
            ) : null}
            {v.action ? (
              <span className="block text-[11px] text-muted-foreground">{v.action}</span>
            ) : null}
          </li>
        )}
      />
    </Section>
  );
}

function Reports({ bill: b }: { bill: FederalBill }) {
  return (
    <Section title="Committee reports and cost estimates">
      {b.reports.length ? (
        <ul className="m-0 list-none space-y-1 p-0 text-[12.5px]">
          {b.reports.map((r) => (
            <li key={r.citation}>
              {r.url ? <SourceLink href={r.url}>{r.citation}</SourceLink> : r.citation}
              {r.suffix ? (
                <span className="ml-2 text-[11px] text-muted-foreground">
                  link opens report {r.citation.split(",")[0]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {b.cbo.length ? (
        <>
          <h3 className="eyebrow mb-1 mt-2.5">Congressional Budget Office</h3>
          <ul className="m-0 list-none space-y-1 p-0 text-[12.5px]">
            {b.cbo.map((c, i) => (
              <li key={i}>
                {c.url ? <SourceLink href={c.url}>{c.title}</SourceLink> : c.title}
                <span className="block text-[11px] text-muted-foreground">
                  {fmtDay(c.date)}
                  {c.description ? ` · ${c.description}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

function Texts({ bill: b }: { bill: FederalBill }) {
  return (
    <Section title="Text versions" aside="GovInfo">
      <ul className="m-0 list-none space-y-1 p-0 text-[12.5px]">
        {b.texts.map((t, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{t.type}</span>
            <span className="text-muted-foreground">
              {t.date ? fmtDay(t.date) : "date not recorded"}
            </span>
            {t.details ? <SourceLink href={t.details}>GovInfo</SourceLink> : null}
            {t.url ? <SourceLink href={t.url}>XML</SourceLink> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Related({ bill: b }: { bill: FederalBill }) {
  return (
    <Section title="Related bills" aside={`${b.related.length} as published`}>
      <Capped
        items={b.related}
        limit={8}
        noun="related bills"
        className="space-y-1.5"
        render={(r, i) => (
          <li key={i} className="text-[12.5px]">
            {r.target ? (
              <Link
                to="/law/legislation/federal/$congress/$type/$number"
                params={r.target}
                className="font-medium text-primary hover:underline"
              >
                {r.citation}
              </Link>
            ) : (
              <span className="font-medium">{r.citation}</span>
            )}
            {r.title ? <span className="ml-1">{r.title}</span> : null}
            <span className="block text-[11px] text-muted-foreground">
              {r.relationships.join("; ") || "Relationship not recorded"}
              {r.latestAction ? ` · ${r.latestAction}` : ""}
            </span>
          </li>
        )}
      />
    </Section>
  );
}

function Crs({ items, failed }: { items: CrsHit[]; failed: boolean }) {
  return (
    <Section title="CRS reports that list this measure" aside="Congress.gov">
      {failed ? (
        <p role="alert" className="m-0 text-[12.5px] text-muted-foreground">
          The CRS report list could not load; reload the page to try again.
        </p>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0 text-[12.5px]">
          {items.map((c) => (
            <li key={c.id}>
              {c.url ? <SourceLink href={c.url}>{c.title}</SourceLink> : c.title}
              <span className="block text-[11px] text-muted-foreground">
                {c.id} · {c.type ?? "CRS product"} · updated {fmtDay(c.updated)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 mt-2 text-[11px] text-muted-foreground">
        Reports whose Congress.gov record names this measure among its related legislation. Only
        reports whose full record has been retrieved can be matched, so the list may be incomplete.
      </p>
    </Section>
  );
}

/** Bioguide ids of the bill's sponsors and cosponsors that have a member page (an exact id match; nothing else is linked). */
function useLinkedMembers(b: FederalBill): ReadonlySet<string> {
  const ids = useMemo(
    () =>
      [
        ...new Set(
          [...b.sponsors, ...b.cosponsors]
            .map((p) => p.bioguide)
            .filter((id): id is string => !!id && BIOGUIDE.test(id)),
        ),
      ].slice(0, 600),
    [b],
  );
  const fn = useServerFn(getKnownMembers);
  const q = useQuery({
    queryKey: ["known-members", b.id],
    queryFn: () => fn({ data: { ids } }),
    enabled: ids.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  return useMemo(() => new Set(q.data ?? []), [q.data]);
}

/** A sponsor's printed name, linked to the member page only when its Bioguide ID has a member record. */
function PersonName({ p, linked }: { p: Person; linked: ReadonlySet<string> }) {
  return p.bioguide && linked.has(p.bioguide) ? (
    <Link
      to="/law/legislation/members/$bioguide"
      params={{ bioguide: p.bioguide }}
      className="text-primary hover:underline"
    >
      {p.name}
    </Link>
  ) : (
    <>{p.name}</>
  );
}

function Sponsors({ bill: b }: { bill: FederalBill }) {
  const linked = useLinkedMembers(b);
  return (
    <Section title="Sponsor and cosponsors" aside={`${fmtN(b.cosponsorCount)} cosponsors`}>
      {b.sponsors.length ? (
        b.sponsors.map((s) => (
          <p key={s.name} className="m-0 text-[13px] font-medium">
            <PersonName p={s} linked={linked} />
            {s.byRequest ? (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                (by request)
              </span>
            ) : null}
          </p>
        ))
      ) : (
        <p className="m-0 text-[12.5px] text-muted-foreground">Sponsor {NR.toLowerCase()}.</p>
      )}
      {b.cosponsors.length ? (
        <div className="mt-2">
          <p className="m-0 mb-1 text-[11px] text-muted-foreground">
            {fmtN(b.originalCosponsorCount)} original
            {b.withdrawnCosponsorCount ? ` · ${fmtN(b.withdrawnCosponsorCount)} withdrawn` : ""}
          </p>
          <Capped
            items={b.cosponsors}
            limit={10}
            noun="cosponsors"
            className="space-y-0.5"
            render={(c) => (
              <li key={`${c.name}-${c.date}`} className="text-[12px]">
                <span className={c.withdrawn ? "line-through" : undefined}>
                  <PersonName p={c} linked={linked} />
                </span>
                <span className="ml-1 text-[10.5px] text-muted-foreground">
                  {fmtDay(c.date)}
                  {c.original ? " · original" : ""}
                  {c.withdrawn ? ` · withdrawn ${fmtDay(c.withdrawn)}` : ""}
                </span>
              </li>
            )}
          />
        </div>
      ) : null}
      <p className="m-0 mt-2 text-[10.5px] text-muted-foreground">
        Names, party and state as printed by Congress.gov.
      </p>
    </Section>
  );
}

function Committees({ bill: b }: { bill: FederalBill }) {
  const acts = (list: { name: string; date: string | null }[]) =>
    list.map((a) => `${a.name}${a.date ? ` ${fmtDay(a.date)}` : ""}`).join(" · ") || NR;
  return (
    <Section title="Committees" aside={`${b.committees.length}`}>
      <Capped
        items={b.committees}
        limit={6}
        noun="committees"
        className="space-y-2 text-[12.5px]"
        render={(c) => (
          <li key={c.name}>
            <span className="font-medium">{c.name}</span>
            {c.chamber ? (
              <span className="ml-1 text-[11px] text-muted-foreground">{c.chamber}</span>
            ) : null}
            <span className="block text-[11px] text-muted-foreground">{acts(c.activities)}</span>
            {c.subcommittees.map((sc) => (
              <span key={sc.name} className="block pl-3 text-[11px] text-muted-foreground">
                {sc.name}: {acts(sc.activities)}
              </span>
            ))}
          </li>
        )}
      />
    </Section>
  );
}

function Titles({ bill: b }: { bill: FederalBill }) {
  const all = [...b.officialTitles, ...b.shortTitles, ...b.otherTitles];
  return (
    <Section title="Titles">
      <Capped
        items={all}
        limit={4}
        noun="titles"
        className="space-y-1.5"
        render={(t, i) => (
          <li key={i} className="text-[12px]">
            <span className="block text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {t.type}
            </span>
            {t.title}
          </li>
        )}
      />
    </Section>
  );
}

function Subjects({ bill: b }: { bill: FederalBill }) {
  return (
    <Section title="Legislative subjects" aside={`${b.subjects.length}`}>
      <Capped
        items={b.subjects}
        limit={12}
        noun="subjects"
        className="flex flex-wrap gap-1"
        render={(s) => (
          <li key={s} className="rounded border border-border px-1.5 py-px text-[11px]">
            {s}
          </li>
        )}
      />
    </Section>
  );
}

function SourceBox({ bill: b }: { bill: FederalBill }) {
  return (
    <section
      aria-label="Source"
      className="rounded-md border border-border bg-surface p-3 text-[11px] leading-4 text-muted-foreground"
    >
      <p className="m-0">
        Source: GovInfo Bill Status XML (U.S. Government Publishing Office), public domain
        {b.updateDate ? `; record updated ${fmtDay(b.updateDate)}` : ""}
        {b.retrievedAt ? `; retrieved ${fmtDay(b.retrievedAt)}` : ""}.
      </p>
      <p className="m-0 mt-1 flex flex-wrap gap-x-3">
        {b.billStatusUrl ? <SourceLink href={b.billStatusUrl}>Bill Status XML</SourceLink> : null}
        {b.congressGovUrl ? (
          <SourceLink href={b.congressGovUrl}>Congress.gov page</SourceLink>
        ) : null}
      </p>
    </section>
  );
}
