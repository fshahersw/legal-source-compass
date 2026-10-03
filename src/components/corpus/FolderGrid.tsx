import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder } from "lucide-react";
import type { ComponentProps } from "react";

export type FolderItem = {
  key: string;
  label: string;
  count?: number | undefined;
  note?: string | undefined;
  link: { to: string; params?: Record<string, string> | undefined; search?: Record<string, string | undefined> | undefined };
};

/** Folder-style cards: click to open the next level. Empty folders are shown greyed out, not linked. */
export function FolderGrid({ title, items, hint }: { title?: string | undefined; items: FolderItem[]; hint?: string | undefined }) {
  return (
    <section className="space-y-2">
      {title ? <div className="flex items-baseline gap-2"><h2 className="eyebrow">{title}</h2>{hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}</div> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((it) => {
          const body = (
            <>
              <Folder className="mt-0.5 size-4 shrink-0 opacity-60" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{it.label}</span>
                {it.note ? <span className="block truncate text-[11px] text-muted-foreground">{it.note}</span> : null}
              </span>
              {it.count != null ? <span className="font-mono text-[12px] text-muted-foreground">{it.count.toLocaleString()}</span> : null}
              <ChevronRight className="mt-0.5 size-4 shrink-0 opacity-40" />
            </>
          );
          const cls = "flex items-start gap-2 rounded-lg border border-border bg-surface p-3 shadow-card";
          return it.count === 0 ? (
            <div key={it.key} className={`${cls} opacity-50`} aria-disabled>{body}</div>
          ) : (
            <Link key={it.key} {...(it.link as unknown as ComponentProps<typeof Link>)} className={`${cls} hover:bg-muted`}>{body}</Link>
          );
        })}
      </div>
    </section>
  );
}
