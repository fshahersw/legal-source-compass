/**
 * "Where the sections sit": an icicle of a code title's outline. The top row is the title's top-level containers
 * (chapters, usually), each row below the next level down, every block as wide as its share of the title's sections.
 * Selecting a block opens that container in the outline beside it. Exact partitions only (see codeStructure.ts); the
 * outline tree remains the keyboard path, and "View data" lists the top row.
 */
import { useId, useMemo, useState } from "react";
import { ChartCard } from "@/components/kit/ChartCard";
import { useWidth } from "@/components/charts/d3/charts";
import { chartTokens } from "@/components/charts/palette";
import { cn } from "@/lib/utils";
import {
  icicleLayout,
  shortContainer,
  topLevelRows,
  topRowName,
  type IcicleCell,
  type OutlineInput,
} from "./codeStructure";

const ROW_H = 30;
const ROW_GAP = 2;
const SHADE = [80, 54, 32];
const fmt = (n: number) => n.toLocaleString("en-US");
/** Statuses that mean the level no longer holds law in force; "unknown" is not one of them. */
const GONE = new Set(["repealed", "omitted", "transferred", "renumbered", "reserved", "vacant"]);
const pctText = (v: number | null) =>
  v === null ? "Not recorded" : v >= 10 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;

function cellName(c: IcicleCell, label: (num: string | null, heading: string | null) => string) {
  if (c.kind === "container") return label(c.num, c.heading);
  const where = c.parent === null ? "the title" : label(c.num, c.heading);
  return c.kind === "direct"
    ? `Sections directly in ${where}, outside its sub-levels`
    : `Not broken down within ${where}`;
}

