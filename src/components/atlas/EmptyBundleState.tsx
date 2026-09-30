import { Link } from "@tanstack/react-router";
import { FileJson } from "lucide-react";

import { Button } from "@/components/ui/button";

export function EmptyBundleState({ view }: { view: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center">
      <FileJson className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="mt-3 text-base">No source bundle imported</h2>
      <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
        {view} is empty because no V2.2A bundle has been imported into this browser yet. This build
        contains no sample, seeded or fabricated records — every row you will see comes from the
        supplied export file.
      </p>
      <Button asChild className="mt-5" size="sm">
        <Link to="/data-exports">Go to Data &amp; Exports to import</Link>
      </Button>
    </div>
  );
}
