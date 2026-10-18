import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export type FolderItem = {
  key: string;
  label: string;
  /** Full name shown on hover over a short label (e.g. an agency's name); defaults to the label. */
  title?: string | undefined;
  count?: number | undefined;
  note?: string | undefined;
  /** Optional visual (seal, flag, mark) shown in place of the folder glyph. */
  icon?: ReactNode | undefined;
  link: {
    to: string;
    params?: Record<string, string> | undefined;
    search?: Record<string, string | undefined> | undefined;
  };
};

/**
 * Folder-style cards: click to open the next level. Empty folders are shown greyed out, not linked.
 * Labels and notes carry their full text on hover; `wrapNotes` lets notes run to two lines instead of one.
 */
export function FolderGrid({
  title,
  items,
  hint,
  wrapNotes = false,
}: {
  title?: string | undefined;
  items: FolderItem[];
  hint?: string | undefined;
  /** Notes wrap to two lines (for descriptions and caveats that should not be cut mid-word at 1024–1280 px). */
  wrapNotes?: boolean | undefined;
}) {
  return (
    <section className="space-y-2">
      {title ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="eyebrow">{title}</h2>
          {hint ? (
            <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span>
          ) : null}
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((it) => {
          const body = (
            <>
              {it.icon ?? (
                <Folder className="mt-0.5 size-4 shrink-0 opacity-60" strokeWidth={1.75} />
              )}
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[13px] font-medium"
                  title={it.title ?? it.label}
                >
                  {it.label}
                </span>
                {it.note ? (
                  <span
                    className={
                      wrapNotes
                        ? "line-clamp-2 break-words text-[11px] leading-4 text-muted-foreground"
                        : "block truncate text-[11px] text-muted-foreground"
                    }
                    title={it.note}
                  >
                    {it.note}
                  </span>
                ) : null}
              </span>
              {it.count != null ? (
                <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                  {it.count.toLocaleString("en-US")}
                </span>
              ) : null}
              <ChevronRight className="mt-0.5 size-4 shrink-0 opacity-40" aria-hidden />
            </>
          );
          const cls = `flex ${it.icon ? "items-center gap-3" : "items-start gap-2"} rounded-lg border border-border bg-surface p-3 shadow-card`;
          return it.count === 0 ? (
            <div key={it.key} className={`${cls} opacity-50`} aria-disabled>
              {body}
            </div>
          ) : (
            <Link
              key={it.key}
              {...(it.link as unknown as ComponentProps<typeof Link>)}
              className={`${cls} hover:bg-muted`}
            >
              {body}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
