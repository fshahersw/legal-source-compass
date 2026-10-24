/**
 * "Explore" sheet on a chart card: pick fields for X, Y and Colour from the rows the chart already holds; the chart
 * type follows the fields (line for time, bars for categories, dots for two numbers). Earlier views are kept in a
 * short history. The optional AI box only proposes a field mapping; figures are never generated.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Wand2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { suggestEncoding } from "@/lib/explore/suggest.functions";
import { aggregate, inferType, pivot, recommend, type Encoding, type Field, type Raw } from "./encode";

export type ExploreColumn<T> = { key: string; label: string; value: (row: T) => Raw };

const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function ChartExplorer<T>({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: readonly ExploreColumn<T>[];
  rows: readonly T[];
}) {
  const table = useMemo(
    () => rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.value(r)])) as Record<string, Raw>),
    [rows, columns],
  );
  const fields: Field[] = useMemo(
    () => columns.map((c) => ({ key: c.key, label: c.label, type: inferType(table.map((r) => r[c.key]), c.label) })),
    [columns, table],
  );
  const firstNum = fields.find((f) => f.type === "quantitative");
  const firstAxis = fields.find((f) => f.type !== "quantitative") ?? fields[0];
  const [enc, setEnc] = useState<Encoding>({ x: firstAxis?.key, y: firstNum?.key });
  const [history, setHistory] = useState<Encoding[]>([]);
  const [prompt, setPrompt] = useState("");
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggest = useServerFn(suggestEncoding);

  const apply = (next: Encoding) => {
    setHistory((h) => [enc, ...h.filter((e) => JSON.stringify(e) !== JSON.stringify(enc))].slice(0, 6));
    setEnc(next);
  };
  const kind = recommend(fields, enc);
  const { points, skipped, series } = aggregate(table, enc, kind);
  const wide = pivot(points, kind);
  const label = (k?: string) => fields.find((f) => f.key === k)?.label ?? "—";
  const shown = series.slice(0, 5);

  const askAi = async () => {
    setBusy(true);
    setAiMsg(null);
    try {
      const r = await suggest({ data: { prompt, fields } });
      if (r.ok) {
        apply({ x: r.x, y: r.y, color: r.color });
        setAiMsg(`AI-suggested mapping: ${label(r.x)} by ${label(r.y)}${r.color ? `, coloured by ${label(r.color)}` : ""}.`);
      } else setAiMsg(r.message);
    } catch {
      setAiMsg("The suggestion could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const Shelf = ({ slot, name, numeric }: { slot: keyof Encoding; name: string; numeric?: boolean }) => (
    <label className="flex flex-col gap-1 text-meta text-muted-foreground">
      {name}
      <select
        className="h-8 rounded-md border border-input bg-surface px-2 text-body text-foreground"
        value={enc[slot] ?? ""}
        onChange={(e) => apply({ ...enc, [slot]: e.target.value || undefined })}
      >
        <option value="">{slot === "color" ? "None" : "Choose a field"}</option>
        {fields
          .filter((f) => (numeric ? f.type === "quantitative" : slot === "color" ? f.type === "nominal" : true))
          .map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-meta">
          <Wand2 className="size-3.5" aria-hidden /> Explore
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetTitle className="text-label">Explore: {title}</SheetTitle>
        <SheetDescription className="text-meta">
          Rearrange the figures this chart holds. Nothing new is computed beyond sums.
        </SheetDescription>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Shelf slot="x" name="X axis" />
          <Shelf slot="y" name="Y value" numeric />
          <Shelf slot="color" name="Colour" />
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim().length > 1) void askAi();
          }}
        >
          <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe a view, e.g. totals by state" className="h-8 text-body" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy} className="h-8 gap-1">
            <Sparkles className="size-3.5" aria-hidden /> {busy ? "Thinking" : "Suggest"}
          </Button>
        </form>
        {aiMsg ? <p className="mt-1 text-meta text-muted-foreground">{aiMsg}</p> : null}

        <div className="mt-4 h-72 rounded-md border border-border p-2">
          {kind === "none" || !points.length ? (
            <p className="flex h-full items-center justify-center text-meta text-muted-foreground">
              Pick an X field and a numeric Y value.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {kind === "line" ? (
                <LineChart data={wide}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="x" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={56} />
                  <Tooltip />
                  {shown.map((s, i) => (
                    <Line key={s} dataKey={s} stroke={SLOTS[i]} dot={false} strokeWidth={2} connectNulls={false} />
                  ))}
                </LineChart>
              ) : kind === "bar" ? (
                <BarChart data={wide} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis type="category" dataKey="x" width={120} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip />
                  {shown.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={SLOTS[i]} />
                  ))}
                </BarChart>
              ) : (
                <ScatterChart>
                  <CartesianGrid stroke="var(--border)" />
                  <XAxis type="number" dataKey="x" name={label(enc.x)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis type="number" dataKey="y" name={label(enc.y)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip />
                  <Scatter data={points} fill={SLOTS[0]} />
                </ScatterChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
        <p className="mt-1 text-meta text-muted-foreground">
          {kind === "none" ? "" : `${kind === "line" ? "Line" : kind === "bar" ? "Bars (top 25)" : "Dots"} · ${label(enc.y)} by ${label(enc.x)}`}
          {series.length > 5 ? ` · first 5 of ${series.length} colour groups` : ""}
          {skipped ? ` · ${skipped.toLocaleString("en-US")} rows not recorded, left out` : ""}
        </p>

        {history.length ? (
          <div className="mt-4">
            <p className="text-meta font-medium text-muted-foreground">Earlier views</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => apply(h)}
                  className="rounded-md border border-border px-2 py-1 text-meta hover:bg-accent"
                >
                  {label(h.y)} by {label(h.x)}
                  {h.color ? ` · ${label(h.color)}` : ""}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
