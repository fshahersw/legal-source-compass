/**
 * Review notes beside the incapacity, concealment and class-action screening questions. Notes only: nothing here is
 * computed, applied or written to a rule. Minority stays the only executed tolling policy (tollingPolicy.ts).
 */
import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { LimitationRule, LimitationsSnapshot } from "@/lib/limitations/types";
import { searchDocuments } from "@/lib/documents/documents.functions";
import { CrossReferenceNote } from "./CrossReferenceNote";
import {
  CLASS_TOLLING_CASES,
  CLASS_TOLLING_SENTENCE,
  tollingNotesFor,
  type TollingNoteCategory,
} from "./tollingNotes";

export function TollingReviewNotes({
  snapshot,
  rule,
  category,
}: {
  snapshot: LimitationsSnapshot;
  rule: LimitationRule;
  category: TollingNoteCategory;
}) {
  const notes = tollingNotesFor(snapshot, rule, category);
  return (
    <div
      className="mt-2 rounded-md border border-dashed border-border bg-background p-3 text-xs leading-relaxed"
      data-testid={`tolling-review-notes-${category}`}
    >
      <p className="font-semibold">
        {category === "incapacity"
          ? "Recorded incapacity notes"
          : category === "concealment"
            ? "Recorded concealment notes"
            : "Class actions and MDL orders"}{" "}
        <span className="font-normal text-muted-foreground">· not applied by the calculator</span>
      </p>
      {notes.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-1 pl-4">
          {notes.map(({ note, link }) => (
            <li key={note.id}>
              {note.text}
              {note.citation ? ` (${note.citation})` : ""}
              <CrossReferenceNote link={link} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-muted-foreground">
          This rule records no tolling note on this topic. That is not evidence that none exists.
        </p>
      )}
      {category === "class_action" && <ClassActionMaterial />}
      <p className="mt-2 text-muted-foreground">
        Any arithmetic is your own reviewed instruction where the rule allows one; amounts and dates
        are typed by you.
      </p>
    </div>
  );
}

function ClassActionMaterial() {
  const [text, setText] = useState("");
  const [mdl, setMdl] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = text.trim().replace(/^mdl\s*/i, "");
    setMdl(/^[1-9]\d{0,5}$/.test(n) ? n : null);
  };
  return (
    <div className="mt-2 space-y-2">
      <p>{CLASS_TOLLING_SENTENCE}</p>
      <ul className="space-y-0.5">
        {CLASS_TOLLING_CASES.map((c) => (
          <li key={c.cluster}>
            <Link to="/cases/$id" params={{ id: c.cluster }} className="text-primary underline">
              {c.name}
            </Link>
            , {c.cite}
          </li>
        ))}
      </ul>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <label className="text-xs font-medium">
          MDL orders to review, by MDL number
          <input
            className="ml-2 inline-block min-h-8 w-28 rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={text}
            inputMode="numeric"
            maxLength={10}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 3014"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" className="min-h-8">
          Find orders
        </Button>
      </form>
      {mdl && <MdlOrders mdl={mdl} />}
    </div>
  );
}

/** Filings of one MDL (exact MDL number) that match "tolling" or "direct filing". Mounted only once asked. */
function MdlOrders({ mdl }: { mdl: string }) {
  const orders = useQuery({
    queryKey: ["limitations-mdl-tolling-orders", mdl],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const [tolling, direct] = await Promise.all(
        ["tolling", "direct filing"].map((q) =>
          searchDocuments({ data: { q, mdl, sort: "relevance", limit: 10 } }),
        ),
      );
      if (!tolling?.available || !direct?.available) return { available: false as const, rows: [] };
      const seen = new Set<string>();
      const rows = [...tolling.rows, ...direct.rows].filter((r) =>
        seen.has(r.id) ? false : (seen.add(r.id), true),
      );
      return { available: true as const, rows };
    },
  });
  return (
    <div>
      {orders.isPending && <p className="text-muted-foreground">Searching MDL {mdl} filings…</p>}
      {orders.isError && <p role="alert">The filings could not be searched just now.</p>}
      {orders.data && !orders.data.available && (
        <p className="text-muted-foreground">The filings layer is not available.</p>
      )}
      {orders.data?.available && (
        <div>
          <p className="text-muted-foreground">
            MDL {mdl}: top {orders.data.rows.length} filing
            {orders.data.rows.length === 1 ? "" : "s"} matching “tolling” or “direct filing” (up to
            10 per term). Documents to review, not findings.
          </p>
          {orders.data.rows.length > 0 && (
            <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
              {orders.data.rows.map((r) => (
                <li key={r.id}>
                  {r.filedDate ?? "Date not recorded"} · {r.title ?? "Title not recorded"}
                  {r.sourceUrl && (
                    <>
                      {" "}
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        source
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/litigation/documents"
            search={{ mdl, q: "tolling" }}
            className="mt-1 inline-block text-primary underline"
          >
            Search all MDL {mdl} filings
          </Link>
        </div>
      )}
    </div>
  );
}
