/**
 * Icicle (partition) chart, left to right: the focused node is the first column, its children the second and, when
 * loaded, their children the third. Height is proportional to value. Focus + context: clicking a cell (or Enter) asks the
 * caller to zoom into it, clicking the focus column (or Escape) to zoom out; the caller supplies the breadcrumb and the
 * data table. Cells the caller has not loaded yet show a quiet "open to see" placeholder; a cell whose colour value is
 * not recorded is hatched, never given the lightest shade.
 *
 * Every cell is a hover and keyboard target: ArrowUp/ArrowDown move within a column, ArrowRight to the first child,
 * ArrowLeft to the parent, Home/End to the ends of a column, Enter opens, Escape goes up. The pointer snaps to the cell
 * under it in its column, so a sliver thinner than a pixel can still be read.
 */
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { ChartTooltip, textWidth, useMeasuredWidth, type TooltipContent } from "./canvas";
import { chartTokens } from "./palette";

export type IcicleDatum = {
  id: string;
  /** Short text drawn inside the cell when it fits. */
  label: string;
  value: number;
  /** A colour expression built from chart tokens; null = not recorded (hatched). */
  fill: string | null;
  /** Draw the label in the light ink (dark fills). */
  lightInk?: boolean | undefined;
  /** Loaded children; undefined = not loaded. */
  children?: readonly IcicleDatum[] | undefined;
  /** Text of the placeholder drawn where unloaded children would go. */
  placeholder?: string | undefined;
};

export type IcicleCell = {
  d: IcicleDatum;
  depth: 0 | 1 | 2;
  /** Index of the parent cell in `cells` (-1 for the focus). */
  parent: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
};
export type IciclePlaceholder = {
  parent: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  text: string;
};

const GAP_X = 3;

/** Pure layout (tested): cells in column order, top to bottom, plus placeholders for unloaded third-column cells. */
export function icicleLayout(
  root: IcicleDatum,
  width: number,
  height: number,
): { cells: IcicleCell[]; placeholders: IciclePlaceholder[]; columns: number } {
  const kids = (root.children ?? []).filter((c) => c.value > 0);
  const third = kids.some((k) => (k.children?.length ?? 0) > 0 || k.placeholder);
  const fr = third ? [0.15, 0.37, 0.48] : [0.18, 0.82, 0];
  const w = Math.max(0, width - GAP_X * (third ? 2 : 1));
  const xs = [0, w * fr[0]! + GAP_X, w * (fr[0]! + fr[1]!) + 2 * GAP_X];
  const ws = fr.map((f) => w * f);
  const cells: IcicleCell[] = [
    { d: root, depth: 0, parent: -1, x0: 0, x1: ws[0]!, y0: 0, y1: height },
  ];
  const placeholders: IciclePlaceholder[] = [];
  const total = kids.reduce((a, k) => a + k.value, 0);
  let y = 0;
  const level1: number[] = [];
  for (const k of kids) {
    const h = total > 0 ? (k.value / total) * height : 0;
    cells.push({ d: k, depth: 1, parent: 0, x0: xs[1]!, x1: xs[1]! + ws[1]!, y0: y, y1: y + h });
    level1.push(cells.length - 1);
    y += h;
  }
  if (third)
    for (const pi of level1) {
      const p = cells[pi]!;
      const gk = (p.d.children ?? []).filter((c) => c.value > 0);
      const gt = gk.reduce((a, k) => a + k.value, 0);
      if (!gk.length) {
        if (p.d.placeholder)
          placeholders.push({
            parent: pi,
            x0: xs[2]!,
            x1: xs[2]! + ws[2]!,
            y0: p.y0,
            y1: p.y1,
            text: p.d.placeholder,
          });
        continue;
      }
      let gy = p.y0;
      for (const g of gk) {
        const h = gt > 0 ? (g.value / gt) * (p.y1 - p.y0) : 0;
        cells.push({
          d: g,
          depth: 2,
          parent: pi,
          x0: xs[2]!,
          x1: xs[2]! + ws[2]!,
          y0: gy,
          y1: gy + h,
        });
        gy += h;
      }
    }
  return { cells, placeholders, columns: third ? 3 : 2 };
}

