import { useId, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Segmented, SortHeader } from "@/components/enforcement/parts";
import type { AgencyKind, DirectoryRow } from "@/lib/external/agencyProfile.functions";
import { cn } from "@/lib/utils";
import {
  buildTree,
  filterDirectory,
  fmt,
  KIND_LABEL,
  sortDirectory,
  usd,
  type SortKey,
  type TreeNode,
} from "./agencyView";

export type DirectoryState = {
  q: string;
  kind: AgencyKind | "all";
  sort: SortKey;
  desc: boolean;
  layout: "table" | "tree";
  active: boolean;
};

const PAGE = 60;

function Columns(lastFullYear: string, latestFy: number) {
  return [
    { key: "rulesLastYear" as const, label: `Final rules ${lastFullYear}` },
    { key: "proposedLastYear" as const, label: `Proposed ${lastFullYear}` },
    { key: "significantRules" as const, label: "Significant final" },
    { key: "openComments" as const, label: "Open comments" },
    { key: "agendaActions" as const, label: "Agenda actions" },
    { key: "obligationsLatestFy" as const, label: `Obligations FY${latestFy}` },
  ];
}

function cell(row: DirectoryRow, key: SortKey) {
  if (key === "obligationsLatestFy")
    return row.obligationsLatestFy == null ? "—" : usd(row.obligationsLatestFy);
  if (key === "name") return row.name;
  return fmt(row[key]);
}

function TreeRows({
  nodes,
  depth,
  open,
  toggle,
  cols,
}: {
  nodes: TreeNode[];
  depth: number;
  open: Set<number>;
  toggle: (id: number) => void;
  cols: ReturnType<typeof Columns>;
}) {
  return (
    <>
      {nodes.map((n) => {
        const expanded = open.has(n.row.id);
        return (
          <FragmentRow
            key={n.row.id}
            node={n}
            depth={depth}
            expanded={expanded}
            toggle={toggle}
            cols={cols}
          >
            {expanded && n.children.length ? (
              <TreeRows
                nodes={n.children}
                depth={depth + 1}
                open={open}
                toggle={toggle}
                cols={cols}
              />
            ) : null}
          </FragmentRow>
        );
      })}
    </>
  );
}

