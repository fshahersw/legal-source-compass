/**
 * Expandable, keyboard-navigable tree with an inline metric bar per node (WAI-ARIA tree pattern, one tab stop).
 * Children load lazily: the tree asks for them when a node opens and shows loading, error (with retry) and empty
 * states in place. Bars compare a node with its siblings only (the longest sibling fills the bar); a node whose value
 * the source does not record shows a hatched stub and "Not recorded", never an empty bar that reads as zero.
 *
 * Keys: ↑/↓ move, → opens a node or moves to its first child, ← closes it or moves to its parent, Home/End jump, Enter
 * follows the node's link, typing a letter moves to the next node starting with it.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { chartTokens } from "./palette";

export type TreeItem = {
  id: string;
  label: string;
  /** Muted text after the label (court type, a count). */
  sublabel?: string | null | undefined;
  hasChildren: boolean;
  /** The bar: value (null = not recorded), its text, an optional note (period, staleness). */
  metric?: {
    value: number | null;
    text: string;
    note?: string | null | undefined;
    muted?: boolean | undefined;
  } | null;
  /** Extra text under the label (e.g. a judge's pending MDLs). */
  detail?: string | null | undefined;
};

export type TreeChildren =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: readonly TreeItem[] };

export type TreeExplorerProps = {
  roots: readonly TreeItem[];
  getChildren: (id: string) => TreeChildren;
  /** Called when a node opens (load its children if they are not loaded). */
  onExpand: (item: TreeItem) => void;
  onRetry?: ((item: TreeItem) => void) | undefined;
  /** The label, rendered as a link where the node has a page (tabIndex −1: the row is the tab stop). */
  renderLabel: (item: TreeItem) => ReactNode;
  /** Enter on a row. */
  onActivate?: ((item: TreeItem) => void) | undefined;
  ariaLabel: string;
  /** Header of the name column ("Court or judge") and of the bar column ("Civil cases pending"). */
  nameLabel?: string | undefined;
  metricLabel: string;
  defaultExpanded?: readonly string[] | undefined;
  className?: string | undefined;
};

type Row =
  | {
      kind: "item";
      item: TreeItem;
      level: number;
      parent: string | null;
      setSize: number;
      pos: number;
      max: number;
    }
  | { kind: "status"; parent: TreeItem; level: number; state: TreeChildren };

/** Visible rows in order, given what is expanded and loaded. Pure. */
export function flattenTree(
  roots: readonly TreeItem[],
  expanded: ReadonlySet<string>,
  getChildren: (id: string) => TreeChildren,
): Row[] {
  const out: Row[] = [];
  const walk = (items: readonly TreeItem[], level: number, parent: string | null) => {
    const max = Math.max(0, ...items.map((i) => i.metric?.value ?? 0));
    items.forEach((item, idx) => {
      out.push({ kind: "item", item, level, parent, setSize: items.length, pos: idx + 1, max });
      if (!item.hasChildren || !expanded.has(item.id)) return;
      const ch = getChildren(item.id);
      if (ch.status === "ready" && ch.items.length) walk(ch.items, level + 1, item.id);
      else out.push({ kind: "status", parent: item, level: level + 1, state: ch });
    });
  };
  walk(roots, 1, null);
  return out;
}

