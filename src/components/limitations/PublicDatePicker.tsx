/**
 * "Look up a product or event": suggested public dates from corpus records the user picks by exact identifier.
 * A date reaches the calculator only through the parent's onAccept, which uses the calculator's own fact editor (that
 * resets the legal confirmations). Selections stay in memory; nothing goes in the URL; nothing is applied on its own.
 */
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover, StatusPill } from "@/components/kit";
import {
  EVENT_LABELS,
  IDENTIFIER_HINTS,
  KIND_LABELS,
  PICKER_CLAIMS,
  exactIdentifier,
  isAfterReviewCutoff,
  suggestibleFields,
  type AcceptedPublicDate,
  type AcceptedPublicDates,
  type PublicDateCandidate,
  type PublicDateEvent,
  type PublicDateKind,
  type SuggestibleField,
} from "@/lib/limitations/publicDates";
import { getPublicDates, searchPublicDateSources } from "@/lib/limitations/publicDates.functions";
import type { ClaimType, LimitationRule } from "@/lib/limitations/types";

type Tab = "mdl" | "application" | "pma" | "recall";
const TABS: { id: Tab; label: string }[] = [
  { id: "mdl", label: "MDL" },
  { id: "application", label: "FDA application" },
  { id: "pma", label: "PMA" },
  { id: "recall", label: "Recall" },
];
const RECALL_KINDS = ["fda_drug_recall", "fda_device_recall", "cpsc_recall", "nhtsa_recall"] as const;
const control =
  "block min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const staleTime = 10 * 60 * 1000;

/** The picker is offered only for injury, product and warranty claims. */
export function pickerApplies(claim: ClaimType | undefined): boolean {
  return !!claim && (PICKER_CLAIMS as readonly string[]).includes(claim);
}

function kindFor(tab: Tab, recallKind: (typeof RECALL_KINDS)[number], q: string): PublicDateKind {
  if (tab === "mdl") return "mdl";
  if (tab === "application") return "drug_application";
  if (tab === "pma") return "device_pma";
  // An identifier-shaped recall number names its own source.
  for (const k of RECALL_KINDS) if (exactIdentifier(k, q) && k !== "cpsc_recall") return k;
  return recallKind;
}

type PickerProps = {
  rule: LimitationRule | null;
  dateFields: readonly { key: string; label: string }[];
  /** The rule's source review date; chips after it are disabled. */
  cutoff: string | null;
  values: Partial<Record<SuggestibleField, string | undefined>>;
  accepted: AcceptedPublicDates;
  onAccept: (field: SuggestibleField, candidate: PublicDateCandidate) => void;
};

/** Collapsed until the user opens it: no record is read before they ask. */
export function PublicDatePicker(props: PickerProps) {
  const [open, setOpen] = useState(false);
  const fields = suggestibleFields(props.rule, props.dateFields);
  if (!fields.length) return null;
  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border p-3 text-xs">
        <span className="text-muted-foreground">
          Need a public date (MDL transfer, recall, label change)? Suggestions only; never applied
          until you choose.
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          Look up a product or event
        </Button>
      </div>
    );
  return <PickerBody {...props} />;
}

