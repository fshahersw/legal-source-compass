export function ImportedLabel({
  label,
  value,
}: {
  label: string;
  value?: string | null | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-[12px] font-medium [overflow-wrap:anywhere]">
        {value && value.trim() !== "" ? value : <span className="text-muted-foreground">—</span>}
      </span>
    </div>
  );
}
