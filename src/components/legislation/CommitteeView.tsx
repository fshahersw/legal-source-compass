import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { SourceLink, StateNote } from "@/components/enforcement/parts";
import { Button } from "@/components/ui/button";
import { congressRuns, type Committee, type CommitteeHit } from "@/lib/external/congressMembers";
import { fmtDay, fmtN, NR } from "./format";
import { Capped, Section, StatusChip } from "./parts";

export function CommitteeView({
  committee: c,
  children: subs,
}: {
  committee: Committee;
  children: CommitteeHit[];
}) {
  const coverage = congressRuns(c.congresses);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {c.current === true ? (
          <StatusChip status="became_law" label="Current" />
        ) : c.current === false ? (
          <StatusChip status="introduced" label="Historical" />
        ) : (
          <StatusChip status="introduced" label="Current status not recorded" />
        )}
        <span className="text-[12.5px] text-muted-foreground">
          {[
            c.chamber,
            c.level === "subcommittee" ? "Subcommittee" : c.type,
            c.parent ? `of ${c.parent.name ?? c.parent.code}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {c.website ? (
            <Button asChild size="sm">
              <a href={c.website} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 size-3.5" />
                Official website
              </a>
            </Button>
          ) : null}
        </span>
      </div>
      {!c.source.detailFetched ? (
        <StateNote>
          Only the list entry is stored for this committee: current status, website, parent,
          subcommittees, name history and counts are not recorded.
        </StateNote>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Section title="About" aside={c.id}>
            <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="m-0">{c.name}</dd>
              <dt className="text-muted-foreground">System code</dt>
              <dd className="m-0 font-mono text-[12px]">{c.id}</dd>
              <dt className="text-muted-foreground">Chamber</dt>
              <dd className="m-0">{c.chamber ?? NR}</dd>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="m-0">{c.type ?? NR}</dd>
              <dt className="text-muted-foreground">Parent committee</dt>
              <dd className="m-0">
                {c.parent ? (
                  c.parent.listed ? (
                    <Link
                      to="/law/legislation/committees/$code"
                      params={{ code: c.parent.code }}
                      className="text-primary hover:underline"
                    >
                      {c.parent.name ?? c.parent.code}
                    </Link>
                  ) : (
                    (c.parent.name ?? c.parent.code)
                  )
                ) : (
                  "None recorded"
                )}
              </dd>
              <dt className="text-muted-foreground">Congresses that list it</dt>
              <dd className="m-0">{coverage ?? NR}</dd>
            </dl>
            <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
              Congresses are those whose Congress.gov committee list names this committee; a
              Congress that does not list it is left out, not filled in.
            </p>
          </Section>
          {c.subcommittees.length ? (
            <Section title="Subcommittees" aside={`${c.subcommittees.length}`}>
              <Capped
                items={c.subcommittees}
                limit={12}
                noun="subcommittees"
                className="space-y-1 text-[12.5px]"
                render={(s) => {
                  const hit = subs.find((x) => x.id === s.code);
                  return (
                    <li key={s.code}>
                      {s.listed ? (
                        <Link
                          to="/law/legislation/committees/$code"
                          params={{ code: s.code }}
                          className="text-primary hover:underline"
                        >
                          {s.name ?? s.code}
                        </Link>
                      ) : (
                        (s.name ?? s.code)
                      )}
                      <span className="block text-[11px] text-muted-foreground">
                        {[
                          s.code,
                          hit?.current === false ? "Historical" : hit?.current ? "Current" : null,
                          hit?.congresses,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  );
                }}
              />
            </Section>
          ) : null}
          <Section
            title="Name history"
            aside={c.history.length ? `${c.history.length}` : undefined}
          >
            {c.history.length ? (
              <Capped
                items={c.history}
                limit={8}
                noun="entries"
                className="space-y-2 text-[12.5px]"
                render={(h, i) => (
                  <li key={`${h.startDate}-${i}`}>
                    <span className="font-medium">{h.officialName ?? h.shortName ?? NR}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {[
                        h.shortName && h.shortName !== h.officialName
                          ? `Library of Congress name: ${h.shortName}`
                          : null,
                        `${h.startDate ? fmtDay(h.startDate) : "Start not recorded"} – ${h.endDate ? fmtDay(h.endDate) : c.current ? "present" : "end not recorded"}`,
                        h.type,
                        h.establishingAuthority
                          ? `established by ${h.establishingAuthority}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                )}
              />
            ) : (
              <p className="m-0 text-[12.5px] text-muted-foreground">
                Name history {NR.toLowerCase()}.
              </p>
            )}
          </Section>
          <Section title="Membership">
            <p className="m-0 text-[12.5px] text-muted-foreground">
              The Congress.gov API publishes no committee membership, so none is shown and none is
              taken from another source.{" "}
              <Link to="/law/legislation/members" className="text-primary underline">
                Browse members of Congress
              </Link>
            </p>
          </Section>
        </div>
        <aside className="min-w-0 space-y-4">
          <Section title="Related material (API counts)">
            <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-muted-foreground">Reports</dt>
              <dd className="m-0 text-right tabular-nums">{fmtN(c.counts.reports)}</dd>
              <dt className="text-muted-foreground">Bills and resolutions</dt>
              <dd className="m-0 text-right tabular-nums">{fmtN(c.counts.bills)}</dd>
              <dt className="text-muted-foreground">Communications</dt>
              <dd className="m-0 text-right tabular-nums">{fmtN(c.counts.communications)}</dd>
              <dt className="text-muted-foreground">Nominations</dt>
              <dd className="m-0 text-right tabular-nums">{fmtN(c.counts.nominations)}</dd>
            </dl>
            <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
              Counts of items Congress.gov relates to this committee, as it reports them. A count
              the API does not give reads “Not recorded”; nominations are Senate only.
            </p>
          </Section>
          <Section title="Source">
            <ul className="m-0 list-none space-y-1 p-0 text-[12px]">
              {c.source.api ? (
                <li>
                  <SourceLink href={c.source.api}>Congress.gov API record</SourceLink>
                </li>
              ) : null}
              {c.website ? (
                <li>
                  <SourceLink href={c.website}>Official website</SourceLink>
                </li>
              ) : null}
            </ul>
            <p className="m-0 mt-2 text-[10.5px] leading-4 text-muted-foreground">
              Congress.gov (Library of Congress), retrieved{" "}
              {c.source.retrievedAt ? fmtDay(c.source.retrievedAt.slice(0, 10)) : NR}; record last
              updated there {fmtDay(c.source.updateDate)}. Shown as published; nothing is inferred.
            </p>
          </Section>
        </aside>
      </div>
    </div>
  );
}
