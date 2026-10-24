import { useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  Loader2,
  Maximize2,
  MessageCircle,
  Mic,
  Minimize2,
  Minus,
  Paperclip,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type AssistantAttachment,
} from "@/lib/assistant/protocol";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { ASK_EVENT, type AskDetail } from "./askAssistant";
import { CitationCheckLine } from "./CitationCheck";
import { citationMarks } from "./citationStatus";
import { collectPageContext, suggestionsFor } from "./pageContext";
import { useAssistantChat, type ChatMessage } from "./useAssistantChat";
import { useDictation } from "./useDictation";

type Mode = "closed" | "open" | "collapsed";
type Box = { x: number; y: number };
const SIZE = { normal: { w: 400, h: 620 }, wide: { w: 660, h: 760 } };
const POS_KEY = "assistant:position:v1";
const MODE_KEY = "assistant:mode:v1";

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // per-viewer convenience only
  }
}

async function toAttachment(file: File): Promise<AssistantAttachment | string> {
  const type = (file.type ||
    (file.name.endsWith(".md")
      ? "text/markdown"
      : file.name.endsWith(".csv")
        ? "text/csv"
        : "")) as AssistantAttachment["type"];
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(type))
    return `${file.name}: images, PDFs and text files only`;
  if (file.size > MAX_ATTACHMENT_BYTES)
    return `${file.name}: larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000)
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return { name: file.name.slice(0, 200), type, data: btoa(binary) };
}

function Steps({ m }: { m: ChatMessage }) {
  const [open, setOpen] = useState(false);
  if (!m.steps.length && !m.notes.length) return null;
  const running = m.steps.filter((s) => s.state === "running");
  const current = running.at(-1) ?? m.steps.at(-1);
  const failed = m.steps.filter((s) => s.state === "failed").length;
  return (
    <div className="mb-1.5 text-[11.5px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 rounded px-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {m.status === "streaming" && running.length ? (
          <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        ) : (
          <ChevronRight
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        )}
        <span className="truncate">
          {m.status === "streaming" && current
            ? `${current.label}${current.detail ? ` · ${current.detail}` : ""}`
            : `${m.steps.length} step${m.steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} could not complete` : ""}`}
        </span>
      </button>
      {open ? (
        <ol className="m-0 mt-1 list-none space-y-0.5 border-l border-border pl-2.5">
          {m.notes.map((note, i) => (
            <li key={`n${i}`} className="italic">
              {note.length > 220 ? `${note.slice(0, 220)}…` : note}
            </li>
          ))}
          {m.steps.map((s) => (
            <li key={s.id} className={cn(s.state === "failed" && "text-destructive")}>
              {s.label}
              {s.detail ? <span className="text-muted-foreground"> · {s.detail}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Sources({ m }: { m: ChatMessage }) {
  const router = useRouter();
  if (!m.sources.length || m.status !== "done") return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {m.sources.slice(0, 8).map((s) =>
        s.internal ? (
          <a
            key={s.url}
            href={s.url}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              router.history.push(s.url);
            }}
            className="max-w-[14rem] truncate rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title={s.title}
          >
            {s.title}
          </a>
        ) : (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="max-w-[14rem] truncate rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title={`${s.title} · ${s.url}`}
          >
            {(() => {
              try {
                return new URL(s.url).hostname.replace(/^www\./, "");
              } catch {
                return s.title;
              }
            })()}
          </a>
        ),
      )}
    </div>
  );
}

function Message({ m }: { m: ChatMessage }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-[13px] leading-relaxed">
          <p className="m-0 whitespace-pre-wrap break-words">{m.display ?? m.content}</p>
          {m.attachments.length ? (
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              {m.attachments.map((a) => a.name).join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    );
  return (
    <div>
      <Steps m={m} />
      {m.status === "error" ? (
        <p className="m-0 flex items-start gap-1.5 text-[13px] text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {m.content}
        </p>
      ) : m.content ? (
        <AssistantMarkdown text={m.content} marks={citationMarks(m.citationCheck)} />
      ) : m.status === "streaming" && !m.steps.length ? (
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Reading the page
        </p>
      ) : null}
      {m.status === "stopped" ? (
        <p className="m-0 mt-1 text-[11px] text-muted-foreground">Stopped.</p>
      ) : null}
      {m.status === "done" && m.citationCheck ? (
        <CitationCheckLine check={m.citationCheck} />
      ) : null}
      <Sources m={m} />
    </div>
  );
}

/** Ask-AI panel: floats above every page, can be dragged, widened, collapsed or closed, and knows the page it is opened on. */
export function AssistantPanel() {
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("closed");
  const [wide, setWide] = useState(false);
  const [pos, setPos] = useState<Box | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<AssistantAttachment[]>([]);
  const root = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const dictationBase = useRef("");
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { messages, busy, send, stop, reset } = useAssistantChat();
  const dictation = useDictation((text, final) => {
    setDraft(`${dictationBase.current}${dictationBase.current && text ? " " : ""}${text}`);
    if (final) dictationBase.current = "";
  });
  const size = wide ? SIZE.wide : SIZE.normal;

  useEffect(() => {
    setMounted(true);
    setPos(readStore<Box | null>(POS_KEY, null));
    setMode(readStore<Mode>(MODE_KEY, "closed"));
  }, []);
  useEffect(() => writeStore(MODE_KEY, mode), [mode]);

  const clamp = useCallback(
    (p: Box): Box => {
      const w = Math.min(size.w, window.innerWidth - 16);
      const h = Math.min(size.h, window.innerHeight - 16);
      return {
        x: Math.min(Math.max(8, p.x), window.innerWidth - w - 8),
        y: Math.min(Math.max(8, p.y), window.innerHeight - (mode === "collapsed" ? 48 : h) - 8),
      };
    },
    [size.w, size.h, mode],
  );
  const place = pos ? clamp(pos) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setMode((m) => (m === "open" ? "closed" : "open"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (mode === "open") setTimeout(() => input.current?.focus(), 30);
  }, [mode]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages]);

  const drag = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent) => setPos(clamp({ x: ev.clientX - dx, y: ev.clientY - dy }));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      writeStore(POS_KEY, clamp({ x: ev.clientX - dx, y: ev.clientY - dy }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const submit = (text = draft, label?: string) => {
    if (!text.trim() || busy) return;
    if (dictation.listening) dictation.stop();
    void send(text, files, collectPageContext(root.current), label);
    setDraft("");
    setFiles([]);
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<AskDetail>).detail;
      if (!detail || typeof detail.question !== "string" || !detail.question.trim()) return;
      setMode("open");
      setTimeout(() => submitRef.current(detail.question, detail.label), 60);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  const attach = async (picked: FileList | null) => {
    if (!picked) return;
    const room = MAX_ATTACHMENTS - files.length;
    const results = await Promise.all([...picked].slice(0, room).map(toAttachment));
    const ok = results.filter((r): r is AssistantAttachment => typeof r !== "string");
    for (const r of results) if (typeof r === "string") toast.error(r);
    if (picked.length > room) toast.error(`Up to ${MAX_ATTACHMENTS} files per question`);
    setFiles((f) => [...f, ...ok]);
  };

  if (!mounted) return null;
  const style = place ? { left: place.x, top: place.y } : { right: 16, bottom: 16 };

  // A compact round icon button. At 32 px and 8 px from the right edge it covers only the page gutter and a card's
  // 16 px padding, never the text inside a card (cards pad their text at least 16 px from the content edge, which
  // sits 24 px from the viewport edge); the page container pads its bottom so the last content scrolls clear of it.
  // On a phone it grows to the 40 px touch size. The name, Ctrl+J and keyboard focus are unchanged.
  const launcher = (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setMode("open")}
            className="fixed bottom-3 right-3 z-50 grid size-10 place-items-center rounded-full border border-border bg-surface text-foreground shadow-md transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:right-2 md:size-8 print:hidden"
            aria-label="Open the research assistant (Ctrl+J)"
            data-assistant-launcher
          >
            <MessageCircle className="size-4 text-primary" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Ask AI about this page · Ctrl+J</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
  if (mode === "closed") return createPortal(launcher, document.body);

  const headerButton =
    "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  const panel = (
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      aria-label="Research assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape") setMode("collapsed");
      }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl print:hidden"
      style={{
        ...style,
        width: `min(${size.w}px, calc(100vw - 16px))`,
        height: mode === "collapsed" ? undefined : `min(${size.h}px, calc(100vh - 16px))`,
      }}
    >
      <header
        onPointerDown={drag}
        className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-border/70 px-3 py-2 active:cursor-grabbing"
      >
        <h2 className="m-0 flex items-center gap-1.5 text-[14px] font-semibold">
          Research assistant
          <span className="rounded border border-border px-1 py-px text-[10px] font-medium text-muted-foreground">
            Beta
          </span>
        </h2>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className={headerButton}
            onClick={reset}
            aria-label="New conversation"
            title="New conversation"
          >
            <SquarePen className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => setWide((w) => !w)}
            aria-label={wide ? "Narrower" : "Wider"}
            title={wide ? "Narrower" : "Wider"}
          >
            {wide ? (
              <Minimize2 className="size-3.5" aria-hidden />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => setMode((m) => (m === "collapsed" ? "open" : "collapsed"))}
            aria-label={mode === "collapsed" ? "Expand assistant" : "Collapse assistant"}
            title={mode === "collapsed" ? "Expand assistant" : "Collapse assistant"}
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => setMode("closed")}
            aria-label="Close"
            title="Close (Ctrl+J)"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>
      {mode === "collapsed" ? null : (
        <>
          <div ref={list} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length ? (
              messages.map((m) => <Message key={m.id} m={m} />)
            ) : (
              <div>
                <p className="m-0 text-[15px] font-medium">Hi</p>
                <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                  I read this page, the research corpus and anything you attach, and I can search
                  the web and case law.
                </p>
                <p className="m-0 mt-5 text-[12px] font-medium text-muted-foreground">Try asking</p>
                <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                  {suggestionsFor(path).map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => submit(s)}
                        className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left text-[13px] text-foreground/85 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <ChevronRight
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="px-3 pb-2 pt-1">
            <div className="rounded-lg border border-border bg-background focus-within:border-ring">
              {files.length ? (
                <div className="flex flex-wrap gap-1 px-2 pt-2">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="flex max-w-[12rem] items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
                    >
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((all) => all.filter((_, k) => k !== i))}
                        aria-label={`Remove ${f.name}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <label htmlFor="assistant-input" className="sr-only">
                Ask about this page
              </label>
              <textarea
                id="assistant-input"
                ref={input}
                value={draft}
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={dictation.listening ? "Listening…" : "Ask about this page"}
                className="block max-h-40 min-h-[2.75rem] w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  accept={[...ATTACHMENT_TYPES, ".md", ".csv"].join(",")}
                  onChange={(e) => {
                    void attach(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={files.length >= MAX_ATTACHMENTS}
                  className={headerButton}
                  aria-label="Attach images, PDFs or text files"
                  title="Attach images, PDFs or text files"
                >
                  <Paperclip className="size-4" aria-hidden />
                </button>
                {dictation.supported ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (dictation.listening) dictation.stop();
                      else {
                        dictationBase.current = draft.trim();
                        void dictation.start();
                      }
                    }}
                    className={cn(
                      headerButton,
                      dictation.listening &&
                        "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
                    )}
                    aria-pressed={dictation.listening}
                    aria-label={dictation.listening ? "Stop dictation" : "Dictate"}
                    title={dictation.listening ? "Stop dictation" : "Dictate"}
                  >
                    {dictation.working ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Mic className="size-4" aria-hidden />
                    )}
                  </button>
                ) : null}
                {dictation.error ? (
                  <span className="truncate text-[11px] text-destructive">{dictation.error}</span>
                ) : null}
                {busy ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="ml-auto grid size-8 place-items-center rounded-full bg-foreground text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label="Stop"
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => submit()}
                    disabled={!draft.trim()}
                    className="ml-auto grid size-8 place-items-center rounded-full bg-foreground text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"
                    aria-label="Send"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
            <p className="m-0 mt-1.5 text-center text-[11px] text-muted-foreground">
              Replies can be wrong. Check before acting.
            </p>
          </div>
        </>
      )}
    </div>
  );
  return createPortal(panel, document.body);
}