export function CodeStructureIcicle({
  headline,
  id = "title-structure",
  titleLabel,
  outline,
  release,
  sourceHref,
  statusLabels,
  containerLabel,
  selected,
  onSelect,
}: {
  id?: string;
  /** "Title 42" */
  titleLabel: string;
  outline: readonly OutlineInput[];
  release: string | null;
  sourceHref: string | null;
  statusLabels: Record<string, string>;
  containerLabel: (num: string | null, heading: string | null) => string;
  /** Re-cases an all-capitals label for the card title only (blocks and the table keep the printed text). */
  headline?: ((num: string | null, heading: string | null) => string) | undefined;
  selected: number | undefined;
  onSelect: (index: number) => void;
}) {
  const hatch = useId().replace(/:/g, "");
  const [ref, w] = useWidth<HTMLDivElement>(720);
  const [hover, setHover] = useState<IcicleCell | null>(null);
  const layout = useMemo(() => icicleLayout(outline, 3), [outline]);
  const byIndex = useMemo(() => new Map(outline.map((n) => [n.index, n])), [outline]);
  const path = useMemo(() => {
    const s = new Set<number>();
    for (let n = selected !== undefined ? byIndex.get(selected) : undefined; n; ) {
      s.add(n.index);
      n = n.parent !== null ? byIndex.get(n.parent) : undefined;
    }
    return s;
  }, [selected, byIndex]);
  const top = topLevelRows(layout);
  const biggest = top
    .filter((r) => r.kind === "container")
    .sort((a, b) => b.total - a.total)[0];
  const rowName = topRowName(outline, layout);
  const anyGone = layout.cells.some((c) => c.status !== null && GONE.has(c.status));
  const height = Math.max(1, layout.rows) * (ROW_H + ROW_GAP);
  const source = {
    source: {
      label: "Office of the Law Revision Counsel, United States Code",
      ...(sourceHref ? { href: sourceHref } : {}),
    },
    period: release ? `Release point ${release}` : undefined,
    about: (
      <p>
        Each block is one level of the title's outline, as wide as the number of sections the
        official outline counts inside it, repealed and transferred sections included. Up to three
        levels are drawn. Sections printed directly in a level, outside its sub-levels, get their
        own light block; a level whose parts do not add up to its count shows the gap as "Not
        broken down"{layout.excess.length ? ", and a level whose parts add up to more than its count is drawn without them" : ""}.
      </p>
    ),
  };
  const shown = hover;
  const readout = (c: IcicleCell) => {
    const share = layout.total ? (c.total / layout.total) * 100 : null;
    const status = c.status ? ` · ${statusLabels[c.status] ?? c.status}` : "";
    return `${cellName(c, containerLabel)} · ${fmt(c.total)} sections · ${pctText(share)} of ${titleLabel}${status}`;
  };

  return (
    <ChartCard
      id={id}
      title={
        biggest && biggest.share !== null
          ? `${(headline ?? containerLabel)(biggest.num, biggest.heading)} holds ${pctText(biggest.share)} of ${titleLabel}'s ${fmt(layout.total)} sections`
          : `${titleLabel}: where the sections sit`
      }
      subtitle={`${rowName} · each block as wide as its share of the sections · select one to open it`}
      source={source}
      state={layout.cells.length ? "ready" : "empty"}
      emptyText="This title's outline has no levels to draw."
      height={height + 40}
      data={{
        title: `${titleLabel}: top-level containers by sections`,
        rows: top,
        rowKey: (r) => r.key,
        columns: [
          {
            key: "name",
            label: "Level",
            value: (r) =>
              r.kind === "container"
                ? containerLabel(r.num, r.heading)
                : r.kind === "direct"
                  ? "Sections outside any top-level container"
                  : "Not broken down",
          },
          { key: "total", label: "Sections", value: (r) => r.total },
          {
            key: "share",
            label: "Share of title (%)",
            value: (r) => (r.share === null ? null : Math.round(r.share * 10) / 10),
          },
          {
            key: "status",
            label: "Status",
            value: (r) => (r.status ? (statusLabels[r.status] ?? r.status) : ""),
          },
        ],
        source,
      }}
    >
      <div ref={ref} className="w-full">
        <svg
          width={w}
          height={height}
          style={chartTokens}
          role="img"
          aria-label={`Outline of ${titleLabel} by number of sections`}
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <pattern
              id={hatch}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--muted)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--muted-foreground)"
                strokeOpacity="0.4"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          {layout.cells.map((c) => {
            const x = c.x0 * w;
            const cw = (c.x1 - c.x0) * w - 1;
            if (cw < 0.5) return null;
            const y = c.row * (ROW_H + ROW_GAP);
            // a leaf runs to the bottom row, so a level with nothing below it reads as one block, not a gap
            const ch = c.leaf
              ? (Math.max(1, layout.rows) - c.row) * (ROW_H + ROW_GAP) - ROW_GAP
              : ROW_H;
            const shade = SHADE[c.row] ?? 24;
            const gone = c.kind === "container" && c.status !== null && GONE.has(c.status);
            const fill =
              c.kind === "unbroken"
                ? `url(#${hatch})`
                : c.kind === "direct"
                  ? "color-mix(in srgb, var(--map-high) 10%, var(--map-low))"
                  : gone
                    ? "var(--muted)"
                    : `color-mix(in srgb, var(--map-high) ${shade}%, var(--map-low))`;
            const onPath = c.index !== null && path.has(c.index);
            const isHover = hover?.key === c.key;
            const label =
              c.kind === "container" ? shortContainer(c.num) || (c.heading ?? "") : "";
            const maxChars = Math.floor((cw - 8) / 6.4);
            const ink =
              c.kind === "container" && !gone && shade >= 50
                ? "var(--map-ink-high)"
                : gone
                  ? "var(--muted-foreground)"
                  : "var(--map-ink-low)";
            return (
              <g
                key={c.key}
                className={cn(c.index !== null && "cursor-pointer")}
                onMouseEnter={() => setHover(c)}
                onClick={() => (c.index !== null ? onSelect(c.index) : undefined)}
              >
                <rect
                  x={x}
                  y={y}
                  width={cw}
                  height={ch}
                  rx={cw > 6 ? 3 : 0}
                  style={{ fill }}
                  stroke={
                    onPath || isHover
                      ? "var(--map-active)"
                      : gone
                        ? "var(--border)"
                        : "none"
                  }
                  strokeWidth={onPath ? 2 : isHover ? 1.5 : 1}
                  strokeDasharray={gone && !onPath && !isHover ? "3 2" : undefined}
                />
                {label && maxChars >= 3 ? (
                  <text
                    x={x + 6}
                    y={y + Math.min(ch, ROW_H) / 2 + 4}
                    fontSize={11.5}
                    fontWeight={c.row === 0 ? 600 : 500}
                    fill={ink}
                    className="pointer-events-none select-none"
                  >
                    {label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label}
                  </text>
                ) : null}
                <title>{readout(c)}</title>
              </g>
            );
          })}
        </svg>
        <p
          aria-live="polite"
          className="m-0 mt-2 min-h-4 truncate text-meta text-muted-foreground"
        >
          {shown ? (
            readout(shown)
          ) : (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-4 rounded-sm"
                  style={{ background: "color-mix(in srgb, var(--map-high) 80%, var(--map-low))" }}
                />
                Top level
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-4 rounded-sm"
                  style={{ background: "color-mix(in srgb, var(--map-high) 32%, var(--map-low))" }}
                />
                Levels below
              </span>
              {anyGone ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-border bg-muted"
                  />
                  Repealed, omitted or moved
                </span>
              ) : null}
              {layout.unbroken ? (
                <span className="inline-flex items-center gap-1.5">
                  <svg width="16" height="10" aria-hidden>
                    <rect width="16" height="10" fill={`url(#${hatch})`} />
                  </svg>
                  Not broken down
                </span>
              ) : null}
            </span>
          )}
        </p>
      </div>
    </ChartCard>
  );
}
