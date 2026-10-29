/**
 * The agent folder in the library: everything the navigator made (reports from scheduled tasks, documents, images,
 * Python figures, notes and data), what it remembers about the user's work, its scheduled tasks and its recent tasks.
 * Files open in a side viewer; memories can be edited or removed; schedules can be paused, resumed, run now or removed.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot,
  CalendarClock,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { openNavigator } from "@/components/navigator/navigatorEvents";
import { AGENT_FOLDER_EVENT } from "@/components/navigator/useNavigator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { describeSchedule } from "@/lib/agent/schedule";
import type { FileKind, Memory, MemoryKind, Schedule } from "@/lib/agent/store.types";
import { agentApi, type FolderFile } from "./agentApi";

const FILTERS: { id: string; label: string; kinds: FileKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "reports", label: "Reports", kinds: ["report"] },
  { id: "documents", label: "Documents", kinds: ["document"] },
  { id: "images", label: "Images & figures", kinds: ["image", "figure"] },
  { id: "notes", label: "Notes & data", kinds: ["note", "data"] },
];

const KIND_LABEL: Record<FileKind, string> = {
  report: "Report",
  document: "Document",
  image: "Image",
  figure: "Figure",
  note: "Note",
  data: "Data",
};

const MEMORY_LABEL: Record<MemoryKind, string> = {
  preference: "Preferences",
  fact: "Facts about your work",
  procedure: "Procedures it learned",
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Not recorded"
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};
const fmtBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : `${n} B`;
const typeLabel = (mime: string) =>
  mime.includes("wordprocessingml")
    ? "Word"
    : mime === "application/pdf"
      ? "PDF"
      : mime === "text/html"
        ? "Web page"
        : mime === "text/csv"
          ? "CSV"
          : mime === "application/json"
            ? "JSON"
            : mime.startsWith("image/")
              ? "PNG"
              : "Markdown";

const isImage = (f: FolderFile) => f.mime.startsWith("image/");

function FileIcon({ file, className = "size-5" }: { file: FolderFile; className?: string }) {
  if (isImage(file)) return <FileImage className={className} aria-hidden />;
  if (file.kind === "data" || file.mime === "text/csv")
    return <FileSpreadsheet className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

function useFolderRefresh() {
  const qc = useQueryClient();
  useEffect(() => {
    const on = () => {
      void qc.invalidateQueries({ queryKey: ["agent-folder"] });
    };
    window.addEventListener(AGENT_FOLDER_EVENT, on);
    return () => window.removeEventListener(AGENT_FOLDER_EVENT, on);
  }, [qc]);
  return () => void qc.invalidateQueries({ queryKey: ["agent-folder"] });
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xs">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function FileCardView({ file, onOpen }: { file: FolderFile; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-xs transition hover:border-border-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-muted/50">
        {isImage(file) && file.url ? (
          <img
            src={file.url}
            alt=""
            loading="lazy"
            className={`h-full w-full transition group-hover:scale-[1.02] ${file.kind === "figure" ? "bg-white object-contain p-1.5" : "object-cover"}`}
          />
        ) : file.snippet ? (
          <p className="line-clamp-6 h-full w-full whitespace-pre-line px-3 py-2.5 font-mono text-[10.5px] leading-snug text-muted-foreground">
            {file.snippet}
          </p>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <FileIcon file={file} className="size-8" />
            <span className="text-[11px] font-medium">{typeLabel(file.mime)}</span>
          </div>
        )}
        {file.unread ? (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            New
          </span>
        ) : null}
        {file.pinned ? (
          <Pin className="absolute right-2 top-2 size-3.5 text-foreground/70" aria-label="Pinned" />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
        <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
          {file.title}
        </div>
        <div className="mt-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <FileIcon file={file} className="size-3.5" />
          <span>
            {KIND_LABEL[file.kind]} · {typeLabel(file.mime)} · {fmtDate(file.created_at)}
          </span>
        </div>
      </div>
    </button>
  );
}

function CsvPreview({ text }: { text: string }) {
  const rows = useMemo(() => {
    const out: string[][] = [];
    for (const line of text.split(/\r?\n/).slice(0, 201)) {
      if (!line.trim()) continue;
      const cells: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (q) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") {
          cells.push(cur);
          cur = "";
        } else cur += ch;
      }
      cells.push(cur);
      out.push(cells);
    }
    return out;
  }, [text]);
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">The file is empty.</p>;
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-muted/60">
          <tr>
            {rows[0]!.map((c, i) => (
              <th key={i} className="px-2.5 py-1.5 text-left font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((r, k) => (
            <tr key={k} className="border-t border-border">
              {r.map((c, i) => (
                <td
                  key={i}
                  className={`px-2.5 py-1 ${/^[-\d,.%$]+$/.test(c) ? "text-right tabular-nums" : ""}`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileViewer({
  file,
  onClose,
  onChanged,
}: {
  file: FolderFile | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState("");
  const textual = !!file && /^(text\/|application\/json)/.test(file.mime);

  useEffect(() => {
    setText(null);
    setError(null);
    setConfirm(false);
    setTitle(file?.title ?? "");
    if (!file || !file.url || !textual) return;
    let live = true;
    fetch(file.url)
      .then(async (r) => {
        if (!r.ok)
          throw new Error("The file could not be opened. Reload the folder and try again.");
        const t = await r.text();
        if (live) setText(t);
      })
      .catch(
        (e: unknown) =>
          live && setError(e instanceof Error ? e.message : "The file could not be opened."),
      );
    if (file.unread)
      void agentApi.updateFile(file.id, { unread: false }).then(onChanged, () => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  if (!file) return null;
  const download = file.url ? `${file.url}&download=1` : null;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle className="pr-8 text-[16px] leading-snug">{file.title}</SheetTitle>
          <SheetDescription className="text-[12px]">
            {KIND_LABEL[file.kind]} · {typeLabel(file.mime)} · {fmtBytes(file.bytes)} ·{" "}
            {fmtDate(file.created_at)}
            {file.source ? ` · from ${file.source}` : ""}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            {download ? (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]" asChild>
                <a href={download}>
                  <Download className="size-3.5" /> Download
                </a>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12px]"
              onClick={() =>
                act(
                  () => agentApi.updateFile(file.id, { pinned: !file.pinned }),
                  file.pinned ? "Unpinned" : "Pinned",
                )
              }
            >
              {file.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {file.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-[12px]"
              onClick={() =>
                openNavigator(
                  `Open the file "${file.title}" (id ${file.id}) from my agent folder and ${file.kind === "report" ? "tell me what needs my attention in it." : "summarize it."}`,
                )
              }
            >
              <Bot className="size-3.5" /> Ask the agent
            </Button>
            {confirm ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() =>
                  act(async () => {
                    await agentApi.deleteFile(file.id);
                    onClose();
                  }, "Deleted")
                }
              >
                <Trash2 className="size-3.5" /> Confirm
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setConfirm(true)}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
          </div>
          <form
            className="flex items-center gap-1.5 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim() && title.trim() !== file.title)
                void act(() => agentApi.updateFile(file.id, { title: title.trim() }), "Renamed");
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="File title"
              className="h-8 text-[12.5px]"
            />
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              className="h-8 text-[12px]"
              disabled={title.trim() === file.title}
            >
              Rename
            </Button>
          </form>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {error ? (
            <p className="text-[13px] text-destructive">{error}</p>
          ) : isImage(file) && file.url ? (
            <img
              src={file.url}
              alt={file.title}
              className="w-full rounded-lg border border-border"
            />
          ) : file.mime === "application/pdf" && file.url ? (
            <iframe
              title={file.title}
              src={file.url}
              className="h-[75vh] w-full rounded-lg border border-border"
            />
          ) : file.mime.includes("wordprocessingml") ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
              <FileText className="mx-auto mb-2 size-8" aria-hidden />
              Word documents open in Word or Google Docs. Use Download.
            </div>
          ) : !textual ? (
            <p className="text-[13px] text-muted-foreground">
              No preview for this file type. Use Download.
            </p>
          ) : text === null ? (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Opening…
            </div>
          ) : file.mime === "text/html" ? (
            <iframe
              title={file.title}
              sandbox=""
              srcDoc={text}
              className="h-[75vh] w-full rounded-lg border border-border bg-white"
            />
          ) : file.mime === "text/csv" ? (
            <CsvPreview text={text} />
          ) : file.mime === "application/json" ? (
            <pre className="overflow-auto rounded-lg bg-muted/50 p-3 text-[12px]">
              {text.slice(0, 200_000)}
            </pre>
          ) : (
            <div className="prose-sm max-w-none text-[13.5px] leading-relaxed">
              <AssistantMarkdown text={text.slice(0, 200_000)} />
            </div>
          )}
          {file.kind === "image" && typeof file.meta["prompt"] === "string" ? (
            <p className="mt-3 text-[11.5px] text-muted-foreground">
              AI-generated illustration. Prompt: {String(file.meta["prompt"]).slice(0, 400)}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ScheduleRow({ s, onChanged }: { s: Schedule; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const navigate = useNavigate();
  const act = async (action: "pause" | "resume" | "run" | "delete") => {
    setBusy(action);
    try {
      const out = await agentApi.scheduleAction(s.id, action);
      if (action === "run") {
        const file = out["file"] as { id?: string } | null;
        toast.success(file?.id ? "Ran the task and saved its report." : "Ran the task.");
        if (file?.id)
          void navigate({ to: "/sources/library", search: { view: "agent", file: file.id } });
      } else
        toast.success(action === "delete" ? "Removed" : action === "pause" ? "Paused" : "Resumed");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };
  const failed = s.last_status?.startsWith("failed");
  return (
    <li className="rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="flex items-start gap-3">
        <CalendarClock
          className={`mt-0.5 size-4 shrink-0 ${s.active ? "text-primary" : "text-muted-foreground"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13.5px] font-semibold text-foreground">{s.title}</span>
            <span className="text-[11.5px] text-muted-foreground">
              {describeSchedule({
                cadence: s.cadence,
                at: s.at_time,
                weekday: s.weekday,
                monthday: s.monthday,
                tz: s.tz,
              })}
              {s.active ? "" : " · paused"}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{s.task}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
            <span>Next: {s.active && s.next_run_at ? fmtDate(s.next_run_at) : "None"}</span>
            <span>
              Last: {s.last_run_at ? fmtDate(s.last_run_at) : "Not run yet"}
              {s.last_status ? (
                <span className={failed ? "text-destructive" : ""}>
                  {" "}
                  · {failed ? s.last_status : "ok"}
                </span>
              ) : null}
            </span>
            <span>Runs: {s.runs}</span>
            {s.last_file ? (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() =>
                  void navigate({
                    to: "/sources/library",
                    search: { view: "agent", file: s.last_file! },
                  })
                }
              >
                Latest report
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!!busy}
            onClick={() => act("run")}
            aria-label="Run now"
          >
            {busy === "run" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RotateCw className="size-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={!!busy}
            onClick={() => act(s.active ? "pause" : "resume")}
            aria-label={s.active ? "Pause" : "Resume"}
          >
            {s.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          {confirm ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-[11.5px]"
              disabled={!!busy}
              onClick={() => act("delete")}
            >
              Confirm
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setConfirm(true)}
              aria-label="Delete schedule"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {busy === "run" ? (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Running now. This can take a minute or two.
        </p>
      ) : null}
    </li>
  );
}

function MemoryItem({ m, onChanged }: { m: Memory; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [body, setBody] = useState(m.body);
  const [confirm, setConfirm] = useState(false);
  const save = async () => {
    try {
      await agentApi.saveMemory({
        id: m.id,
        kind: m.kind,
        title: title.trim(),
        body: body.trim(),
        tags: m.tags,
      });
      setEdit(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  };
  const remove = async () => {
    try {
      await agentApi.deleteMemory(m.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  };
  if (edit)
    return (
      <li className="space-y-1.5 rounded-lg border border-border bg-card p-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-8 text-[12.5px]"
          aria-label="Title"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="text-[12.5px]"
          aria-label="Memory"
        />
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[12px]"
            onClick={() => setEdit(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px]"
            onClick={save}
            disabled={!title.trim() || !body.trim()}
          >
            Save
          </Button>
        </div>
      </li>
    );
  return (
    <li className="group rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">{m.title}</div>
          <p className="mt-0.5 whitespace-pre-line text-[12.5px] text-muted-foreground">{m.body}</p>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Used {m.uses} {m.uses === 1 ? "time" : "times"} · updated {fmtDate(m.updated_at)}
            {m.tags.length ? ` · ${m.tags.join(", ")}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-70 group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11.5px]"
            onClick={() => setEdit(true)}
          >
            Edit
          </Button>
          {confirm ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-[11.5px]"
              onClick={remove}
            >
              Confirm
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={() => setConfirm(true)}
              aria-label="Forget"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function AddMemory({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  if (!open)
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 text-[12px]"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" /> Add a memory
      </Button>
    );
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
      <div className="flex gap-1 text-[12px]">
        {(["preference", "fact", "procedure"] as MemoryKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md px-2 py-1 ${kind === k ? "bg-muted font-semibold" : "text-muted-foreground"}`}
          >
            {k === "preference" ? "Preference" : k === "fact" ? "Fact" : "Procedure"}
          </button>
        ))}
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Short name, e.g. Quarterly figures"
        className="h-8 text-[12.5px]"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="What the agent should remember, e.g. Show adverse-event figures by quarter, not by year."
        className="text-[12.5px]"
      />
      <div className="flex justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[12px]"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 text-[12px]"
          disabled={!title.trim() || !body.trim()}
          onClick={async () => {
            try {
              await agentApi.saveMemory({ kind, title: title.trim(), body: body.trim() });
              setTitle("");
              setBody("");
              setOpen(false);
              onChanged();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "That did not work.");
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function AgentFolder({ fileId }: { fileId?: string | undefined }) {
  const navigate = useNavigate();
  const refresh = useFolderRefresh();
  const [filter, setFilter] = useState("all");
  const files = useQuery({
    queryKey: ["agent-folder", "files"],
    queryFn: () => agentApi.files(null, 120),
    staleTime: 30_000,
    refetchInterval: 10 * 60_000,
  });
  const memory = useQuery({
    queryKey: ["agent-folder", "memory"],
    queryFn: agentApi.memory,
    staleTime: 30_000,
  });
  const schedules = useQuery({
    queryKey: ["agent-folder", "schedules"],
    queryFn: agentApi.schedules,
    staleTime: 30_000,
  });

  const rows = files.data?.rows ?? [];
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const shown = rows
    .filter((f) => !kinds || kinds.includes(f.kind))
    .sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at),
    );
  const selected = fileId ? (rows.find((f) => f.id === fileId) ?? null) : null;
  const memories = memory.data?.memories ?? [];
  const episodes = memory.data?.episodes ?? [];
  const scheduleRows = schedules.data?.schedules ?? [];
  const activeSchedules = scheduleRows.filter((s) => s.active).length;
  const failure = files.error ?? memory.error ?? schedules.error;

  const open = (id: string | undefined) =>
    void navigate({
      to: "/sources/library",
      search: id ? { view: "agent", file: id } : { view: "agent" },
      replace: true,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden /> Agent folder
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            What the agent made for you, what it remembers about your work, and the tasks it runs on
            a schedule. Kept for your account when signed in, otherwise for this browser.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]" onClick={refresh}>
            <RotateCw className="size-3.5" /> Refresh
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => openNavigator()}>
            <Bot className="size-3.5" /> Ask the agent
          </Button>
        </div>
      </div>

      {failure ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          {(failure as Error).message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Files"
          value={files.data ? files.data.total.toLocaleString() : "…"}
          hint="Reports, documents, images, notes"
        />
        <Stat
          label="Unread"
          value={files.data ? files.data.unread.toLocaleString() : "…"}
          hint="New since you last looked"
        />
        <Stat
          label="Memories"
          value={memory.data ? memories.length.toLocaleString() : "…"}
          hint="Preferences, facts, procedures"
        />
        <Stat
          label="Scheduled tasks"
          value={schedules.data ? activeSchedules.toLocaleString() : "…"}
          hint={
            schedules.data
              ? `${scheduleRows.length - activeSchedules} paused or finished`
              : undefined
          }
        />
      </div>

      <section aria-labelledby="agent-files">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="agent-files" className="text-[15px] font-semibold text-foreground">
            Files
          </h3>
          <div className="flex rounded-md border border-border p-0.5 text-[12px]" role="tablist">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded px-2.5 py-1 ${filter === f.id ? "bg-muted font-semibold" : "text-muted-foreground"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {files.isLoading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the folder…
          </div>
        ) : shown.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((f) => (
              <FileCardView key={f.id} file={f} onOpen={() => open(f.id)} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border-strong bg-surface p-6 text-center text-[13px] text-muted-foreground">
            {rows.length
              ? "Nothing of this type yet."
              : "Nothing here yet. Ask the agent for a brief, a Word or PDF document, a chart from Python, an illustration, or a daily check on an MDL, and it saves the result here."}
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {[
                "Write a one-page PDF brief on MDL 3140 with its judge, size over time and defendants.",
                "Every weekday at 8:00, check the product watch for drugs with rising reports and no MDL, and save a short report.",
                "Chart the five largest pending MDLs by pending cases with Python.",
              ].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => openNavigator(t)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-foreground hover:border-border-strong"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="agent-schedules">
          <h3 id="agent-schedules" className="mb-2 text-[15px] font-semibold text-foreground">
            Scheduled tasks
          </h3>
          {scheduleRows.length ? (
            <ul className="space-y-2">
              {scheduleRows.map((s) => (
                <ScheduleRow key={s.id} s={s} onChanged={refresh} />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-[12.5px] text-muted-foreground">
              No scheduled tasks. Ask the agent, for example "every Monday at 7:00, summarize new
              filings in MDL 3094". Runs use the corpus, records, official data and the web, and
              save a report here.
            </p>
          )}
        </section>

        <section aria-labelledby="agent-memory">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="agent-memory" className="text-[15px] font-semibold text-foreground">
              Memory
            </h3>
            <AddMemory onChanged={refresh} />
          </div>
          {memories.length ? (
            <div className="space-y-4">
              {(["preference", "fact", "procedure"] as MemoryKind[]).map((k) => {
                const list = memories.filter((m) => m.kind === k);
                if (!list.length) return null;
                return (
                  <div key={k}>
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {MEMORY_LABEL[k]} · {list.length}
                    </div>
                    <ul className="space-y-1.5">
                      {list.map((m) => (
                        <MemoryItem key={m.id} m={m} onChanged={refresh} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-[12.5px] text-muted-foreground">
              Nothing remembered yet. The agent saves your stated preferences, facts about the
              matters you follow, and the steps that worked for recurring questions. You can add,
              edit or remove any of them.
            </p>
          )}
        </section>
      </div>

      {episodes.length ? (
        <section aria-labelledby="agent-tasks">
          <h3 id="agent-tasks" className="mb-2 text-[15px] font-semibold text-foreground">
            Recent tasks
          </h3>
          <ol className="divide-y divide-border rounded-xl border border-border bg-card">
            {episodes.slice(0, 12).map((e) => (
              <li key={e.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="line-clamp-1 text-[13px] font-medium text-foreground">
                    {e.task}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{fmtDate(e.created_at)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                  {e.summary.replace(/[#*_`>|]/g, "")}
                </p>
                {e.pages.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.pages.slice(0, 6).map((p) => (
                      <a
                        key={p}
                        href={p}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-foreground"
                      >
                        {p.length > 48 ? `${p.slice(0, 48)}…` : p}
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <FileViewer file={selected} onClose={() => open(undefined)} onChanged={refresh} />
    </div>
  );
}
