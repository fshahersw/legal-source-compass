import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type {
  CompanyLink,
  CourtRef,
  StatedAmount,
} from "@/lib/external/enforcementActions.functions";
import { cn } from "@/lib/utils";
import { fmtInt, keywordLabel } from "./format";

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
  /** Label of the empty ("no filter") option; null leaves it out. */
  allLabel?: string | null;
  className?: string;
}) {
  return (
    <label
      className={cn("flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground", className)}
    >
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 w-full min-w-0 max-w-[16rem] truncate rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {allLabel != null ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-muted-foreground">
      {label}
      <span className="relative block w-full max-w-xs">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
      </span>
    </label>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  shown,
  onPage,
  noun,
}: {
  page: number;
  pageSize: number;
  total: number | null;
  shown: number;
  onPage: (p: number) => void;
  noun: string;
}) {
  const first = page * pageSize + 1;
  const last = page * pageSize + shown;
  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
      <span>
        {shown
          ? `${fmtInt(first)}–${fmtInt(last)} of ${total != null ? fmtInt(total) : "too many to count"} ${noun}`
          : `No ${noun}`}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronLeft className="size-3" aria-hidden />
          Previous
        </button>
        <span className="tabular-nums">
          Page {fmtInt(page + 1)}
          {pages != null ? ` of ${fmtInt(pages)}` : ""}
        </span>
        <button
          type="button"
          disabled={pages != null ? page + 1 >= pages : shown < pageSize}
          onClick={() => onPage(page + 1)}
          className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Next
          <ChevronRight className="size-3" aria-hidden />
        </button>
      </span>
    </div>
  );
}

export function Chip({
  children,
  title,
  tone,
}: {
  children: ReactNode;
  title?: string;
  tone?: "muted";
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center truncate rounded border px-1.5 py-px text-[10px] leading-4",
        tone === "muted" ? "border-border/60 text-muted-foreground" : "border-border bg-muted",
      )}
    >
      {children}
    </span>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-xs">{children}</dd>
    </div>
  );
}

export function CourtList({ courts }: { courts: CourtRef[] }) {
  if (!courts.length) return <span className="text-muted-foreground">Not stated</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {courts.map((c) =>
        c.courtId ? (
          <Link
            key={`${c.asWritten}-${c.courtId}`}
            to="/courts/$id"
            params={{ id: c.courtId }}
            className="text-primary hover:underline"
          >
            {c.asWritten}
          </Link>
        ) : (
          <span key={c.asWritten}>{c.asWritten}</span>
        ),
      )}
    </span>
  );
}

export function CompanyList({ companies }: { companies: CompanyLink[] }) {
  if (!companies.length) return null;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {companies.map((c) => (
        <Link
          key={c.cik}
          to="/companies/$cik"
          params={{ cik: c.cik }}
          className="text-primary hover:underline"
          title={`"${c.asWritten}" equals the SEC registrant name ${c.registrant} after exact normalisation`}
        >
          {c.registrant}
        </Link>
      ))}
    </span>
  );
}

export function AmountList({ amounts }: { amounts: StatedAmount[] }) {
  if (!amounts.length) return <span className="text-muted-foreground">None stated</span>;
  return (
    <ul className="space-y-1">
      {amounts.map((a, i) => (
        <li key={`${a.asWritten}-${i}`} className="min-w-0">
          <span className="font-mono font-medium">{a.asWritten}</span>{" "}
          <span className="text-[11px] text-muted-foreground">
            ({keywordLabel(a.keyword)}
            {a.boilerplate ? "; stock paragraph repeated across releases, not counted" : ""}
            {a.ambiguous ? "; ambiguous as written, no value computed" : ""})
          </span>
          {a.sentence ? (
            <span className="block break-words text-[11px] text-muted-foreground">
              “{a.sentence}”
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
