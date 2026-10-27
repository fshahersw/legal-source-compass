/** Small shared pieces of the MDL command page: number and date text, the page's sources, entry links. */
import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { ChartSource } from "@/components/charts/ChartCard";
import type { MdlCommandPayload } from "@/lib/matters/types";

export const NOT_RECORDED = "Not recorded";

export const fmt = (v: number) => v.toLocaleString("en-US");
export const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v))}`;

/** "Oct 1, 2026" from yyyy-mm-dd; the input itself when it is not a full date. */
export function day(iso: string | null | undefined): string {
  if (!iso) return NOT_RECORDED;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const JPML_ARCHIVE = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive";

export function jpmlSource(cmd: MdlCommandPayload): ChartSource {
  return { label: "JPML pending MDL reports", url: cmd.jpmlSourceUrl ?? JPML_ARCHIVE };
}

/** The master docket on CourtListener when the record gives its id, else CourtListener's RECAP archive. */
export function docketSource(cmd: MdlCommandPayload): ChartSource {
  const cl = cmd.overview?.overview.masterDocket.clDocketId;
  return {
    label: "Master-docket entries (CourtListener RECAP)",
    url: cl ? `https://www.courtlistener.com/docket/${cl}/` : "https://www.courtlistener.com/recap/",
  };
}

/** "collected through Oct 3, 2026" note for anything read from the docket text. */
export const collectedNote = (through: string | null) =>
  through
    ? `Docket text collected through ${day(through)}; later entries are not collected.`
    : "The date of the last collected docket entry is not recorded.";

/** An https link that opens in a new tab; plain text when there is no link. */
export function Out({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href || !/^https:\/\//i.test(href)) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />
    </a>
  );
}

/** "Entry 2750" linked to the entry's page, or "Entry not numbered". */
export function EntryLink({
  n,
  href,
}: {
  n: number | null;
  href: string | null;
}) {
  return <Out href={href}>{n !== null ? `Entry ${n}` : "Entry not numbered"}</Out>;
}

/** A one-line note under a block (scope, cap, coverage); short and plain. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-meta text-muted-foreground">{children}</p>;
}

/**
 * A closed-by-default block for long lists; its content mounts only once opened, so the lists' reads run only on
 * demand. `defaultOpen` opens it for a former tab address that named these lists.
 */
export function Disclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs"
    >
      <summary className="cursor-pointer text-label text-foreground">{title}</summary>
      {open ? <div className="mt-4 space-y-8">{children}</div> : null}
    </details>
  );
}

/** Shown in place of a section part whose server read failed. */
export function Unavailable({ what }: { what: string }) {
  return (
    <p role="alert" className="rounded-lg border border-border px-4 py-3 text-meta text-muted-foreground">
      {what} could not be read just now.
    </p>
  );
}
