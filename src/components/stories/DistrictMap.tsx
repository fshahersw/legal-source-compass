/**
 * Where the cases sit: actions pending in MDLs by transferee district on a U.S. map, one bubble per district court
 * (area = actions pending), moving with the same playhead as the docket race. Each point is counted under the
 * district its own report prints. A bubble sits at a courthouse the district court lists (its own website, geocoded by
 * the Census Bureau, or its building registry): it marks the district, not the MDL judge's courtroom. Hover for the
 * court, click to open it. The ranked list beside the map follows the same report.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { geoAlbersUsa } from "d3-geo";
import { ChartTooltip, useMeasuredWidth, type TooltipContent } from "@/components/charts/canvas";
import { chartTokens, seriesVar } from "@/components/charts/palette";
import type { GeoData } from "@/lib/corpus/geo";
import { blendAt, courtShort, type Atlas, type AtlasDistrict } from "./atlasModel";
import { reportLabel } from "./storiesColors";

const VW = 975;
const VH = 610;
/** The us-atlas "albers" files are pre-projected with this projection (d3-geo defaults scaled to 975 × 610). */
const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const n = (v: number) => Math.round(v).toLocaleString("en-US");

export function DistrictMap({ atlas, t, geo }: { atlas: Atlas; t: number; geo: GeoData | null }) {
  const navigate = useNavigate();
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const near = Math.max(0, Math.min(atlas.dates.length - 1, Math.round(t)));
  const placed = useMemo(
    () =>
      atlas.districts
        .map((d) => {
          const p = d.lat !== null && d.lon !== null ? projection([d.lon, d.lat]) : null;
          return p ? { d, x: p[0], y: p[1] } : null;
        })
        .filter((x): x is { d: AtlasDistrict; x: number; y: number } => !!x),
    [atlas],
  );
  const unplaced = atlas.districts.filter((d) => !placed.some((p) => p.d.code === d.code));
  const maxEver = useMemo(() => Math.max(1, ...atlas.districts.flatMap((d) => d.values)), [atlas]);
  const w = width ?? 0;
  const mapW = w >= 900 ? w - 268 : w;
  const k = mapW / VW;
  const mapH = Math.round(VH * k);
  const rMax = 62;
  const radius = (v: number) => Math.sqrt(Math.max(0, v) / maxEver) * rMax;
  const bubbles = placed
    .map((p) => ({ ...p, v: blendAt(p.d.values, t), count: p.d.counts[near] ?? 0 }))
    .sort((a, b) => b.v - a.v);
  const frameTotal = atlas.districts.reduce((s, d) => s + (d.values[near] ?? 0), 0);
  const ranked = [...atlas.districts]
    .map((d) => ({ d, v: blendAt(d.values, t) }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);
  const topIds = new Set(bubbles.slice(0, w < 640 ? 4 : 7).map((b) => b.d.code));
  const hb = hover ? bubbles.find((b) => b.d.code === hover) : undefined;
  const tip: TooltipContent | null = hb
    ? {
        title: courtShort(hb.d),
        subtitle: [hb.d.city, hb.d.state].filter(Boolean).join(", ") || undefined,
        rows: [
          {
            key: "p",
            label: `Actions pending, ${reportLabel(atlas.dates[near] ?? "")}`,
            value: n(hb.d.values[near] ?? 0),
          },
          { key: "m", label: "MDLs listed there", value: n(hb.count) },
          {
            key: "s",
            label: "Share of all MDL actions",
            value:
              frameTotal > 0
                ? `${(((hb.d.values[near] ?? 0) / frameTotal) * 100).toFixed(1)}%`
                : "Not recorded",
          },
          {
            key: "x",
            label: "Peak in these reports",
            value: n(Math.max(...hb.d.values)),
          },
        ],
        footer: "Click to open the court",
      }
    : null;
  const fs = (px: number) => px / k;
  return (
    <div ref={ref} className="w-full min-w-0" style={chartTokens}>
      {w ? (
        <div className="flex flex-col gap-4 min-[900px]:flex-row">
          <div className="relative shrink-0" style={{ width: mapW, height: mapH }}>
            <svg
              width={mapW}
              height={mapH}
              viewBox={`0 0 ${VW} ${VH}`}
              role="img"
              aria-label={`Actions pending in MDLs by transferee district in the JPML report of ${reportLabel(atlas.dates[near] ?? "")}. Largest: ${ranked
                .slice(0, 3)
                .map((r) => `${courtShort(r.d)} ${n(r.d.values[near] ?? 0)}`)
                .join(", ")}.`}
              className="block"
            >
              <defs>
                <radialGradient id="dm-glow">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.55} />
                  <stop offset="70%" stopColor="var(--chart-1)" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </radialGradient>
              </defs>
              {geo ? (
                <g>
                  {geo.states.map((s) => (
                    <path key={s.id} d={s.d} fill="var(--muted)" stroke="none" />
                  ))}
                  <path
                    d={geo.stateBorders}
                    fill="none"
                    stroke="var(--chart-surface)"
                    strokeWidth={fs(1)}
                  />
                </g>
              ) : (
                <text
                  x={VW / 2}
                  y={VH / 2}
                  textAnchor="middle"
                  fontSize={fs(12)}
                  fill="var(--chart-axis)"
                >
                  Map outline not loaded
                </text>
              )}
              {bubbles.map((b) => {
                const r = radius(b.v);
                if (r < 0.4) return null;
                const on = hover === b.d.code;
                return (
                  <g
                    key={b.d.code}
                    transform={`translate(${b.x},${b.y})`}
                    className="cursor-pointer"
                    onPointerEnter={() => setHover(b.d.code)}
                    onPointerLeave={() => setHover((h) => (h === b.d.code ? null : h))}
                    onClick={() =>
                      void navigate({ to: "/courts/$id", params: { id: b.d.courtId } })
                    }
                    opacity={hover && !on ? 0.45 : 1}
                    style={{ transition: "opacity 160ms" }}
                  >
                    <circle r={r * 1.9 + 4} fill="url(#dm-glow)" pointerEvents="none" />
                    <circle
                      r={Math.max(r, 1.6)}
                      fill={seriesVar(0)}
                      fillOpacity={0.62}
                      stroke="var(--chart-surface)"
                      strokeWidth={fs(1.2)}
                    />
                    <circle r={Math.max(r, 7)} fill="transparent" />
                    {on ? (
                      <circle
                        r={r + fs(3)}
                        fill="none"
                        stroke="var(--chart-ink)"
                        strokeWidth={fs(1.5)}
                      />
                    ) : null}
                  </g>
                );
              })}
              {bubbles
                .filter((b) => topIds.has(b.d.code) || b.d.code === hover)
                .map((b) => {
                  const r = radius(b.v);
                  const half = (courtShort(b.d).length * fs(12) * 0.6) / 2 + 4;
                  const lx = Math.min(VW - half, Math.max(half, b.x));
                  return (
                    <g key={`l${b.d.code}`} pointerEvents="none">
                      <text
                        x={lx}
                        y={b.y - r - fs(6)}
                        textAnchor="middle"
                        fontSize={fs(12)}
                        fontWeight={700}
                        fill="var(--chart-ink)"
                        stroke="var(--chart-surface)"
                        strokeWidth={fs(3)}
                        paintOrder="stroke"
                      >
                        {courtShort(b.d)}
                      </text>
                      <text
                        x={b.x}
                        y={b.y + fs(4)}
                        textAnchor="middle"
                        fontSize={fs(11)}
                        fontWeight={700}
                        fill="var(--chart-ink)"
                        stroke="var(--chart-surface)"
                        strokeWidth={fs(3)}
                        paintOrder="stroke"
                        className="tabular-nums"
                      >
                        {n(b.v)}
                      </text>
                    </g>
                  );
                })}
              <text
                x={VW - 8}
                y={VH - 14}
                textAnchor="end"
                fontSize={fs(Math.min(72, mapW * 0.09))}
                fontWeight={800}
                fill="var(--chart-ink)"
                opacity={0.07}
              >
                {(atlas.dates[near] ?? "").slice(0, 4)}
              </text>
            </svg>
            {tip && hb ? (
              <ChartTooltip content={tip} x={hb.x * k} y={hb.y * k} containerWidth={mapW} />
            ) : null}
            <BubbleKey maxEver={maxEver} radius={(v) => radius(v) * k} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Largest courts, {reportLabel(atlas.dates[near] ?? "")}
            </p>
            <ol className="space-y-1.5">
              {ranked.map((r, i) => {
                const lead = ranked[0]?.v ?? 1;
                return (
                  <li
                    key={r.d.code}
                    className="text-xs"
                    onPointerEnter={() => setHover(r.d.code)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="w-4 shrink-0 tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{courtShort(r.d)}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{n(r.v)}</span>
                    </div>
                    <div className="ml-6 mt-0.5 h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300"
                        style={{ width: `${(r.v / lead) * 100}%`, background: "var(--chart-1)" }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            {unplaced.some((d) => (d.values[near] ?? 0) > 0) ? (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Not on the map (no courthouse coordinates recorded):{" "}
                {unplaced
                  .filter((d) => (d.values[near] ?? 0) > 0)
                  .map((d) => `${courtShort(d)} ${n(d.values[near] ?? 0)}`)
                  .join(", ")}
                .
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BubbleKey({ maxEver, radius }: { maxEver: number; radius: (v: number) => number }) {
  const steps = [1000, 10000, 50000].filter((v) => v < maxEver * 1.1);
  const rMax = radius(steps.at(-1) ?? 1);
  return (
    <svg
      className="pointer-events-none absolute bottom-1 left-1 overflow-visible"
      width={rMax * 2 + 70}
      height={rMax * 2 + 6}
      aria-hidden
    >
      {steps.map((v) => {
        const r = radius(v);
        return (
          <g key={v}>
            <circle
              cx={rMax + 1}
              cy={rMax * 2 + 2 - r}
              r={r}
              fill="none"
              stroke="var(--chart-axis)"
              strokeOpacity={0.6}
            />
            <text x={rMax * 2 + 8} y={rMax * 2 + 6 - r * 2} fontSize={10} fill="var(--chart-axis)">
              {n(v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
