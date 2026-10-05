export function ExternalBadge() {
  return (
    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      Corpus records
    </span>
  );
}

export function ExternalError({ error }: { error: unknown }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-[13px] text-destructive">
      Could not read the connected corpus database:{" "}
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