/** Truncate a label to the width available (Public Sans estimate), with an ellipsis. */
export function fitLabel(text: string, width: number, fontSize: number): string | null {
  if (width < fontSize * 1.6) return null;
  if (textWidth(text, fontSize) <= width) return text;
  const n = Math.floor(width / (fontSize * 0.56)) - 1;
  return n >= 2 ? `${text.slice(0, n)}…` : null;
}

export type IcicleProps = {
  root: IcicleDatum;
  height?: number;
  width?: number | undefined;
  ariaLabel: string;
  /** Sentence read when a cell gets keyboard focus. */
  describe: (d: IcicleDatum, depth: number) => string;
  tooltip: (d: IcicleDatum, depth: number) => TooltipContent;
  /** Click / Enter on a child or grandchild cell. */
  onSelect: (d: IcicleDatum, depth: number) => void;
  /** Click / Enter on the focus column, Escape: zoom out. Omit at the top level. */
  onUp?: (() => void) | undefined;
  /** Dim the whole chart (previous render held while the next level loads). */
  busy?: boolean | undefined;
  className?: string | undefined;
};

export function Icicle({
  root,
  height = 460,
  width: fixedWidth,
  ariaLabel,
  describe,
  tooltip,
  onSelect,
  onUp,
  busy,
  className,
}: IcicleProps) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const width = fixedWidth ?? measured;
  const hatch = useId().replace(/[^a-zA-Z0-9]/g, "");
  const liveId = useId();
  const [active, setActive] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const layout = useMemo(
    () => (width ? icicleLayout(root, width, height) : null),
    [root, width, height],
  );
  const byDepth = useMemo(() => {
    const out: number[][] = [[], [], []];
    layout?.cells.forEach((c, i) => out[c.depth]!.push(i));
    return out;
  }, [layout]);
  const cells = layout?.cells ?? [];
  const go = (i: number | null) => {
    setActive(i);
    if (i !== null && cells[i]) setAnnounce(describe(cells[i]!.d, cells[i]!.depth));
  };
  const select = (i: number) => {
    const c = cells[i];
    if (!c) return;
    if (c.depth === 0) onUp?.();
    else onSelect(c.d, c.depth);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!cells.length) return;
    const cur = active ?? null;
    const col = cur === null ? null : byDepth[cells[cur]!.depth]!;
    const pos = cur === null || !col ? -1 : col.indexOf(cur);
    let to: number | null = null;
    switch (e.key) {
      case "ArrowDown":
        to = cur === null ? (byDepth[1]![0] ?? 0) : col![Math.min(col!.length - 1, pos + 1)]!;
        break;
      case "ArrowUp":
        to = cur === null ? (byDepth[1]![0] ?? 0) : col![Math.max(0, pos - 1)]!;
        break;
      case "Home":
        to = col ? col[0]! : (byDepth[1]![0] ?? 0);
        break;
      case "End":
        to = col ? col[col.length - 1]! : (byDepth[1]!.at(-1) ?? 0);
        break;
      case "ArrowRight": {
        const from = cur ?? 0;
        const child = cells.findIndex((c) => c.parent === from);
        to = child >= 0 ? child : from;
        break;
      }
      case "ArrowLeft":
        to = cur === null ? 0 : cells[cur]!.parent >= 0 ? cells[cur]!.parent : cur;
        break;
      case "Enter":
      case " ":
        if (cur !== null) {
          e.preventDefault();
          select(cur);
        }
        return;
      case "Escape":
      case "Backspace":
        if (onUp) {
          e.preventDefault();
          setActive(null);
          onUp();
        } else setActive(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    go(to);
  };
  const pick = (depth: number, y: number) => {
    const col = byDepth[depth]!;
    for (const i of col) if (y >= cells[i]!.y0 && y < cells[i]!.y1) return i;
    return col.length ? col[col.length - 1]! : null;
  };
  const activeCell = active !== null ? cells[active] : undefined;
  return (
    <div
      ref={ref}
      className={cn("relative w-full min-w-0", className)}
      style={{ ...chartTokens, height }}
    >
      <div
        role="group"
        aria-roledescription="partition chart"
        aria-label={`${ariaLabel} Use the arrow keys to move between cells, Enter to open, Escape to go up.`}
        aria-describedby={liveId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className={cn(
          "h-full w-full rounded-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
          busy && "opacity-60",
        )}
      >
        {width && layout ? (
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
            className="block font-sans"
            onPointerLeave={() => setActive(null)}
          >
            <defs>
              <pattern
                id={hatch}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="5" height="5" fill="var(--muted)" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--chart-axis)" strokeOpacity={0.45} />
              </pattern>
            </defs>
            {[0, 1, 2].map((depth) => {
              const col = byDepth[depth]!;
              if (!col.length) return null;
              const c0 = cells[col[0]!]!;
              return (
                <rect
                  key={`hit-${depth}`}
                  x={c0.x0}
                  y={0}
                  width={c0.x1 - c0.x0}
                  height={height}
                  fill="transparent"
                  onPointerMove={(e) => {
                    const rect = (
                      e.currentTarget.ownerSVGElement ?? e.currentTarget
                    ).getBoundingClientRect();
                    const i = pick(depth, e.clientY - rect.top);
                    if (i !== active) go(i);
                  }}
                  onClick={(e) => {
                    const rect = (
                      e.currentTarget.ownerSVGElement ?? e.currentTarget
                    ).getBoundingClientRect();
                    const i = pick(depth, e.clientY - rect.top);
                    if (i !== null) select(i);
                  }}
                  style={{ cursor: depth === 0 && !onUp ? "default" : "pointer" }}
                />
              );
            })}
            {layout.placeholders.map((p) => {
              const h = p.y1 - p.y0;
              const text = h >= 13 ? fitLabel(p.text, p.x1 - p.x0 - 10, 10) : null;
              return (
                <g key={`ph-${p.parent}`} pointerEvents="none">
                  {h >= 3 ? (
                    <rect
                      x={p.x0 + 0.5}
                      y={p.y0 + 0.5}
                      width={Math.max(0, p.x1 - p.x0 - 1)}
                      height={Math.max(0, h - 1.5)}
                      rx={2}
                      fill="none"
                      stroke="var(--chart-grid)"
                    />
                  ) : null}
                  {text ? (
                    <text
                      x={p.x0 + 6}
                      y={p.y0 + Math.min(h / 2, 12)}
                      dy="0.32em"
                      fontSize={10}
                      fill="var(--chart-axis)"
                    >
                      {text}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {cells.map((c, i) => {
              const h = c.y1 - c.y0;
              const gap = h >= 6 ? 2 : h >= 3 ? 1 : 0;
              const w = c.x1 - c.x0;
              const fs = c.depth === 0 ? 11 : 10.5;
              const text = h >= 14 ? fitLabel(c.d.label, w - 10, fs) : null;
              return (
                <g key={`${c.depth}-${c.d.id}`} pointerEvents="none">
                  <rect
                    x={c.x0}
                    y={c.y0}
                    width={Math.max(0, w)}
                    height={Math.max(0.5, h - gap)}
                    rx={h >= 8 ? 2 : 0}
                    fill={c.d.fill ?? `url(#${hatch})`}
                    stroke={active === i ? "var(--chart-ink)" : "none"}
                    strokeWidth={1.5}
                  />
                  {text ? (
                    <text
                      x={c.x0 + 6}
                      y={c.depth === 0 ? Math.min(c.y0 + 14, c.y0 + h / 2) : c.y0 + (h - gap) / 2}
                      dy="0.32em"
                      fontSize={fs}
                      fontWeight={c.depth === 0 ? 600 : 400}
                      fill={
                        c.d.fill && c.d.lightInk ? "var(--primary-foreground)" : "var(--chart-ink)"
                      }
                    >
                      {text}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
      <p id={liveId} aria-live="polite" className="sr-only">
        {announce}
      </p>
      {activeCell && width ? (
        <ChartTooltip
          content={tooltip(activeCell.d, activeCell.depth)}
          x={Math.min(activeCell.x1 - 8, activeCell.x0 + 60)}
          y={Math.max(0, Math.min(height - 70, (activeCell.y0 + activeCell.y1) / 2))}
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
