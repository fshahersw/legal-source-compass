import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/law/InForceCodeBrowser";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { stateByUsps } from "@/lib/corpus/geo";
import { showRecorded } from "@/lib/law/stateCodeContract";
import { currencyLine, shortDate, type StateLawEdition } from "@/lib/law/stateLawContract";

export type CapturedRow = {
  state: string;
  edition: string | null;
  currency: string | null;
  sections: number | null;
};

/**
 * One row per jurisdiction: the in-force edition read from the official publisher (its own currency statement,
 * verbatim) beside the previously captured edition. Nothing is inferred: absent values read "Not recorded".
 */
export function CodeCurrencyTable({
  editions,
  captured,
  installed,
}: {
  editions: StateLawEdition[];
  captured: CapturedRow[];
  installed: boolean;
}) {
  const states = [...new Set([...editions.map((e) => e.state), ...captured.map((c) => c.state)])]
    .filter((s) => stateByUsps.has(s))
    .sort((a, b) => stateByUsps.get(a)!.name.localeCompare(stateByUsps.get(b)!.name));
  if (!states.length) return null;
  return (
    <section className="mb-5" aria-labelledby="code-currency-heading">
      <h2 id="code-currency-heading" className="eyebrow">
        Currency by jurisdiction
      </h2>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        {installed
          ? `${editions.length.toLocaleString()} in-force editions from official government publishers are loaded. Currency is each publisher's own statement, quoted.`
          : "The in-force layer has not been loaded yet; the captured editions below remain browsable."}
      </p>
      <div className="mt-2 max-h-[28rem] overflow-auto rounded-xl border border-border bg-card shadow-xs shadow-card">
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Jurisdiction</TableHead>
              <TableHead>Currency (in-force edition, official publisher)</TableHead>
              <TableHead className="w-28 text-right">Sections</TableHead>
              <TableHead className="hidden w-56 md:table-cell">Captured edition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {states.map((state) => {
              const e = editions.find((x) => x.state === state) ?? null;
              const c = captured.find((x) => x.state === state) ?? null;
              const name = stateByUsps.get(state)!.name;
              return (
                <TableRow key={state}>
                  <TableCell className="align-top font-medium">
                    <Link
                      to="/law/codes/$state"
                      params={{ state }}
                      search={e ? { view: "inforce" } : { view: "captured" }}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell className="align-top">
                    {e ? (
                      <>
                        <span className="line-clamp-3 leading-relaxed" title={currencyLine(e)}>
                          {currencyLine(e)}
                        </span>
                        <span className="text-muted-foreground">
                          Read {shortDate(e.retrievedTo) ?? "date not recorded"}
                          {e.sourceMode === "retained_original"
                            ? " · from retained publisher copies"
                            : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No in-force edition loaded</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">
                    {e?.sections != null ? (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        {e.sections.toLocaleString()}
                        {e.byStatus.repealed ? (
                          <span className="inline-flex items-center gap-1">
                            <StatusBadge status="repealed" /> {e.byStatus.repealed.toLocaleString()}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not recorded</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden align-top text-muted-foreground md:table-cell">
                    {c ? `${showRecorded(c.edition)} · ${showRecorded(c.currency)}` : "None"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
