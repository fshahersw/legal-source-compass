import { Link } from "@tanstack/react-router";
import { AlertTriangle, FileJson, Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAtlas } from "@/lib/atlas/store";

/** Shown instead of a view's content while the directory loads, fails, or is genuinely empty. */
export function EmptyBundleState({ view }: { view: string }) {
  const { status, loadError, notices, retryLoad } = useAtlas();

  if (status === "loading") {
    return (
      <div
        role="status"
        className="flex items-center gap-2.5 rounded-lg border border-border bg-surface p-6 text-[13px] text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" /> Loading the source directory…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-destructive">
          <AlertTriangle className="size-4" /> The directory could not be loaded
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-foreground">{loadError}</p>
        {notices.map((n) => (
          <p key={n} className="mt-1 text-[12px] text-muted-foreground">
            {n}
          </p>
        ))}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={retryLoad}>
            <RotateCw className="size-3.5" /> Retry
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/data-exports">Import a bundle file instead</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center">
      <FileJson className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="mt-3 text-base">No source rows in the loaded bundle</h2>
      <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
        {view} is empty because the bundle currently loaded contains no directory sources. You can
        restore the bundled source directory from Data &amp; Exports.
      </p>
      <Button asChild className="mt-5" size="sm">
        <Link to="/data-exports">Go to Data {"&"} Exports</Link>
      </Button>
    </div>
  );
}
