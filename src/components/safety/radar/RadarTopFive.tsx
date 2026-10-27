/**
 * "Top 5 emerging" tile for the Litigation hub: the five highest-ranked radar units with no open MDL linked (a unit
 * linked only to a closed MDL is marked "Earlier MDL closed: N"), each opening its evidence on /safety/signals.
 * Renders nothing until the radar dataset is published. Not mounted yet: the Litigation hub route
 * (src/routes/litigation.index.tsx, another workstream's file) passes it to SectionHub `lead` or `children`.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, SourceFooter } from "@/components/kit";
import { radarQuery } from "./radarQueries";
import { FAMILY_LABEL, KIND_LABEL, RADAR_SOURCES, closedMdlNote, emerging } from "./radarModel";

export function RadarTopFive() {
  const q = useQuery(radarQuery);
  const top = q.data?.published ? emerging(q.data.rows).slice(0, 5) : [];
  if (!top.length) return null;
  return (
    <Card>
      <CardHeader
        title={
          <Link to="/safety/signals" className="hover:underline">
            Top 5 emerging (no open MDL linked)
          </Link>
        }
        description="Rising safety records with no open MDL linked by an exact key; a closed MDL is marked"
      />
      <CardBody>
        <ol className="space-y-1.5">
          {top.map((r) => {
            const closed = closedMdlNote(r);
            return (
              <li key={r.unit_id} className="flex items-baseline justify-between gap-3 text-meta">
                <span className="min-w-0">
                  <Link
                    to="/safety/signals"
                    search={{ unit: r.unit_id }}
                    className="block truncate font-medium hover:underline"
                    title={r.label}
                  >
                    {r.rank}. {r.label}
                  </Link>
                  {closed ? <span className="block text-muted-foreground">{closed}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {KIND_LABEL[r.kind]} · {r.points} pt ·{" "}
                  {r.families.map((f) => FAMILY_LABEL[f]).join(", ")}
                </span>
              </li>
            );
          })}
        </ol>
        <SourceFooter
          className="mt-3"
          source={RADAR_SOURCES.map((s) => ({ label: s.label, href: s.url }))}
          period={
            q.data?.summary
              ? `FAERS ${q.data.summary.windows["faers"] ?? "window not recorded"}; NHTSA ${q.data.summary.windows["nhtsa"] ?? "window not recorded"}`
              : undefined
          }
          asOf={q.data?.summary?.as_of}
        />
      </CardBody>
    </Card>
  );
}
