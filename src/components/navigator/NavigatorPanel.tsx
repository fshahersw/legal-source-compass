/**
 * The navigator panel: give the agent a task and watch it work the site. Docked bottom-left so the page it drives
 * stays visible; it shows each step as it happens (pages opened, controls pressed, charts read, searches run), the
 * trail of pages visited, and the answer with links. Stop at any time; minimise it while it works.
 */
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  BookOpen,
  Bot,
  CircleAlert,
  Compass,
  Eye,
  Keyboard,
  Loader2,
  Minus,
  MousePointer2,
  Search,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AssistantMarkdown, InternalLink } from "@/components/assistant/AssistantMarkdown";
import type { NavigatorStep } from "@/lib/navigator/protocol";
import {
  NAVIGATOR_OPEN_EVENT,
  navigatorSuggestions,
  type NavigatorOpenDetail,
} from "./navigatorEvents";
import { useNavigator, type NavMessage } from "./useNavigator";

type Mode = "closed" | "open" | "mini";

function StepIcon({ step }: { step: NavigatorStep }) {
  const cls = "size-3.5 shrink-0";
  if (step.state === "running")
    return <Loader2 className={cn(cls, "animate-spin text-primary")} aria-hidden />;
  if (step.state === "failed")
    return <CircleAlert className={cn(cls, "text-destructive")} aria-hidden />;
  const l = step.label.toLowerCase();
  if (l.startsWith("opened") || l.startsWith("opening"))
    return <Compass className={cn(cls, "text-primary")} aria-hidden />;
  if (l.startsWith("clicked") || l.startsWith("pointed"))
    return <MousePointer2 className={cn(cls, "text-primary")} aria-hidden />;
  if (l.startsWith("typed")) return <Keyboard className={cn(cls, "text-primary")} aria-hidden />;
  if (l.startsWith("read")) return <Eye className={cn(cls, "text-primary")} aria-hidden />;
  if (l.includes("site map")) return <BookOpen className={cn(cls, "text-primary")} aria-hidden />;
  return <Search className={cn(cls, "text-primary")} aria-hidden />;
}

function Steps({ m }: { m: NavMessage }) {
  if (!m.steps.length && !m.notes.length) return null;
  return (
    <ol className="space-y-1 border-l border-border pl-3">
      {m.notes.map((n, i) => (
        <li key={`n${i}`} className="text-[12px] italic leading-4 text-muted-foreground">
          {n}
        </li>
      ))}
      {m.steps.map((s) => (
        <li key={s.id} className="flex items-start gap-1.5 text-[12px] leading-4">
          <StepIcon step={s} />
          <span className="min-w-0">
            <span className={cn(s.state === "failed" && "text-destructive")}>{s.label}</span>
            {s.detail && !s.label.includes(s.detail) ? (
              <span className="text-muted-foreground"> · {s.detail}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Trail({ m }: { m: NavMessage }) {
  if (m.trail.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      <span className="text-muted-foreground">Trail:</span>
      {m.trail.map((p, i) => (
        <span key={`${p}-${i}`} className="flex items-center gap-1">
          {i ? <span className="text-muted-foreground">→</span> : null}
          <InternalLink
            href={p}
            className="max-w-[14rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono hover:underline"
          >
            {p}
          </InternalLink>
        </span>
      ))}
    </div>
  );
}

function Message({ m }: { m: NavMessage }) {
  if (m.role === "user")
    return (
      <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-[13px] text-primary-foreground">
        {m.content}
      </div>
    );
  return (
    <div className="space-y-2">
      <Steps m={m} />
      <Trail m={m} />
      {m.status === "running" && !m.content ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Working…
        </p>
      ) : m.content ? (
        <div
          className={cn(
            "text-[13px] leading-5",
            m.status === "error" && "text-destructive",
            m.status === "running" && "text-muted-foreground",
          )}
        >
          {m.status === "running" ? (
            <p className="italic">{m.content}</p>
          ) : (
            <AssistantMarkdown text={m.content} />
          )}
        </div>
      ) : null}
      {m.status === "done" && m.sources.length ? (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {m.sources.slice(0, 6).map((s) => (
            <li key={s.url} className="truncate">
              {s.internal ? (
                <InternalLink href={s.url} className="hover:underline">
                  {s.title}
                </InternalLink>
              ) : (
                <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {s.title}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {m.status === "stopped" ? (
        <p className="text-[11px] text-muted-foreground">Stopped.</p>
      ) : null}
    </div>
  );
}

export function NavigatorPanel() {
  const [mode, setMode] = useState<Mode>("closed");
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { messages, busy, run, stop, clear } = useNavigator(panelRef);
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onOpen = (e: Event) => {
      const task = (e as CustomEvent<NavigatorOpenDetail>).detail?.task;
      setMode("open");
      if (task) void run(task);
    };
    window.addEventListener(NAVIGATOR_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(NAVIGATOR_OPEN_EVENT, onOpen);
  }, [run]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (mode === "closed") return null;
  const last = messages.at(-1);
  const current = last?.role === "assistant" ? last.steps.at(-1) : undefined;
  const submit = () => {
    const t = draft.trim();
    if (!t || busy) return;
    setDraft("");
    void run(t);
  };

  if (mode === "mini")
    return (
      <div
        ref={panelRef}
        data-navigator-panel=""
        className="fixed bottom-4 left-4 z-50 flex max-w-[min(26rem,calc(100vw-2rem))] items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-3 pr-1.5 shadow-2xl print:hidden"
      >
        <Bot className="size-4 shrink-0 text-primary" aria-hidden />
        <button
          type="button"
          className="min-w-0 truncate text-left text-[12px]"
          onClick={() => setMode("open")}
        >
          {busy ? (current?.label ?? "Working…") : "Navigator"}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop the navigator"
            className="inline-flex size-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <Square className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>
    );

  return (
    <div
      ref={panelRef}
      data-navigator-panel=""
      role="dialog"
      aria-label="Navigator"
      className="fixed bottom-4 left-4 z-50 flex max-h-[min(72vh,44rem)] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl print:hidden"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="size-4 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-4">Navigator</p>
          <p className="truncate text-[11px] leading-4 text-muted-foreground">
            {busy
              ? (current?.label ?? "Working…")
              : "Works the site for you: opens pages, reads charts, uses controls"}
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          disabled={busy || !messages.length}
          aria-label="New task"
          title="New task"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <SquarePen className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setMode("mini")}
          aria-label="Minimise"
          title="Minimise"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            if (busy) stop();
            setMode("closed");
          }}
          aria-label="Close the navigator"
          title="Close"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-live="polite"
      >
        {messages.length ? (
          messages.map((m) => <Message key={m.id} m={m} />)
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-muted-foreground">
              Give it a task. It opens the pages it needs, reads their charts and tables, uses tabs,
              toggles and search boxes, and answers with links to every page it used. It can only
              read: it never downloads, signs in, deletes or leaves the site.
            </p>
            {navigatorSuggestions(path).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void run(s)}
                className="block w-full rounded-md border border-border px-2.5 py-1.5 text-left text-[12px] hover:bg-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="flex items-end gap-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="What should it do?"
          aria-label="Task for the navigator"
          className="min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop"
            className="inline-flex size-9 items-center justify-center rounded-md bg-destructive text-destructive-foreground"
          >
            <Square className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Start"
            disabled={!draft.trim()}
            className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
