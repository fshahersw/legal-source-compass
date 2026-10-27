/**
 * "Top 5 emerging" tile for the Litigation hub: the five highest-ranked radar units with no MDL linked, each opening
 * its evidence on /safety/signals. Renders nothing until the radar dataset is published. Mounted by the hub page
 * (SectionHub `children`), see hubs.ts.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, SourceFooter } from "@/components/kit";
import { radarQuery } from "./radarQueries";
import { FAMILY_LABEL, KIND_LABEL, RADAR_SOURCES, emerging } from "./radarModel";

export function RadarTopFive() {
  const q = useQuery(radarQuery);
  const top = q.data?.published ? emerging(q.data.rows).slice(0, 5) : [];
  if (!top.length) return null;
  return (
    <Card>
      <CardHeader
        title={
          <Link to="/safety/signals" className="hover:underline">
            Top 5 emerging (no MDL linked)
          </Link>
        }
        description="Rising safety records with no MDL linked by an exact key"
      />
      <CardBody>
        <ol className="space-y-1.5">
          {top.map((r) => (
            <li key={r.unit_id} className="flex items-baseline justify-between gap-3 text-meta">
              <Link
                to="/safety/signals"
                search={{ unit: r.unit_id }}
                className="min-w-0 truncate font-medium hover:underline"
                title={r.label}
              >
                {r.rank}. {r.label}
              </Link>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {KIND_LABEL[r.kind]} · {r.points} pt ·{" "}
                {r.families.map((f) => FAMILY_LABEL[f]).join(", ")}
              </span>
            </li>
          ))}
        </ol>
        <SourceFooter
          className="mt-3"
          source={RADAR_SOURCES.map((s) => ({ label: s.label, href: s.url }))}
          asOf={q.data?.summary?.as_of}
        />
      </CardBody>
    </Card>
  );
}
