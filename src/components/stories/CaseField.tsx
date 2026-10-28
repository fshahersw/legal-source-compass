/**
 * Every case, as dots: the actions pending in the latest JPML report drawn one dot per `unit` actions (canvas), each
 * dot coloured by its MDL's litigation type. Pick a grouping (MDL, type, court, judge, year centralized) and every dot
 * travels to its new block; each block is labelled with its actions and MDLs. Hover a dot for its MDL, click to open
 * it. An MDL with fewer actions than one unit still gets one dot, so every MDL in the report is on the canvas.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { easeCubicInOut } from "d3-ease";
import { ChartTooltip, useMeasuredWidth, type TooltipContent } from "@/components/charts/canvas";
import { chartTokens } from "@/components/charts/palette";
import { Segmented } from "@/components/enforcement/parts";
import {
  GROUPING_LABEL,
  GROUPINGS,
  dotCounts,
  unitFor,
  latestMdls,
  packBlocks,
  unitGroups,
  type Atlas,
  type AtlasMdl,
  type Grouping,
} from "./atlasModel";
import { CATEGORY_LABEL, CATEGORIES, type Category } from "./storiesModel";
import { useCanvasTheme } from "./useCanvasTheme";

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const LABEL_H = 34;
const DURATION = 950;
const STAGGER = 420;

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function CaseField({
  atlas,
  districtName,
  by,
  onBy,
  maxHeight = 640,
}: {
  atlas: Atlas;
  districtName: (code: string) => string;
  by: Grouping;
  onBy: (g: Grouping) => void;
  maxHeight?: number;
}) {
  const navigate = useNavigate();
  const theme = useCanvasTheme();
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ mdl: number; x: number; y: number } | null>(null);
  const rows = useMemo(() => latestMdls(atlas), [atlas]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.pending, 0), [rows]);
  const unit = unitFor(total);
  const dots = useMemo(() => dotCounts(rows, unit), [rows, unit]);
  const byMdl = useMemo(() => new Map(rows.map((r) => [r.m.mdl, r] as const)), [rows]);
  // global dot order: MDL by MDL, largest first; dot k of MDL m keeps its index across groupings
  const dotIndex = useMemo(() => {
    const first = new Map<number, number>();
    const owner: AtlasMdl[] = [];
    for (const r of rows) {
      first.set(r.m.mdl, owner.length);
      for (let k = 0; k < (dots.get(r.m.mdl) ?? 0); k++) owner.push(r.m);
    }
    return { first, owner };
  }, [rows, dots]);
  const groups = useMemo(() => unitGroups(rows, by, districtName), [rows, by, districtName]);
  const narrow = (width ?? 0) < 640;
  const layout = useMemo(
    () =>
      width
        ? packBlocks(groups, dots, width, narrow ? maxHeight * 1.5 : maxHeight, {
            labelHeight: LABEL_H,
            gap: narrow ? 12 : 22,
          })
        : null,
    [groups, dots, width, narrow, maxHeight],
  );

  // target position of every dot for the current layout
  const targets = useMemo(() => {
    if (!layout) return null;
    const N = dotIndex.owner.length;
    const tx = new Float32Array(N);
    const ty = new Float32Array(N);
    const used = new Map<number, number>();
    const s = layout.step;
    for (const b of layout.blocks) {
      b.slots.forEach((mdl, k) => {
        const c = used.get(mdl) ?? 0;
        used.set(mdl, c + 1);
        const gi = (dotIndex.first.get(mdl) ?? 0) + c;
        tx[gi] = b.x + (k % b.cols) * s + s / 2;
        ty[gi] = b.y + LABEL_H + Math.floor(k / b.cols) * s + s / 2;
      });
    }
    return { tx, ty };
  }, [layout, dotIndex]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pos = useRef<{ x: Float32Array; y: Float32Array } | null>(null);
  const anim = useRef<{ fx: Float32Array; fy: Float32Array; t0: number; raf: number } | null>(null);
  const [labelsIn, setLabelsIn] = useState(1);
  const height = layout ? Math.ceil(layout.height) + 8 : maxHeight;

  // draw one frame
  const draw = (alphaLabels: number) => {
    const cv = canvasRef.current;
    const p = pos.current;
    if (!cv || !p || !layout || !width) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const s = layout.step;
    const size = Math.max(1.4, s * 0.78);
    const half = size / 2;
    const font = getComputedStyle(cv).fontFamily || "sans-serif";
    // labels
    ctx.globalAlpha = alphaLabels;
    for (const b of layout.blocks) {
      ctx.fillStyle = theme.ink;
      ctx.font = `600 12px ${font}`;
      const maxW = Math.max(60, b.cols * s);
      let label = b.label;
      if (by === "category") label = CATEGORY_LABEL[b.key as Category] ?? b.label;
      while (ctx.measureText(label).width > maxW && label.length > 4)
        label = `${label.slice(0, -2)}…`;
      ctx.fillText(label, b.x, b.y + 13);
      ctx.fillStyle = theme.axis;
      ctx.font = `400 11px ${font}`;
      const sub = `${n(b.actions)} actions · ${n(b.mdls)} MDL${b.mdls === 1 ? "" : "s"}`;
      ctx.fillText(sub, b.x, b.y + 27);
    }
    ctx.globalAlpha = 1;
    // dots, batched by colour
    const owner = dotIndex.owner;
    const hovered = hover?.mdl ?? null;
    for (const cat of CATEGORIES) {
      ctx.fillStyle = theme.category[cat];
      for (let i = 0; i < owner.length; i++) {
        const m = owner[i]!;
        if (m.category !== cat) continue;
        ctx.globalAlpha = hovered === null || hovered === m.mdl ? 1 : 0.28;
        ctx.fillRect(p.x[i]! - half, p.y[i]! - half, size, size);
      }
    }
    ctx.globalAlpha = 1;
    if (hovered !== null) {
      const start = dotIndex.first.get(hovered) ?? 0;
      const count = dots.get(hovered) ?? 0;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1;
      for (let i = start; i < start + count; i++)
        ctx.strokeRect(p.x[i]! - half - 0.5, p.y[i]! - half - 0.5, size + 1, size + 1);
    }
  };

  // size the canvas for the device pixel ratio
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    draw(labelsIn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // move every dot to the new layout
  useEffect(() => {
    if (!targets || !width) return;
    const N = targets.tx.length;
    const reduce = reducedMotion();
    if (!pos.current || pos.current.x.length !== N) {
      // first layout: dots start scattered across the canvas and gather into place
      const x = new Float32Array(N);
      const y = new Float32Array(N);
      let seed = 7;
      const rnd = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < N; i++) {
        x[i] = reduce ? targets.tx[i]! : rnd() * width;
        y[i] = reduce ? targets.ty[i]! : rnd() * height;
      }
      pos.current = { x, y };
    }
    if (anim.current) cancelAnimationFrame(anim.current.raf);
    if (reduce) {
      pos.current = { x: targets.tx.slice(), y: targets.ty.slice() };
      setLabelsIn(1);
      draw(1);
      return;
    }
    const fx = pos.current.x.slice();
    const fy = pos.current.y.slice();
    const t0 = performance.now();
    const delay = new Float32Array(N);
    for (let i = 0; i < N; i++)
      delay[i] = (targets.tx[i]! / Math.max(1, width)) * STAGGER + (i % 7) * 12;
    const step = (now: number) => {
      const p = pos.current!;
      let done = true;
      for (let i = 0; i < N; i++) {
        const k = Math.min(1, Math.max(0, (now - t0 - delay[i]!) / DURATION));
        if (k < 1) done = false;
        const e = easeCubicInOut(k);
        p.x[i] = fx[i]! + (targets.tx[i]! - fx[i]!) * e;
        p.y[i] = fy[i]! + (targets.ty[i]! - fy[i]!) * e;
      }
      const la = Math.min(1, Math.max(0, (now - t0 - DURATION * 0.6) / 400));
      draw(la);
      if (!done || la < 1) anim.current = { fx, fy, t0, raf: requestAnimationFrame(step) };
      else {
        anim.current = null;
        setLabelsIn(1);
      }
    };
    anim.current = { fx, fy, t0, raf: requestAnimationFrame(step) };
    return () => {
      if (anim.current) cancelAnimationFrame(anim.current.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  // redraw on hover and theme changes when not animating
  useEffect(() => {
    if (!anim.current) draw(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, theme]);

  const hit = (x: number, y: number): number | null => {
    if (!layout) return null;
    const s = layout.step;
    for (const b of layout.blocks) {
      const top = b.y + LABEL_H;
      if (x < b.x || x >= b.x + b.cols * s || y < top || y >= top + b.rows * s) continue;
      const k = Math.floor((y - top) / s) * b.cols + Math.floor((x - b.x) / s);
      return b.slots[k] ?? null;
    }
    return null;
  };

  const last = atlas.dates.length - 1;
  const hm = hover ? byMdl.get(hover.mdl) : undefined;
  const tip: TooltipContent | null = hm
    ? {
        title: `MDL ${hm.m.mdl}`,
        subtitle: hm.m.short,
        rows: [
          { key: "p", label: "Actions pending", value: n(hm.pending) },
          { key: "d", label: "Dots", value: `${n(dots.get(hm.m.mdl) ?? 0)} × ${n(unit)}` },
          {
            key: "t",
            label: "Total actions, incl. closed",
            value: hm.m.total === null ? "Not recorded" : n(hm.m.total),
          },
          {
            key: "c",
            label: "Court",
            value: hm.m.district ? districtName(hm.m.district) : "Not recorded",
          },
          { key: "j", label: "Judge", value: hm.m.judge ?? "Not recorded" },
          { key: "y", label: "Centralized", value: hm.m.transferred ?? "Not recorded" },
        ],
        footer: "Click to open the MDL",
      }
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-muted-foreground">Group the cases by</span>
        <Segmented
          label="Group the dots by"
          value={by}
          options={GROUPINGS.map((g) => ({ id: g, label: GROUPING_LABEL[g] }))}
          onChange={(g) => {
            setHover(null);
            onBy(g);
          }}
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          1 dot = {n(unit)} actions · {n(dotIndex.owner.length)} dots · {n(total)} actions in{" "}
          {n(rows.length)} MDLs ({atlas.dates[last]})
        </span>
        <ul className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {CATEGORIES.filter((c) => rows.some((r) => r.m.category === c)).map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: theme.category[c] }}
              />
              {CATEGORY_LABEL[c]}
            </li>
          ))}
        </ul>
      </div>
      <div
        ref={ref}
        className="relative w-full min-w-0"
        style={{ ...chartTokens, height, transition: "height 500ms ease" }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${n(total)} actions pending in ${n(rows.length)} MDLs in the JPML report of ${atlas.dates[last]}, one dot per ${n(unit)} actions, grouped by ${GROUPING_LABEL[by].toLowerCase()}. The table view lists every group.`}
          className="block cursor-pointer font-sans"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            const m = hit(x, y);
            setHover((h) => (m === null ? null : h?.mdl === m ? { ...h, x, y } : { mdl: m, x, y }));
          }}
          onPointerLeave={() => setHover(null)}
          onClick={() => {
            if (hover)
              void navigate({ to: "/matters/lens/$mdl", params: { mdl: String(hover.mdl) } });
          }}
        />
        {tip && hover && width ? (
          <ChartTooltip content={tip} x={hover.x} y={hover.y} containerWidth={width} />
        ) : null}
      </div>
    </div>
  );
}
