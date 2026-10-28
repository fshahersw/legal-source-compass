/**
 * Every chart card on the page registers itself here so the navigator can read the exact figures behind it: title,
 * subtitle, sources, period and its "View data" table. Registration is a cheap getter (the table is converted to text
 * only when the navigator reads it), so animated pages that re-render every frame pay nothing. Browser-only state;
 * the server never imports it.
 */
import { isValidElement, type ReactNode } from "react";

export type ChartSnapshot = {
  title: string;
  subtitle: string;
  caption: string;
  columns: string[];
  rows: string[][];
  sources: string[];
  period: string;
};

export type ChartSource = {
  title: ReactNode;
  subtitle?: ReactNode;
  table?:
    { caption: string; columns: { label: string }[]; rows: { cells: ReactNode[] }[] } | undefined;
  sources?: readonly { label: string; url?: string | undefined }[] | undefined;
  period?: string | undefined;
};

type Entry = { key: string; read: () => ChartSource };

const entries = new Map<string, Entry>();
let counter = 0;

export function nextChartKey(): string {
  counter += 1;
  return `c${counter.toString(36)}`;
}

export function registerChart(key: string, read: () => ChartSource): () => void {
  entries.set(key, { key, read });
  return () => {
    entries.delete(key);
  };
}

/** Plain text of a React node: strings, numbers and the text inside elements and arrays. */
export function nodeText(node: ReactNode, depth = 0): string {
  if (node === null || node === undefined || typeof node === "boolean" || depth > 12) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return Number.isFinite(node) ? String(node) : "";
  if (Array.isArray(node)) return node.map((n) => nodeText(n as ReactNode, depth + 1)).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; title?: unknown; "aria-label"?: unknown };
    const inner = nodeText(props.children, depth + 1);
    if (inner) return inner;
    return typeof props["aria-label"] === "string" ? props["aria-label"] : "";
  }
  return "";
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function snapshot(src: ChartSource): ChartSnapshot {
  return {
    title: squash(nodeText(src.title)),
    subtitle: squash(nodeText(src.subtitle)),
    caption: src.table?.caption ?? "",
    columns: src.table?.columns.map((c) => c.label) ?? [],
    rows: src.table?.rows.map((r) => r.cells.map((c) => squash(nodeText(c)))) ?? [],
    sources: (src.sources ?? []).map((s) => (s.url ? `${s.label} (${s.url})` : s.label)),
    period: src.period ?? "",
  };
}

/** Registered charts whose anchor is in the document, in document order, with the anchor element. */
export function chartsOnPage(
  root: ParentNode = document,
): { key: string; el: Element; read: () => ChartSnapshot }[] {
  const out: { key: string; el: Element; read: () => ChartSnapshot }[] = [];
  for (const el of root.querySelectorAll("[data-chart-anchor]")) {
    const key = el.getAttribute("data-chart-anchor") ?? "";
    const e = entries.get(key);
    if (e) out.push({ key, el, read: () => snapshot(e.read()) });
  }
  return out;
}
