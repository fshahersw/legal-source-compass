import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { SourceLink } from "@/components/enforcement/parts";
import { Button } from "@/components/ui/button";
import type { StateBill } from "@/lib/external/legislation";
import { fmtDay, fmtN, NR } from "./format";
import { Capped, MilestoneTrack, Section, StatusChip } from "./parts";

const RULE =
  "From Open States' own action classifications (introduction, passage by each chamber, executive signature or veto, became law); a stage Open States did not classify is not recorded, even if it happened.";

const KIND_BUTTON = {
  page: "Legislature page",
  search: "Legislature bill search",
  data: "Legislature data feed",
};
const KIND_LABEL = {
  page: "bill page",
  search: "search or status start page, not specific to this bill",
  data: "machine data feed",
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function StateBillView({ bill: b }: { bill: StateBill }) {
  const label = `${b.identifier} (${b.stateName}, ${b.session.name})`;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={b.status} label={b.statusLabel} />
        <span className="text-[12px] text-muted-foreground">
          {b.session.name}
          {b.session.role ? ` (${b.session.role} session)` : ""}
          {b.classification.length ? ` · ${b.classification.join(", ")}` : ""}
          {b.chamber ? ` · ${b.chamber}` : ""}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {b.officialSources[0] ? (
            <Button asChild size="sm">
              <a href={b.officialSources[0].url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 size-3.5" />
                {KIND_BUTTON[b.officialSources[0].kind ?? "page"]}
              </a>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard.writeText(label).then(
                () => toast.success("Citation copied"),
                () => toast.error("Could not copy the citation"),
              )
            }
          >
            <Copy className="mr-1 size-3.5" />
            Copy citation
          </Button>
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Section title="Title">
            <p className="m-0 text-[13.5px] leading-relaxed">{b.title}</p>
          </Section>
          <Section
            title="Latest action"
            aside={b.latestAction ? fmtDay(b.latestAction.date) : undefined}
          >
            <p className="m-0 text-[13px]">{b.latestAction?.description ?? NR}</p>
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              First action {fmtDay(b.firstActionDate)} · {fmtN(b.actionCount)} actions recorded
            </p>
          </Section>
          <Section
            title="Actions"
            aside={
              b.actions.length < b.actionCount
                ? `latest ${fmtN(b.actions.length)} of ${fmtN(b.actionCount)}`
                : `${fmtN(b.actionCount)}`
            }
          >
            {b.actions.length ? (
              <Capped
                items={[...b.actions].reverse()}
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
                        {[a.org, a.classification.join(", ")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </li>
                )}
              />
            ) : (
              <p className="m-0 text-[12.5px] text-muted-foreground">
                Open States records no action for this bill.
              </p>
            )}
          </Section>
          <Documents title="Versions" items={b.versions} empty="No bill version is recorded." />
          {b.documents.length ? <Documents title="Documents" items={b.documents} empty="" /> : null}
        </div>
        <aside className="min-w-0 space-y-4">
          <MilestoneTrack
            milestones={b.milestones.filter(
              (m) =>
                !(
                  (m.key === "passed_lower" || m.key === "passed_upper") &&
                  !m.date &&
                  b.milestones.some((x) => x.key === "passed_legislature" && x.date)
                ),
            )}
            rule={RULE}
            hideUnreached={["executive_veto", "passed_legislature"]}
          />
          <Section title="Sponsors" aside={`${b.sponsors.length}`}>
            {b.sponsors.length ? (
              <Capped
                items={b.sponsors}
                limit={10}
                noun="sponsors"
                className="space-y-0.5"
                render={(s, i) => (
                  <li key={i} className="text-[12.5px]">
                    <span className={s.primary ? "font-medium" : undefined}>{s.name}</span>
                    <span className="ml-1 text-[10.5px] text-muted-foreground">
                      {s.primary ? "primary" : (s.classification ?? "cosponsor")}
                    </span>
                  </li>
                )}
              />
            ) : (
              <p className="m-0 text-[12.5px] text-muted-foreground">No sponsor recorded.</p>
            )}
            <p className="m-0 mt-2 text-[10.5px] text-muted-foreground">
              Names as the legislature publishes them.
            </p>
          </Section>
          {b.subjects.length ? (
            <Section title="Subjects">
              <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                {b.subjects.map((s) => (
                  <li key={s} className="rounded border border-border px-1.5 py-px text-[11px]">
                    {s}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <section
            aria-label="Sources"
            className="rounded-md border border-border bg-surface p-3 text-[11px] leading-4 text-muted-foreground"
          >
            <p className="m-0 font-medium text-foreground">Official sources</p>
            {b.officialSources.length ? (
              <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                {b.officialSources.map((s) => (
                  <li key={s.url}>
                    <SourceLink href={s.url}>{s.note || host(s.url)}</SourceLink>
                    <span className="ml-1">({KIND_LABEL[s.kind ?? "page"]})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-1">No legislature page is recorded for this bill.</p>
            )}
            <p className="m-0 mt-2">
              Collected by Open States from the legislature's website (public domain dedication).
              {b.openStatesUrl ? (
                <>
                  {" "}
                  <SourceLink href={b.openStatesUrl}>Open States page</SourceLink>
                </>
              ) : null}
            </p>
            <p className="m-0 mt-2">
              <Link
                to="/law/legislation"
                search={{ scope: "state", state: b.state, session: b.session.id }}
                className="text-primary hover:underline"
              >
                More {b.stateName} bills, {b.session.name}
              </Link>
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Documents({
  title,
  items,
  empty,
}: {
  title: string;
  items: StateBill["versions"];
  empty: string;
}) {
  return (
    <Section title={title} aside={items.length ? `${items.length}` : undefined}>
      {items.length ? (
        <Capped
          items={items}
          limit={8}
          noun={title.toLowerCase()}
          className="space-y-1"
          render={(v, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
              <span className="font-medium">{v.note ?? "Untitled"}</span>
              <span className="text-muted-foreground">{v.date ? fmtDay(v.date) : ""}</span>
              {v.links.map((l) => (
                <SourceLink key={l.url} href={l.url}>
                  {l.mediaType === "application/pdf"
                    ? "PDF"
                    : l.mediaType?.includes("html")
                      ? "HTML"
                      : host(l.url)}
                </SourceLink>
              ))}
            </li>
          )}
        />
      ) : (
        <p className="m-0 text-[12.5px] text-muted-foreground">{empty}</p>
      )}
    </Section>
  );
}
