/**
 * EmptyState: a calm placeholder for "nothing here yet", "nothing matches" or "not recorded" surfaces (icon, title,
 * one line, optional action). `tone="error"` turns it into an alert with the same layout.
 *
 *   <EmptyState icon={SearchX} title="No state matches" description="Try its full name or two-letter abbreviation." />
 *   <EmptyState tone="error" title="Record counts could not be loaded" action={<Button size="sm" onClick={retry}>Retry</Button>} />
 */
import type { ComponentType, ReactNode } from "react";
import { CircleAlert, Inbox, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "empty",
  compact = false,
  className,
}: {
  icon?: ComponentType<LucideProps> | undefined;
  title: ReactNode;
  description?: ReactNode | undefined;
  action?: ReactNode | undefined;
  tone?: "empty" | "error" | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  const Icon = icon ?? (tone === "error" ? CircleAlert : Inbox);
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong/70 bg-card/60 text-center",
        compact ? "gap-1.5 px-4 py-5" : "gap-2 px-6 py-10",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-lg border border-border bg-muted/60",
          compact ? "size-8" : "size-10",
          tone === "error" ? "text-status-critical-ink" : "text-muted-foreground",
        )}
        aria-hidden
      >
        <Icon className={compact ? "size-4" : "size-5"} strokeWidth={1.75} />
      </span>
      <p className="text-label text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-[13px] leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
