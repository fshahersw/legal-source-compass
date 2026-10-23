/** Building blocks shared by the calculators: fields, status notes, the source-observation table and the method list. */
import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MethodStep, SourceObservation } from "@/lib/calculators/types";
import { FRED_NOTICE, FRED_TERMS } from "./format";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Note({
  kind,
  children,
}: {
  kind: "info" | "warn" | "error" | "loading";
  children: ReactNode;
}) {
  const Icon = kind === "loading" ? Loader2 : kind === "info" ? Info : AlertTriangle;
  return (
    <p
      role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] leading-snug",
        kind === "error"
          ? "border-destructive/40 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", kind === "loading" && "animate-spin")}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-md border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {actions}
      </header>
      <div className="flex min-w-0 flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

export function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function SourceObservations({ rows }: { rows: SourceObservation[] }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-[12px]">
        <caption className="sr-only">Published values used</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1 pr-3 font-medium">Series</th>
            <th className="py-1 pr-3 font-medium">Date</th>
            <th className="py-1 pr-3 text-right font-medium">Value</th>
            <th className="py-1 pr-3 font-medium">Current value since</th>
            <th className="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={`${o.seriesId}:${o.date}`} className="border-b border-border/60 align-top">
              <td className="py-1 pr-3">
                {o.label} <span className="text-muted-foreground">({o.seriesId})</span>
              </td>
              <td className="py-1 pr-3 tabular-nums">{o.date}</td>
              <td className="py-1 pr-3 text-right tabular-nums">
                {o.value} {o.units === "%" ? "%" : ""}
                {o.firstVintage !== undefined ? (
                  <span className="block text-[11px] text-muted-foreground">
                    first published {o.firstValue ?? "no value"} ({o.firstVintage})
                  </span>
                ) : null}
              </td>
              <td className="py-1 pr-3 tabular-nums">{o.vintage}</td>
              <td className="py-1">
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  FRED <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Method({ steps, notes }: { steps: MethodStep[]; notes?: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[9rem_1fr]">
        {steps.map((s) => (
          <div key={s.label} className="contents">
            <dt className="font-medium text-foreground">{s.label}</dt>
            <dd className="text-muted-foreground">{s.detail}</dd>
          </div>
        ))}
      </dl>
      {notes?.map((n) => (
        <Note key={n} kind="warn">
          {n}
        </Note>
      ))}
    </div>
  );
}

export function Inputs({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-[9rem_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="tabular-nums text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FredNotice() {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">
      {FRED_NOTICE}{" "}
      <a
        href={FRED_TERMS}
        target="_blank"
        rel="noreferrer"
        className="text-primary hover:underline"
      >
        FRED API Terms of Use
      </a>
      . Using these calculators means agreeing to those terms for the FRED data they show.
    </p>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}
