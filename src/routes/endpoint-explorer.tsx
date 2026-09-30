import { createFileRoute } from "@tanstack/react-router";
import { Copy, ExternalLink, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/atlas/AppShell";
import { EmptyBundleState } from "@/components/atlas/EmptyBundleState";
import { Pager } from "@/components/atlas/Pager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { paginate } from "@/lib/atlas/filters";
import { useAtlas } from "@/lib/atlas/store";

export const Route = createFileRoute("/endpoint-explorer")({
  head: () => ({
    meta: [
      { title: "Endpoint Explorer — Legal Source Atlas" },
      {
        name: "description",
        content:
          "Raw endpoint candidates carried in the imported bundle, listed without any live probing or crawling.",
      },
      { property: "og:title", content: "Endpoint Explorer — Legal Source Atlas" },
      {
        property: "og:description",
        content: "Inspect imported raw endpoint candidates and their provenance.",
      },
    ],
  }),
  component: EndpointExplorer,
});

function EndpointExplorer() {
  const { bundle } = useAtlas();
  const candidates = bundle?.endpoint_candidates ?? [];
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return candidates;
    return candidates.filter((c) => {
      const hay = [c.url, c.domain, c.source_family, c.jurisdiction, c.candidate_kind, c.notes]
        .join(" \u0001 ")
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [candidates, query]);

  const view = paginate(filtered, page, pageSize);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Endpoint URL copied");
    } catch {
      toast.error("Clipboard blocked by the browser");
    }
  }

  return (
    <AppShell
      breadcrumbs={[{ label: "Atlas", to: "/" }, { label: "Sources", to: "/" }, { label: "Endpoint Explorer" }]}
      title="Endpoint Explorer"
      description="Raw endpoint candidates exactly as recorded in the bundle. This build performs no live requests, probing or crawling — status values shown here are imported text, not a live check."
    >
      {(bundle?.sources.length ?? 0) === 0 ? (
        <EmptyBundleState view="The endpoint explorer" />
      ) : candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center text-[13px] text-muted-foreground">
          The imported bundle contains no endpoint candidates.
        </p>
      ) : (
        <>
          <div className="relative max-w-xl">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search endpoint URLs, domains, families…"
              className="h-9 pl-8 text-[13px]"
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="h-9 text-[11px] uppercase tracking-wider">Endpoint</TableHead>
                  <TableHead className="h-9 w-24 text-[11px] uppercase tracking-wider">Method</TableHead>
                  <TableHead className="h-9 w-40 text-[11px] uppercase tracking-wider">Family</TableHead>
                  <TableHead className="h-9 w-36 text-[11px] uppercase tracking-wider">
                    Imported status
                  </TableHead>
                  <TableHead className="h-9 w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.items.map((c) => (
                  <TableRow key={c.id} className="align-top">
                    <TableCell className="py-2">
                      <div className="mono-cell break-all text-foreground">{c.url}</div>
                      {c.notes ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{c.notes}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2 font-mono text-[12px]">{c.method ?? "—"}</TableCell>
                    <TableCell className="py-2 text-[12px]">{c.source_family || "—"}</TableCell>
                    <TableCell className="py-2">
                      {c.imported_status ? (
                        <Badge variant="outline" className="text-[10px]">
                          {c.imported_status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => copy(c.url)}
                          aria-label="Copy endpoint URL"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" asChild>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            aria-label="Open endpoint"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={view.page}
            pageCount={view.pageCount}
            pageSize={pageSize}
            total={view.total}
            from={view.from}
            to={view.to}
            onPage={setPage}
            onPageSize={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        </>
      )}
    </AppShell>
  );
}