export function TreeExplorer({
  roots,
  getChildren,
  onExpand,
  onRetry,
  renderLabel,
  onActivate,
  ariaLabel,
  nameLabel = "Name",
  metricLabel,
  defaultExpanded = [],
  className,
}: TreeExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded));
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const typeahead = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const rows = useMemo(
    () => flattenTree(roots, expanded, getChildren),
    [roots, expanded, getChildren],
  );
  const items = rows.filter((r): r is Extract<Row, { kind: "item" }> => r.kind === "item");
  const current = items.find((r) => r.item.id === focusId) ?? items[0];

  // open the default nodes' children once
  useEffect(() => {
    for (const id of defaultExpanded) {
      const it = items.find((r) => r.item.id === id)?.item;
      if (it && getChildren(id).status === "idle") onExpand(it);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusRow = (id: string) => {
    setFocusId(id);
    refs.current.get(id)?.focus();
  };
  const toggle = (item: TreeItem, open?: boolean) => {
    const willOpen = open ?? !expanded.has(item.id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willOpen) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    if (willOpen && getChildren(item.id).status === "idle") onExpand(item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      !current ||
      !(e.target instanceof HTMLElement) ||
      e.target.getAttribute("role") !== "treeitem"
    )
      return;
    const i = items.indexOf(current);
    const it = current.item;
    const open = expanded.has(it.id);
    const go = (r: (typeof items)[number] | undefined) => {
      if (r) focusRow(r.item.id);
    };
    if (e.key === "ArrowDown") go(items[i + 1]);
    else if (e.key === "ArrowUp") go(items[i - 1]);
    else if (e.key === "Home") go(items[0]);
    else if (e.key === "End") go(items[items.length - 1]);
    else if (e.key === "ArrowRight") {
      if (!it.hasChildren) return;
      if (!open) toggle(it, true);
      else if (items[i + 1]?.parent === it.id) focusRow(items[i + 1]!.item.id);
    } else if (e.key === "ArrowLeft") {
      if (open) toggle(it, false);
      else if (current.parent) focusRow(current.parent);
    } else if (e.key === "Enter") {
      if (onActivate) onActivate(it);
      else if (it.hasChildren) toggle(it);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typeahead.current;
      t.text = now - t.at < 700 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
      t.at = now;
      const order = [...items.slice(i + (t.text.length > 1 ? 0 : 1)), ...items.slice(0, i + 1)];
      const hit = order.find((r) => r.item.label.toLowerCase().startsWith(t.text));
      if (hit) focusRow(hit.item.id);
    } else return;
    e.preventDefault();
  };

  return (
    <div className={cn("min-w-0", className)} style={chartTokens}>
      <svg width={0} height={0} aria-hidden className="absolute">
        <defs>
          <pattern
            id={hatch}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="4" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--chart-axis)" strokeOpacity={0.5} />
          </pattern>
        </defs>
      </svg>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,13rem)] gap-x-3 border-b border-border/70 px-1 pb-1 text-[11px] font-medium text-muted-foreground">
        <span>{nameLabel}</span>
        <span className="text-right">{metricLabel}</span>
      </div>
      <div role="tree" aria-label={ariaLabel} onKeyDown={onKeyDown} className="text-[12.5px]">
        {rows.map((r) => {
          if (r.kind === "status") {
            return (
              <div
                key={`status:${r.parent.id}`}
                role="none"
                className="py-1 text-[12px] text-muted-foreground"
                style={{ paddingLeft: 8 + r.level * 16 }}
              >
                {r.state.status === "loading" || r.state.status === "idle" ? (
                  <span role="status" className="inline-flex items-center gap-1.5">
                    <Loader2
                      className="size-3 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                    Loading {r.parent.label}…
                  </span>
                ) : r.state.status === "error" ? (
                  <span role="alert" className="inline-flex items-center gap-2">
                    <span className="text-destructive">{r.state.message}</span>
                    {onRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(r.parent)}
                        className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        Retry
                      </button>
                    ) : null}
                  </span>
                ) : (
                  <span>Nothing is held below this level.</span>
                )}
              </div>
            );
          }
          const { item, level, setSize, pos, max } = r;
          const open = expanded.has(item.id);
          const isCurrent = current?.item.id === item.id;
          const m = item.metric;
          const frac = m && m.value !== null && max > 0 ? Math.max(0, m.value) / max : 0;
          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              role="treeitem"
              aria-level={level}
              aria-setsize={setSize}
              aria-posinset={pos}
              aria-expanded={item.hasChildren ? open : undefined}
              aria-selected={isCurrent}
              aria-busy={open && getChildren(item.id).status === "loading" ? true : undefined}
              tabIndex={isCurrent ? 0 : -1}
              onFocus={() => setFocusId(item.id)}
              className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,13rem)] items-center gap-x-3 rounded-sm px-1 py-[3px] outline-none hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span
                className="flex min-w-0 items-start gap-1"
                style={{ paddingLeft: (level - 1) * 16 }}
              >
                {item.hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`${open ? "Close" : "Open"} ${item.label}`}
                    onClick={() => {
                      setFocusId(item.id);
                      toggle(item);
                    }}
                    className="mt-[1px] grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 transition-transform motion-reduce:transition-none",
                        open && "rotate-90",
                      )}
                      aria-hidden
                    />
                  </button>
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span className="min-w-0 truncate">{renderLabel(item)}</span>
                    {item.sublabel ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {item.sublabel}
                      </span>
                    ) : null}
                  </span>
                  {item.detail ? (
                    <span className="block text-[11px] leading-4 text-muted-foreground">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
              </span>
              <span
                className="flex min-w-0 items-center justify-end gap-2"
                title={m?.note ?? undefined}
              >
                {m ? (
                  <>
                    <svg width={64} height={8} aria-hidden className="hidden shrink-0 sm:block">
                      <rect x={0} y={0} width={64} height={8} rx={2} fill="var(--muted)" />
                      {m.value === null ? (
                        <rect x={0} y={0} width={10} height={8} rx={2} fill={`url(#${hatch})`} />
                      ) : (
                        <rect
                          x={0}
                          y={0}
                          width={Math.max(m.value > 0 ? 2 : 0, 64 * frac)}
                          height={8}
                          rx={2}
                          fill={m.muted ? "var(--chart-muted-mark)" : "var(--chart-1)"}
                        />
                      )}
                    </svg>
                    <span
                      className={cn(
                        "min-w-[4.5rem] text-right text-[12px] tabular-nums",
                        (m.value === null || m.muted) && "text-muted-foreground",
                      )}
                    >
                      {m.text}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground"> </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
