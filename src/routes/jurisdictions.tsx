import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { facet } from "@/lib/atlas/bundle";
import { defaultFilters } from "@/lib/atlas/filters";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/jurisdictions")({
  head: () => ({
    meta: [
      { title: "Jurisdictions — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Source counts per U.S. jurisdiction as recorded in the imported V2.2A litigation source bundle.",
      },
      { property: "og:title", content: "Jurisdictions — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Per-jurisdiction breakdown of imported litigation research sources.",
      },
    ],
  }),
  component: JurisdictionsView,
});

function JurisdictionsView() {
  const { bundle, setFilters } = useAtlas();
  const navigate = useNavigate();
  const sources = bundle?.sources ?? [];
  const rows = useMemo(() => facet(sources, "jurisdiction"), [sources]);

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Jurisdictions" }]}
      title="Jurisdictions"
      description="Distinct-source and occurrence counts per jurisdiction value present in the imported bundle. Values are taken verbatim from the export; no jurisdiction is inferred."
    >
      {sources.length === 0 ? (
        <EmptyBundleState view="The jurisdiction breakdown" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="h-9 text-[11px] uppercase tracking-wider">Jurisdiction</TableHead>
                <TableHead className="h-9 w-32 text-right text-[11px] uppercase tracking-wider">
                  Distinct sources
                </TableHead>
                <TableHead className="h-9 w-32 text-right text-[11px] uppercase tracking-wider">
                  Occurrences
                </TableHead>
                <TableHead className="h-9 w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.value}>
                  <TableCell className="py-2 font-medium">{row.value}</TableCell>
                  <TableCell className="py-2 text-right font-mono text-[12px]">
                    {row.count.toLocaleString()}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-[12px]">
                    {row.occurrences.toLocaleString()}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setFilters({ ...defaultFilters, jurisdictions: [row.value] });
                        navigate({ to: "/" });
                      }}
                    >
                      View sources
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