function PickerBody({ rule, dateFields, cutoff, values, accepted, onAccept }: PickerProps) {
  const [tab, setTab] = useState<Tab>("mdl");
  const [recallKind, setRecallKind] = useState<(typeof RECALL_KINDS)[number]>("fda_device_recall");
  const [text, setText] = useState("");
  const [search, setSearch] = useState<{ kind: PublicDateKind; q: string } | null>(null);
  const [selected, setSelected] = useState<{ kind: PublicDateKind; id: string } | null>(null);
  const fields = suggestibleFields(rule, dateFields);

  const hits = useQuery({
    queryKey: ["limitations-public-search", search?.kind, search?.q],
    queryFn: () => searchPublicDateSources({ data: { kind: search!.kind, q: search!.q } }),
    enabled: !!search,
    staleTime,
  });
  const dates = useQuery({
    queryKey: ["limitations-public-dates", selected?.kind, selected?.id],
    queryFn: () => getPublicDates({ data: { kind: selected!.kind, id: selected!.id } }),
    enabled: !!selected,
    staleTime,
  });

  const run = (kind: PublicDateKind, q: string) => {
    const exact = exactIdentifier(kind, q);
    if (exact) {
      setSearch(null);
      setSelected({ kind, id: exact });
    } else {
      setSelected(null);
      setSearch({ kind, q: q.trim() });
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    run(kindFor(tab, recallKind, text), text);
  };
  const hintKind = kindFor(tab, recallKind, text);
  const groups = new Map<PublicDateEvent, PublicDateCandidate[]>();
  for (const c of dates.data?.candidates ?? [])
    groups.set(c.eventType, [...(groups.get(c.eventType) ?? []), c]);

  return (
    <section
      aria-label="Suggested public dates"
      className="rounded-md border border-border bg-muted/20 p-3 sm:p-4"
      data-testid="public-date-picker"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Look up a product or event</h4>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Suggested public dates. Not legal triggers. Whether a public event bears on accrual or
            reasonable discovery is a legal judgement you make.
          </p>
        </div>
        <InfoPopover label="About suggested dates">
          <p>
            Dates come from official records in the corpus that you choose by exact identifier.
            Nothing is matched by name and nothing is applied until you press “Use for”.
          </p>
          <p className="mt-2">
            Accepting a date fills one field and clears your legal confirmations, so you must tick
            them again. Only these fields can receive a suggestion:{" "}
            {fields.map((f) => f.label).join("; ")}. Look-ups send only the identifier or words you
            type, never your case facts.
          </p>
        </InfoPopover>
      </div>
      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Record type">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setSearch(null);
            }}
            className={
              "min-h-9 rounded-md px-3 text-xs font-medium " +
              (tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        {tab === "recall" && (
          <label className="sm:w-48">
            <span className="sr-only">Recall source</span>
            <select
              className={control}
              value={recallKind}
              onChange={(e) => setRecallKind(e.target.value as (typeof RECALL_KINDS)[number])}
            >
              {RECALL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="min-w-0 flex-1">
          <span className="sr-only">Identifier or words</span>
          <input
            className={control}
            value={text}
            maxLength={120}
            onChange={(e) => setText(e.target.value)}
            placeholder={`${IDENTIFIER_HINTS[hintKind]}, or words to search`}
            autoComplete="off"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" className="min-h-10">
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          Look up
        </Button>
      </form>

      {search && (
        <div className="mt-3 text-sm" aria-live="polite">
          {hits.isPending && <p className="text-muted-foreground">Searching…</p>}
          {hits.isError && (
            <p role="alert">
              The search could not be run.{" "}
              <button type="button" className="text-primary underline" onClick={() => void hits.refetch()}>
                Retry
              </button>
            </p>
          )}
          {hits.data && hits.data.hits.length === 0 && (
            <p className="text-muted-foreground">No records match. Try the exact identifier.</p>
          )}
          {hits.data && hits.data.hits.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Choose the record you mean. Words never select a record by themselves.
              </p>
              <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border bg-background">
                {hits.data.hits.map((h) => (
                  <li key={h.identifier}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted"
                      onClick={() => setSelected({ kind: h.kind, id: h.identifier })}
                    >
                      <span className="font-medium">
                        {h.kind === "mdl" ? `MDL ${h.identifier}` : h.identifier}
                        {h.date ? ` · ${h.date}` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">{h.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {selected && (
        <div className="mt-3 space-y-3 text-sm" aria-live="polite" data-testid="public-date-results">
          {dates.isPending && <p className="text-muted-foreground">Reading the record…</p>}
          {dates.isError && (
            <p role="alert">
              The record could not be read.{" "}
              <button type="button" className="text-primary underline" onClick={() => void dates.refetch()}>
                Retry
              </button>
            </p>
          )}
          {dates.data && (
            <>
              <div>
                <p className="font-semibold">
                  {KIND_LABELS[dates.data.kind]} {dates.data.identifier}
                </p>
                <p className="text-xs text-muted-foreground">
                  {dates.data.found ? (dates.data.title ?? "Title not recorded") : "Not found in the corpus."}
                </p>
              </div>
              {dates.data.notes.map((n) => (
                <p key={n} className="rounded-md bg-warning/10 p-2 text-xs leading-relaxed">
                  {n}
                </p>
              ))}
              {dates.data.found && dates.data.candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No dated public event of these kinds is recorded for this identifier.
                </p>
              )}
              {[...groups.entries()].map(([event, list]) => (
                <div key={event}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {EVENT_LABELS[event]} · {list.length}
                  </p>
                  <ul className="mt-1.5 max-h-80 space-y-2 overflow-y-auto">
                    {list.map((c) => (
                      <CandidateChip
                        key={c.key}
                        candidate={c}
                        fields={fields}
                        cutoff={cutoff}
                        values={values}
                        accepted={accepted}
                        onAccept={onAccept}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {dates.data.products.length > 0 && (
                <div className="rounded-md border border-dashed border-border p-2 text-xs">
                  <p className="font-medium">Products the JPML title names</p>
                  <p className="mt-0.5 text-muted-foreground">
                    An aid to find the application. You still choose the application number.
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {dates.data.products.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="rounded border border-border bg-background px-2 py-1 hover:bg-muted"
                        onClick={() => {
                          setTab("application");
                          setText(p.label);
                          run("drug_application", p.label);
                        }}
                      >
                        Search applications: {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CandidateChip({
  candidate: c,
  fields,
  cutoff,
  values,
  accepted,
  onAccept,
}: {
  candidate: PublicDateCandidate;
  fields: { key: SuggestibleField; label: string }[];
  cutoff: string | null;
  values: Partial<Record<SuggestibleField, string | undefined>>;
  accepted: AcceptedPublicDates;
  onAccept: (field: SuggestibleField, candidate: PublicDateCandidate) => void;
}) {
  const late = isAfterReviewCutoff(c.date, cutoff);
  return (
    <li
      className="rounded-md border border-border bg-background p-2.5"
      data-testid="public-date-chip"
      data-late={late ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium tabular-nums">{c.date}</p>
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>{c.publisher}</span>
            {c.officialUrl ? (
              <a
                href={c.officialUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary underline"
              >
                {c.urlKind === "source_file" ? "Official source file" : "Official record"}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-muted-foreground">Link: Not recorded</span>
            )}
            {c.pdfUrl && (
              <a href={c.pdfUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                PDF
              </a>
            )}
          </p>
          {c.anomaly && (
            <StatusPill tone="warning" className="mt-1">
              Shown as published: {c.anomaly}
            </StatusPill>
          )}
        </div>
        <InfoPopover label={`About ${EVENT_LABELS[c.eventType]}`}>
          <p>{c.caveat}</p>
          <p className="mt-2 text-muted-foreground">
            Field used: {c.basis}. Record {c.recordId} in {c.sourceDataset}.
          </p>
        </InfoPopover>
      </div>
      {late ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Later than this rule&apos;s review date ({cutoff}); the calculator would withhold a result.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fields.map((f) => {
            const isAccepted =
              accepted[f.key]?.recordId === c.recordId &&
              accepted[f.key]?.eventType === c.eventType &&
              values[f.key] === c.date;
            return (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant={isAccepted ? "default" : "outline"}
                className="h-auto min-h-8 whitespace-normal py-1 text-left text-xs"
                disabled={isAccepted}
                onClick={() => onAccept(f.key, c)}
              >
                {isAccepted ? `Accepted for: ${f.label}` : `Use for: ${f.label}`}
              </Button>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** The "Date sources" list for the result panel: one line per accepted field. */
export function DateSources({
  list,
  labels,
}: {
  list: readonly AcceptedPublicDate[];
  labels: Partial<Record<SuggestibleField, string>>;
}) {
  if (!list.length) return null;
  return (
    <div className="mt-3 rounded-md border border-border p-3 text-xs leading-relaxed" data-testid="date-sources">
      <p className="font-semibold">Date sources</p>
      <ul className="mt-1 space-y-1.5">
        {list.map((a) => (
          <li key={a.field}>
            <span className="font-medium">{labels[a.field] ?? a.field}</span>: {a.date} — {a.event},{" "}
            {a.identifier}, {a.publisher}.{" "}
            {a.officialUrl ? (
              <a href={a.officialUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                {a.urlKind === "source_file" ? "Source file" : "Record"}
              </a>
            ) : (
              "Link not recorded."
            )}{" "}
            Accepted by user.
          </li>
        ))}
      </ul>
    </div>
  );
}
