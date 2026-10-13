import type { ReactNode } from "react";
import { AlertCircle, ExternalLink, LoaderCircle } from "lucide-react";
import { publicSourceUrl } from "./monitoringView";

export const panelClass = "min-w-0 rounded-md border border-border bg-surface";
export const fieldClass =
  "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9";
export const actionClass =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-input bg-surface px-3 py-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9";

export function Pending({ children = "Loading recorded evidence…" }: { children?: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {children}
    </p>
  );
}

export function LoadError({ retry, children }: { retry: () => void; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="flex items-center gap-2">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {children ?? "This view could not be loaded. Its absence is not a zero count."}
      </p>
      <button className={`${actionClass} mt-2`} type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-5 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-2xl leading-5 text-muted-foreground">{children}</p>
    </div>
  );
}

export function SourceLink({
  url,
  children = "Open source",
}: {
  url: string | null | undefined;
  children?: ReactNode;
}) {
  const href = publicSourceUrl(url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
    >
      {children}
      <ExternalLink aria-hidden className="size-3.5 shrink-0" />
    </a>
  ) : (
    <span className="text-xs text-muted-foreground">Source link not recorded</span>
  );
}

export function Qualifications({ items }: { items: readonly string[] }) {
  return items.length ? (
    <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  ) : null;
}

export function Metadata({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(6rem,0.4fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs leading-5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
