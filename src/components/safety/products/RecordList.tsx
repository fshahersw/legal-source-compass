/**
 * Record-level reports of one MDL group: MAUDE medical device reports (with the published event text) or NHTSA vehicle
 * complaints (no VIN, city, dealer or operator details are stored). Searchable within the group, paged, each row linked
 * to the publisher's record or file.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SourceLink, StateNote } from "@/components/enforcement/parts";
import { formatCount, NOT_RECORDED, type SafetyRecord } from "./productModel";
import { recordsQuery } from "./queries";

const LIMIT = 25;
const arr = (v: unknown) =>
  Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function RecordList({
  source,
  subject,
  total,
}: {
  source: "maude" | "nhtsa";
  subject: string;
  total: number;
}) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const r = useQuery(recordsQuery(source, subject, q, page, LIMIT));
  const data = r.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const noun = source === "maude" ? "device reports" : "complaints";
  return (
    <section
      className="min-w-0 space-y-2"
      aria-label={source === "maude" ? "Device reports" : "Vehicle complaints"}
    >
      <p className="text-xs leading-5 text-muted-foreground">
        {formatCount(total)} {noun} match this group's search
        {source === "maude"
          ? " (openFDA MAUDE; event text as FDA publishes it)."
          : " (NHTSA complaints received since 2020)."}
      </p>
      <form
        role="search"
        className="flex max-w-md items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
          setPage(1);
        }}
      >
        <label htmlFor="safety-records-q" className="sr-only">
          Search the {noun}
        </label>
        <Input
          id="safety-records-q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Words in the text, brand or problem"
          className="h-8 text-sm"
          maxLength={100}
        />
        <Button type="submit" size="sm" variant="outline" className="h-8">
          <Search className="size-3.5" aria-hidden />
          Search
        </Button>
      </form>
      {r.isLoading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label={`Loading ${noun}`}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded border border-border bg-muted/50" />
          ))}
        </div>
      ) : r.error ? (
        <StateNote
          tone="error"
          action={
            <Button size="sm" variant="outline" onClick={() => void r.refetch()}>
              Retry
            </Button>
          }
        >
          The {noun} could not be loaded.
        </StateNote>
      ) : !data ? (
        <StateNote>Record-level {noun} are not loaded yet.</StateNote>
      ) : data.rows.length === 0 ? (
        <StateNote>
          {q ? `No ${noun} mention “${q}”.` : `No ${noun} are stored for this group.`}
        </StateNote>
      ) : (
        <>
          <ol className="divide-y divide-border/60 rounded-md border border-border">
            {data.rows.map((row) =>
              source === "maude" ? (
                <MaudeRow key={String(row.id)} row={row} />
              ) : (
                <NhtsaRow key={String(row.id)} row={row} />
              ),
            )}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {formatCount(data.total)}
              {data.capped ? "+" : ""} {noun}
              {q ? ` mentioning “${q}”` : ""} · page {page} of {pages}
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={page >= pages || page * LIMIT >= 5000}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">{data.caveat}</p>
        </>
      )}
    </section>
  );
}

function MaudeRow({ row }: { row: SafetyRecord }) {
  const problems = arr(row["device_problems"]);
  const patient = arr(row["patient_problems"]);
  return (
    <li className="space-y-1 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium">{str(row.date) ?? NOT_RECORDED}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
          {str(row["event_type"]) ?? "Event type not recorded"}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {arr(row["brand_names"]).join("; ") || "Brand not recorded"}
        </span>
        <span className="text-muted-foreground">
          {arr(row["manufacturers"]).map((m, i) => (
            <span key={m}>
              {i ? "; " : ""}
              {m.trim().length >= 2 && m.length <= 200 ? (
                <Link
                  to="/safety/companies"
                  search={{ name: m.trim() }}
                  className="hover:text-primary hover:underline"
                >
                  {m}
                </Link>
              ) : (
                m
              )}
            </span>
          ))}
        </span>
        <SourceLink href={row.source_url}>MDR {String(row.id)}</SourceLink>
      </div>
      {problems.length || patient.length ? (
        <p className="text-muted-foreground">
          {problems.length ? `Device: ${problems.slice(0, 4).join(", ")}` : ""}
          {problems.length && patient.length ? " · " : ""}
          {patient.length ? `Patient: ${patient.slice(0, 4).join(", ")}` : ""}
        </p>
      ) : null}
      {str(row["excerpt"]) ? <p className="line-clamp-3 leading-5">{str(row["excerpt"])}</p> : null}
    </li>
  );
}

function NhtsaRow({ row }: { row: SafetyRecord }) {
  const items = Array.isArray(row["items"]) ? (row["items"] as Record<string, unknown>[]) : [];
  const vehicles = [
    ...new Set(
      items.map((i) => [i["model_year"], i["make"], i["model"]].filter(Boolean).join(" ")),
    ),
  ];
  const components = [...new Set(items.map((i) => String(i["component"] ?? "")).filter(Boolean))];
  const flags = [
    row["crash"] === true ? "crash" : null,
    row["fire"] === true ? "fire" : null,
    typeof row["injured"] === "number" && row["injured"] > 0 ? `${row["injured"]} injured` : null,
    typeof row["deaths"] === "number" && row["deaths"] > 0 ? `${row["deaths"]} deaths` : null,
  ].filter(Boolean);
  return (
    <li className="space-y-1 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium">{str(row.date) ?? NOT_RECORDED}</span>
        <span>{vehicles.join("; ") || "Vehicle not recorded"}</span>
        {flags.length ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{flags.join(" · ")}</span>
        ) : null}
        <span className="text-muted-foreground">ODI {String(row.id)}</span>
        <SourceLink href={row.source_url}>NHTSA file</SourceLink>
      </div>
      {components.length ? (
        <p className="text-muted-foreground">{components.slice(0, 4).join("; ")}</p>
      ) : null}
      {str(row["excerpt"]) ? <p className="line-clamp-3 leading-5">{str(row["excerpt"])}</p> : null}
    </li>
  );
}