function FragmentRow({
  node,
  depth,
  expanded,
  toggle,
  cols,
  children,
}: {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  toggle: (id: number) => void;
  cols: ReturnType<typeof Columns>;
  children?: React.ReactNode;
}) {
  const r = node.row;
  return (
    <>
      <tr className="border-t border-border/60 align-top hover:bg-muted/30">
        <th scope="row" className="px-2 py-1 text-left font-normal">
          <span className="flex items-start gap-1" style={{ paddingLeft: depth * 16 }}>
            {node.children.length ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${r.name} components`}
                onClick={() => toggle(r.id)}
                className="mt-0.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform motion-reduce:transition-none",
                    expanded && "rotate-90",
                  )}
                  aria-hidden
                />
              </button>
            ) : (
              <span className="inline-block w-3.5" aria-hidden />
            )}
            <span className="min-w-0">
              <Link
                to="/agencies/$id"
                params={{ id: String(r.id) }}
                className="font-medium text-primary hover:underline"
              >
                {r.name}
              </Link>
              <span className="block text-[10.5px] text-muted-foreground">
                {[
                  r.shortName,
                  node.children.length ? `${node.children.length} components` : null,
                  r.lastActiveYear
                    ? `last document ${r.lastActiveYear}`
                    : "no documents since 1994",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </span>
        </th>
        {cols.map((c) => (
          <td key={c.key} className="whitespace-nowrap px-2 py-1 text-right font-mono">
            {cell(r, c.key)}
          </td>
        ))}
      </tr>
      {children}
    </>
  );
}

/** Searchable, sortable directory of every Federal Register agency, as a table or as the parent/component tree. */
export function AgencyDirectory({
  rows,
  asOf,
  state,
  onChange,
}: {
  rows: DirectoryRow[];
  asOf: string | null;
  state: DirectoryState;
  onChange: (next: Partial<DirectoryState>) => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const tableId = useId();
  const lastFullYear = rows[0]?.lastFullYear ?? "";
  const latestFy = rows[0]?.latestFy ?? 0;
  const cols = Columns(lastFullYear, latestFy);
  const filtered = useMemo(
    () => filterDirectory(rows, state.q, state.kind, state.active),
    [rows, state.q, state.kind, state.active],
  );
  const sorted = useMemo(
    () => sortDirectory(filtered, state.sort, state.desc),
    [filtered, state.sort, state.desc],
  );
  // The tree shows the whole hierarchy; a search or kind filter switches to the flat table so matches are visible.
  const treeMode = state.layout === "tree" && !state.q.trim() && state.kind === "all";
  const tree = useMemo(
    () => (treeMode ? buildTree(filtered, state.sort, state.desc) : []),
    [treeMode, filtered, state.sort, state.desc],
  );
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sortBy = (key: SortKey) =>
    onChange(state.sort === key ? { desc: !state.desc } : { sort: key, desc: key !== "name" });
  const counts = useMemo(() => {
    const c = { department: 0, component: 0, independent: 0 };
    for (const r of rows) c[r.kind] += 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Find an agency"
            value={state.q}
            onChange={(e) => {
              onChange({ q: e.target.value });
              setLimit(PAGE);
            }}
            placeholder="Search departments and agencies"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Segmented
          label="Agency kind"
          value={state.kind}
          options={[
            { id: "all", label: `All ${fmt(rows.length)}` },
            { id: "department", label: `Departments ${fmt(counts.department)}` },
            { id: "component", label: `Components ${fmt(counts.component)}` },
            { id: "independent", label: `Independent ${fmt(counts.independent)}` },
          ]}
          onChange={(kind) => onChange({ kind })}
        />
        <Segmented
          label="Layout"
          value={state.layout}
          options={[
            { id: "table", label: "Table" },
            { id: "tree", label: "Hierarchy" },
          ]}
          onChange={(layout) => onChange({ layout })}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={state.active}
            onChange={(e) => onChange({ active: e.target.checked })}
            className="size-3.5 accent-[var(--primary)]"
          />
          Published since {Number(lastFullYear) - 1 || "last year"}
        </label>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {fmt(filtered.length)} of {fmt(rows.length)} agencies{asOf ? ` · as of ${asOf}` : ""}
        </span>
      </div>
      {state.layout === "tree" && !treeMode ? (
        <p className="text-[11px] text-muted-foreground">
          Clear the search and kind filter to see the hierarchy.
        </p>
      ) : null}
      {!filtered.length ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No agency matches this search.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full text-xs" id={tableId}>
            <caption className="sr-only">
              Federal Register agencies with rulemaking, agenda and spending figures
            </caption>
            <thead className="bg-muted/40 text-[11px] text-muted-foreground">
              <tr>
                <SortHeader
                  label="Agency"
                  active={state.sort === "name"}
                  desc={state.desc}
                  onClick={() => sortBy("name")}
                  align="left"
                />
                {cols.map((c) => (
                  <SortHeader
                    key={c.key}
                    label={c.label}
                    active={state.sort === c.key}
                    desc={state.desc}
                    onClick={() => sortBy(c.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {treeMode ? (
                <TreeRows
                  nodes={tree.slice(0, limit)}
                  depth={0}
                  open={open}
                  toggle={toggle}
                  cols={cols}
                />
              ) : (
                sorted
                  .slice(0, limit)
                  .map((r) => (
                    <FragmentRow
                      key={r.id}
                      node={{ row: r, children: [] }}
                      depth={0}
                      expanded={false}
                      toggle={toggle}
                      cols={cols}
                    />
                  ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {(treeMode ? tree.length : sorted.length) > limit ? (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {fmt(limit)} of {fmt(treeMode ? tree.length : sorted.length)}{" "}
            {treeMode ? "top-level agencies" : "agencies"} shown
          </span>
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            aria-controls={tableId}
            className="rounded border border-border px-2 py-1 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Show more agencies
          </button>
        </div>
      ) : null}
      <p className="text-[11px] leading-4 text-muted-foreground">
        Every agency the Federal Register lists, including former agencies. Structure is the Federal
        Register's parent/component record; obligations are shown where a USAspending agency carries
        the same name.
      </p>
    </div>
  );
}

export const DIRECTORY_KIND_LABEL = KIND_LABEL;
