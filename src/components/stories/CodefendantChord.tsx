/**
 * Sued together: a chord diagram (d3-chord) of the companies SEC filings link to MDLs as defendants. Each arc is a
 * company, sized by how many co-defendant pairings it has; each ribbon joins two companies and is as wide as the
 * number of MDLs whose filings name both. Hover a company to light its ribbons, hover a ribbon for the shared MDLs,
 * click a company to pin it and list its co-defendants.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  chord as d3chord,
  ribbon as d3ribbon,
  type Chord as D3Chord,
  type ChordGroup,
} from "d3-chord";
import { arc as d3arc } from "d3-shape";
import { ChartTooltip, useMeasuredWidth, type TooltipContent } from "@/components/charts/canvas";
import { chartTokens, sequentialFill } from "@/components/charts/palette";
import { shortTitle, type Network } from "./storiesModel";
import { codefendants, displayCompany } from "./atlasModel";

const n = (v: number) => v.toLocaleString("en-US");

export function CodefendantChord({
  network,
  size: maxSize = 760,
}: {
  network: Network;
  size?: number;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<
    { kind: "group"; i: number } | { kind: "ribbon"; i: number; j: number } | null
  >(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const data = useMemo(() => codefendants(network, 18), [network]);
  const titles = useMemo(
    () => new Map(network.mdls.map((m) => [m.mdl, shortTitle(m.title)] as const)),
    [network],
  );
  const chords = useMemo<D3Chord[] & { groups: ChordGroup[] }>(
    () =>
      d3chord()
        .padAngle(0.035)
        .sortSubgroups((a, b) => b - a)(data.matrix),
    [data],
  );
  const w = width ?? 0;
  const side = w >= 980;
  const size = Math.min(maxSize, side ? w - 300 : w);
  const labelRoom = size < 520 ? 84 : 150;
  const outer = Math.max(80, size / 2 - labelRoom);
  const inner = outer - 14;
  const arc = d3arc<ChordGroup>().innerRadius(inner).outerRadius(outer).cornerRadius(2);
  const ribbon = d3ribbon<D3Chord, unknown>().radius(inner - 1);
  const maxGroup = Math.max(1, ...chords.groups.map((g) => g.value));
  const focus = hover?.kind === "group" ? hover.i : pinned;
  const ribbonOn = (c: D3Chord) =>
    hover?.kind === "ribbon"
      ? (c.source.index === hover.i && c.target.index === hover.j) ||
        (c.source.index === hover.j && c.target.index === hover.i)
      : focus !== null
        ? c.source.index === focus || c.target.index === focus
        : true;

  const tip: { content: TooltipContent; x: number; y: number } | null = (() => {
    if (!hover) return null;
    const cx = size / 2;
    if (hover.kind === "group") {
      const g = chords.groups[hover.i];
      const c = data.companies[hover.i];
      if (!g || !c) return null;
      const a = (g.startAngle + g.endAngle) / 2 - Math.PI / 2;
      const partners = data.matrix[hover.i]!.filter((v) => v > 0).length;
      return {
        x: cx + Math.cos(a) * outer,
        y: cx + Math.sin(a) * outer,
        content: {
          title: displayCompany(c.company),
          subtitle: `CIK ${c.cik}`,
          rows: [
            { key: "m", label: "MDLs its filings link it to", value: n(c.mdls.length) },
            { key: "p", label: "Companies sued alongside it", value: n(partners) },
            ...c.also.map((a) => ({
              key: a.cik,
              label: "Same MDLs, folded in",
              value: displayCompany(a.company),
            })),
          ],
          footer: "Click to pin and list them",
        },
      };
    }
    const a = data.companies[hover.i];
    const b = data.companies[hover.j];
    const shared = data.shared[hover.i]?.[hover.j] ?? [];
    if (!a || !b) return null;
    return {
      x: cx,
      y: cx,
      content: {
        title: `${displayCompany(a.company)} and ${displayCompany(b.company)}`,
        subtitle: `${n(shared.length)} MDL${shared.length === 1 ? "" : "s"} name both`,
        rows: shared
          .slice(0, 6)
          .map((m) => ({ key: String(m), label: titles.get(m) ?? `MDL ${m}`, value: String(m) })),
        footer: shared.length > 6 ? `and ${shared.length - 6} more` : undefined,
      },
    };
  })();

  const pairs = useMemo(() => {
    const out: { i: number; j: number; shared: number[] }[] = [];
    data.shared.forEach((row, i) =>
      row.forEach((s, j) => (j > i && s.length ? out.push({ i, j, shared: s }) : null)),
    );
    return out.sort((x, y) => y.shared.length - x.shared.length).slice(0, 8);
  }, [data]);
  const pin = pinned !== null ? data.companies[pinned] : undefined;

  return (
    <div ref={ref} className="w-full min-w-0" style={chartTokens}>
      {w ? (
        <div className={side ? "flex items-start gap-6" : "space-y-4"}>
          <div className="relative mx-auto shrink-0" style={{ width: size, height: size }}>
            <svg
              width={size}
              height={size}
              role="img"
              aria-label={`Chord diagram of ${data.companies.length} companies that SEC filings name as defendants in the same MDLs. The table view lists every pair.`}
              className="block overflow-visible"
              onClick={(e) => {
                if (!(e.target as Element).closest("[data-group]")) setPinned(null);
              }}
            >
              <g transform={`translate(${size / 2},${size / 2})`}>
                {chords.map((c, k) => {
                  const on = ribbonOn(c);
                  const lit = hover !== null || focus !== null;
                  return (
                    <path
                      key={k}
                      d={(ribbon(c) as unknown as string) ?? ""}
                      fill="var(--chart-1)"
                      fillOpacity={lit ? (on ? 0.72 : 0.04) : 0.3}
                      stroke="var(--chart-1)"
                      strokeOpacity={lit && on ? 0.9 : 0.25}
                      strokeWidth={0.6}
                      style={{ transition: "fill-opacity 180ms, stroke-opacity 180ms" }}
                      className="cursor-pointer"
                      onPointerEnter={() =>
                        setHover({ kind: "ribbon", i: c.source.index, j: c.target.index })
                      }
                      onPointerLeave={() => setHover(null)}
                    />
                  );
                })}
                {chords.groups.map((g) => {
                  const c = data.companies[g.index]!;
                  const a = (g.startAngle + g.endAngle) / 2;
                  const flip = a > Math.PI;
                  const on =
                    focus === null || focus === g.index || (data.matrix[focus]?.[g.index] ?? 0) > 0;
                  const name =
                    displayCompany(c.company) + (c.also.length ? ` +${c.also.length}` : "");
                  const maxChars = size < 520 ? 12 : 20;
                  return (
                    <g
                      key={g.index}
                      data-group=""
                      className="cursor-pointer"
                      onPointerEnter={() => setHover({ kind: "group", i: g.index })}
                      onPointerLeave={() => setHover(null)}
                      onClick={() => setPinned((p) => (p === g.index ? null : g.index))}
                      opacity={on ? 1 : 0.3}
                      style={{ transition: "opacity 180ms" }}
                    >
                      <path
                        d={arc(g) ?? ""}
                        fill={sequentialFill(0.35 + 0.65 * (g.value / maxGroup))}
                        stroke={pinned === g.index ? "var(--chart-ink)" : "var(--chart-surface)"}
                        strokeWidth={pinned === g.index ? 1.5 : 1}
                      />
                      <text
                        transform={`rotate(${(a * 180) / Math.PI - 90}) translate(${outer + 8}) ${flip ? "rotate(180)" : ""}`}
                        textAnchor={flip ? "end" : "start"}
                        dy="0.35em"
                        fontSize={size < 520 ? 10 : 11.5}
                        fontWeight={focus === g.index ? 700 : 600}
                        fill="var(--chart-ink)"
                      >
                        {name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
            {tip ? (
              <ChartTooltip content={tip.content} x={tip.x} y={tip.y} containerWidth={size} />
            ) : null}
          </div>
          <aside className="min-w-0 flex-1 space-y-3 text-xs">
            {pin && pinned !== null ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pinned
                </p>
                <p className="text-sm font-semibold">{displayCompany(pin.company)}</p>
                <Link
                  to="/companies/$cik"
                  params={{ cik: pin.cik }}
                  className="font-semibold underline underline-offset-2"
                >
                  Open company profile
                </Link>
                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {data.companies
                    .map((c, j) => ({ c, j, s: data.shared[pinned]?.[j] ?? [] }))
                    .filter((x) => x.s.length)
                    .sort((a, b) => b.s.length - a.s.length)
                    .map((x) => (
                      <li key={x.c.cik}>
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => setPinned(x.j)}
                        >
                          {displayCompany(x.c.company)}
                        </button>
                        <p className="text-muted-foreground">
                          {x.s.map((m) => `${m} ${titles.get(m) ?? ""}`.trim()).join(" · ")}
                        </p>
                      </li>
                    ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Most often sued together
                </p>
                <ol className="space-y-1.5">
                  {pairs.map((p) => (
                    <li
                      key={`${p.i}-${p.j}`}
                      onPointerEnter={() => setHover({ kind: "ribbon", i: p.i, j: p.j })}
                      onPointerLeave={() => setHover(null)}
                    >
                      <span className="font-medium">
                        {displayCompany(data.companies[p.i]!.company)} ·{" "}
                        {displayCompany(data.companies[p.j]!.company)}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {n(p.shared.length)} MDL{p.shared.length === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-muted-foreground">
              Arc shade and length: co-defendant pairings. Ribbon width: MDLs whose SEC filings name
              both companies as defendants. {data.companies.length} companies with at least one
              shared MDL, largest by MDLs linked.
              {data.folded
                ? ` Registrants whose filings link exactly the same MDLs (a parent and its subsidiaries filing one report) are shown once with "+N"; ${data.folded} folded in.`
                : ""}
            </p>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
