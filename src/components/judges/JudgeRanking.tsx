import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { JudgePoint } from "@/lib/external/judgeCross.functions";
import { JudgePortrait } from "@/components/corpus/EntityArtwork";
import { cn } from "@/lib/utils";
import { fmtInt, judgeFlag, partyColor, sortJudges, type SortKey } from "./judgeCrossView";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Judge" },
  { key: "years", label: "Yrs", align: "right" },
  { key: "pendingMdls", label: "Pending MDLs", align: "right" },
  { key: "pendingActions", label: "Pending actions", align: "right" },
  { key: "historicalMdls", label: "Terminated MDLs", align: "right" },
  { key: "totalActions", label: "Actions handled", align: "right" },
];

export function JudgeRanking({ points }: { points: JudgePoint[] }) {
  const [key, setKey] = useState<SortKey>("pendingActions");
  const [desc, setDesc] = useState(true);
  const [limit, setLimit] = useState(25);
  const sorted = sortJudges(points, key, desc);
  const shown = sorted.slice(0, limit);
  const max = Math.max(1, ...points.map((p) => p.pendingActions));
  if (!points.length)
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        No judge matches these filters.
      </p>
    );
  const sortBy = (k: SortKey) => {
    if (k === key) setDesc((d) => !d);
    else {
      setKey(k);
      setDesc(k !== "name");
    }
  };
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="border-b border-border text-[11px] text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5 text-right font-medium">#</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn("px-2 py-1.5 font-medium", c.align === "right" && "text-right")}
                  aria-sort={key === c.key ? (desc ? "descending" : "ascending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => sortBy(c.key)}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                      key === c.key && "text-foreground",
                    )}
                  >
                    {c.label}
                    {key === c.key ? (
                      desc ? (
                        <ArrowDown className="size-3" aria-hidden />
                      ) : (
                        <ArrowUp className="size-3" aria-hidden />
                      )
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={p.nid} className="border-b border-border/60 hover:bg-muted/30">
                <td className="px-2 py-1 text-right font-mono text-[11px] text-muted-foreground">
                  {i + 1}
                </td>
                <td className="px-2 py-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <JudgePortrait name={p.name} photo={p.photo} className="size-8 rounded-lg" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {p.profileId ? (
                          <Link
                            to="/judges/$id"
                            params={{ id: p.profileId }}
                            className="truncate font-medium hover:underline"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          <span className="truncate font-medium">{p.name}</span>
                        )}
                        {judgeFlag(p) ? (
                          <span
                            className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 text-[10px] text-warning-foreground"
                            title="Holds at least 5% of all pending MDL actions"
                          >
                            {p.sharePct?.toFixed(1)}% of all
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: partyColor(p.party) }}
                          aria-hidden
                        />
                        <span className="truncate">
                          {p.courtId ? (
                            <Link
                              to="/courts/$id"
                              params={{ id: p.courtId }}
                              className="hover:underline"
                            >
                              {p.courtId.toUpperCase()}
                            </Link>
                          ) : (
                            "Court not recorded"
                          )}{" "}
                          · {p.status} · {p.president ?? "Appointing president not recorded"}
                        </span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">
                  {p.years?.toFixed(1) ?? "—"}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{p.pendingMdls}</td>
                <td className="px-2 py-1 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span
                      className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"
                      aria-hidden
                    >
                      <span
                        className="block h-full bg-primary/70"
                        style={{ width: `${(p.pendingActions / max) * 100}%` }}
                      />
                    </span>
                    <span className="font-mono tabular-nums">{fmtInt(p.pendingActions)}</span>
                  </div>
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{p.historicalMdls}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">
                  {fmtInt(p.totalActions)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          Showing {shown.length} of {sorted.length} judges
        </span>
        {sorted.length > limit ? (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setLimit((l) => l + 50)}
          >
            Show more
          </button>
        ) : null}
      </div>
    </div>
  );
}
