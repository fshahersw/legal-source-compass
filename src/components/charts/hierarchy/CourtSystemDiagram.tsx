/**
 * CourtSystemDiagram: the court structure as tiers, highest first, side by side for the federal system and one state
 * (chosen with a selector). Every node is the same size and shows the number of courts recorded at that tier, linking to
 * those courts. Arrows point up, the direction of appeal; a dashed link marks U.S. Supreme Court review of state courts
 * of last resort on federal questions. Tiers come only from each court's recorded type (see courtTiers).
 */
import { Link } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "@/components/kit/Card";
import { stateByUsps } from "@/lib/corpus/geo";
import type { CourtRow } from "@/lib/external/directoryTree";
import { cn } from "@/lib/utils";
import { courtTiers, type Tier } from "./courtTiers";

function Node({ tier, system, state, active }: { tier: Tier; system: string; state?: string | undefined; active?: boolean }) {
  const empty = tier.count === 0;
  const search =
    tier.id === "scotus"
      ? undefined
      : { system, ...(state ? { state } : {}), type: tier.types.length === 1 ? tier.types[0] : "*" };
  const body = (
    <>
      <span className="block truncate text-label font-semibold text-foreground">{tier.label}</span>
      <span className="text-meta text-muted-foreground">
        {empty ? "Not recorded" : `${tier.count.toLocaleString()} court${tier.count === 1 ? "" : "s"} recorded`}
      </span>
    </>
  );
  const cls = cn(
    "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
    active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50",
    empty && "border-dashed opacity-70",
  );
  if (tier.id === "scotus")
    return (
      <Link to="/courts/$id" params={{ id: "scotus" }} className={cls}>
        {body}
      </Link>
    );
  return empty ? (
    <div className={cls}>{body}</div>
  ) : (
    <Link to="/courts" search={search} className={cls}>
      {body}
    </Link>
  );
}

function Column({
  title,
  tiers,
  side,
  other,
  system,
  state,
  activeTier,
}: {
  title: string;
  tiers: Tier[];
  side: Tier[];
  other: number;
  system: string;
  state?: string | undefined;
  activeTier?: string | undefined;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {tiers.map((t, i) => (
        <div key={t.id}>
          {i > 0 ? (
            <div className="flex justify-center py-0.5 text-muted-foreground" aria-hidden>
              <ArrowUp className="size-3.5" />
            </div>
          ) : null}
          <Node tier={t} system={system} state={state} active={activeTier === t.id} />
        </div>
      ))}
      {side.length || other ? (
        <div className="mt-2 grid gap-1.5 border-t border-border pt-2 sm:grid-cols-2">
          {side.map((t) => (
            <Node key={t.id} tier={t} system={system} state={state} active={activeTier === t.id} />
          ))}
          {other ? (
            <Link
              to="/courts"
              search={{ system, ...(state ? { state } : {}), type: "*" }}
              className="rounded-lg border border-dashed border-border px-3 py-2 text-meta text-muted-foreground hover:border-primary/50"
            >
              {other.toLocaleString()} other recorded {other === 1 ? "entry" : "entries"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CourtSystemDiagram({
  rows,
  initialState = "CA",
  showFederal = true,
  activeTier,
}: {
  rows: readonly CourtRow[];
  initialState?: string | undefined;
  showFederal?: boolean | undefined;
  activeTier?: string | undefined;
}) {
  const states = useMemo(
    () =>
      [...new Set(rows.filter((r) => r.system === "State" && stateByUsps.has(r.state)).map((r) => r.state))].sort(
        (a, b) => (stateByUsps.get(a)?.name ?? a).localeCompare(stateByUsps.get(b)?.name ?? b),
      ),
    [rows],
  );
  const [state, setState] = useState(states.includes(initialState) ? initialState : (states[0] ?? initialState));
  const federal = useMemo(() => courtTiers(rows, "Federal"), [rows]);
  const st = useMemo(() => courtTiers(rows, "State", state), [rows, state]);
  if (!rows.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-heading font-semibold">How the courts fit together</h2>
          <p className="text-meta text-muted-foreground">
            Arrows point the way appeals go. Counts are courts recorded at each level; open a level for its courts.
          </p>
        </div>
        <label className="flex items-center gap-2 text-meta text-muted-foreground">
          State
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px] text-foreground"
          >
            {states.map((s) => (
              <option key={s} value={s}>
                {stateByUsps.get(s)?.name ?? s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={cn("grid gap-6", showFederal && "md:grid-cols-2")}>
        {showFederal ? (
          <Column title="Federal" tiers={federal.main} side={federal.side} other={federal.other} system="Federal" activeTier={activeTier} />
        ) : null}
        <div className="relative">
          <Column
            title={`${stateByUsps.get(state)?.name ?? state} state courts`}
            tiers={st.main}
            side={st.side}
            other={st.other}
            system="State"
            state={state}
            activeTier={activeTier}
          />
          {showFederal ? (
            <p className="mt-2 border-l-2 border-dashed border-primary/60 pl-2 text-meta text-muted-foreground">
              Federal questions from the state court of last resort can go to the U.S. Supreme Court.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
