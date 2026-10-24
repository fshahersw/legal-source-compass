/**
 * StatusPill: a soft pill (tinted background, matching ink, hairline ring) with an icon and a label, so a status is
 * never carried by colour alone. Tones: good, warning, serious, critical (the reserved status colours), info (the
 * accent) and neutral. Status colours are for status only, never for a data series.
 *
 *   <StatusPill tone="critical">High</StatusPill>
 *   <StatusPill tone="neutral" icon={false}>Partial</StatusPill>
 *
 * PartialPill is the small "partial" marker for a partial period; its note opens in a popover when given.
 */
import type { ComponentType, ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  OctagonAlert,
  Siren,
  type LucideProps,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoPopover } from "./InfoPopover";
import { TONE_CLASS, pillBase, type StatusTone } from "./styles";

export type { StatusTone };

const TONE_ICON: Record<StatusTone, ComponentType<LucideProps>> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: OctagonAlert,
  critical: Siren,
  info: Info,
  neutral: CircleDashed,
};

export function StatusPill({
  tone = "neutral",
  icon = true,
  children,
  className,
  title,
}: {
  tone?: StatusTone | undefined;
  /** true: the tone's default icon; false: no icon (the label must then name the status); or a custom icon. */
  icon?: boolean | ComponentType<LucideProps> | undefined;
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const Icon = icon === true ? TONE_ICON[tone] : icon === false ? null : icon;
  return (
    <span className={cn(pillBase, TONE_CLASS[tone], className)} title={title}>
      {Icon ? <Icon className="size-3 shrink-0" aria-hidden strokeWidth={2} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** "Partial" marker for a partial period; the note (why, how much so far) opens in a popover. */
export function PartialPill({
  note,
  label = "Partial",
  className,
}: {
  note?: ReactNode | undefined;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const pill = (
    <StatusPill tone="neutral" icon={CircleDashed} className={className}>
      {label}
    </StatusPill>
  );
  if (!note) return pill;
  return (
    <InfoPopover label={`${label} period: what this means`} trigger={pill} title="Partial period">
      {note}
    </InfoPopover>
  );
}
