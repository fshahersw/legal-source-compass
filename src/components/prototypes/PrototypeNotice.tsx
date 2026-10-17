/** Banner shown on every design-prototype route: the layout is a proposal, the data is live. */
export function PrototypeNotice() {
  return (
    <p className="mb-4 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      Design prototype. Layout generated with Kimi K3 and adapted here; every figure is live corpus
      data. Not linked from the main navigation.
    </p>
  );
}
