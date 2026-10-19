import {
  AlignLeft,
  ArrowUpRight,
  CircleAlert,
  Copy,
  Download,
  FileText,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  RotateCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCorpusSession } from "@/lib/auth/access.functions";
import { cn } from "@/lib/utils";
import { AssistantMarkdown } from "@/components/assistant/AssistantMarkdown";
import { askAssistant } from "@/components/assistant/askAssistant";
import {
  SOURCE_EVENT,
  VIEW_LABEL,
  availableViews,
  hostLabel,
  initialView,
  interceptTarget,
  relayUrl,
  sizeLabel,
  type CheckResult,
  type SourceRequest,
  type ViewMode,
} from "./sourceLinks";

type Check =
  | { status: "loading" }
  | { status: "ready"; data: CheckResult }
  | { status: "error"; message: string; code: string; remoteBrowser: boolean; reader: boolean };
type Session =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "live"; id: string; liveUrl: string }
  | { status: "error"; message: string };
type Reader =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; title: string; markdown: string; truncated: boolean }
  | { status: "error"; message: string };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function anchorTitle(anchor: HTMLAnchorElement): string | undefined {
  const text = squash(
    anchor.getAttribute("aria-label") || anchor.title || anchor.innerText || "",
  ).slice(0, 200);
  return text && !/^https?:\/\//i.test(text) ? text : undefined;
}

/**
 * Outside links open here instead of a new tab: framable pages are shown directly, documents through a same-site relay,
 * and pages that refuse framing in a disposable interactive browser (or as extracted text). Every outbound fetch and
 * browser session is made by the server, which only reaches public addresses.
 */
export function SourceViewer() {
  const [mounted, setMounted] = useState(false);
  const [source, setSource] = useState<SourceRequest | null>(null);
  const [check, setCheck] = useState<Check>({ status: "loading" });
  const [view, setView] = useState<ViewMode | null>(null);
  const [session, setSession] = useState<Session>({ status: "idle" });
  const [reader, setReader] = useState<Reader>({ status: "idle" });
  const [docReady, setDocReady] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [wide, setWide] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const liveId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  // The source generation each view last started loading for, so a view is loaded once per source (retried after a failure).
  const browserGen = useRef(-1);
  const readerGen = useRef(-1);

  useEffect(() => setMounted(true), []);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    try {
      const { data } = await supabase.auth.getSession();
      token.current = data.session?.access_token ?? null;
    } catch {
      token.current = null;
    }
    return token.current ? { authorization: `Bearer ${token.current}` } : {};
  }, []);

  /** Ends the hosted browser, if one is running; keepalive lets it finish while the page unloads. */
  const stopSession = useCallback(() => {
    const id = liveId.current;
    liveId.current = null;
    if (!id) return;
    void fetch(`/api/source-browser?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: true,
      headers: token.current ? { authorization: `Bearer ${token.current}` } : {},
    }).catch(() => null);
  }, []);

  const target = check.status === "ready" ? check.data.finalUrl : (source?.url ?? "");

  const startBrowser = useCallback(
    async (url: string, gen: number) => {
      setSession({ status: "starting" });
      try {
        const rect = body.current?.getBoundingClientRect();
        const res = await fetch("/api/source-browser", {
          method: "POST",
          headers: { "content-type": "application/json", ...(await authHeaders()) },
          // The live view letterboxes the remote screen; a screen about a quarter taller than the panel fills it.
          body: JSON.stringify({
            url,
            width: Math.round(rect?.width ?? 1200),
            height: Math.round((rect?.height ?? 720) * 1.25),
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          id?: string;
          liveUrl?: string;
          error?: string;
        } | null;
        if (!res.ok || !data?.id || !data.liveUrl)
          throw new Error(data?.error ?? "The interactive view could not start.");
        if (gen !== generation.current) {
          liveId.current = data.id;
          stopSession();
          return;
        }
        liveId.current = data.id;
        setFrameLoaded(false);
        setSession({ status: "live", id: data.id, liveUrl: data.liveUrl });
      } catch (error) {
        if (gen === generation.current) browserGen.current = -1;
        if (gen === generation.current)
          setSession({
            status: "error",
            message:
              error instanceof Error ? error.message : "The interactive view could not start.",
          });
      }
    },
    [authHeaders, stopSession],
  );

  const loadReader = useCallback(
    async (url: string, gen: number) => {
      setReader({ status: "loading" });
      try {
        const res = await fetch(`/api/source-text?url=${encodeURIComponent(url)}`, {
          headers: await authHeaders(),
        });
        const data = (await res.json().catch(() => null)) as {
          title?: string;
          markdown?: string;
          truncated?: boolean;
          error?: string;
        } | null;
        if (!res.ok || !data?.markdown)
          throw new Error(data?.error ?? "The page text could not be read.");
        if (gen === generation.current)
          setReader({
            status: "ready",
            title: data.title ?? "",
            markdown: data.markdown,
            truncated: !!data.truncated,
          });
      } catch (error) {
        if (gen === generation.current) readerGen.current = -1;
        if (gen === generation.current)
          setReader({
            status: "error",
            message: error instanceof Error ? error.message : "The page text could not be read.",
          });
      }
    },
    [authHeaders],
  );

  const prepareDocument = useCallback(async (gen: number) => {
    // Refresh the short-lived session cookie so the same-site relay can be loaded by a frame (frames cannot send headers).
    await getCorpusSession().catch(() => null);
    if (gen === generation.current) setDocReady(true);
  }, []);

  /** Switches the panel to a view, starting whatever that view needs the first time it is shown for this source. */
  const show = useCallback(
    (mode: ViewMode, url: string) => {
      const gen = generation.current;
      setView(mode);
      setFrameLoaded(false);
      if (mode === "browser" && browserGen.current !== gen) {
        browserGen.current = gen;
        void startBrowser(url, gen);
      } else if (mode === "reader" && readerGen.current !== gen) {
        readerGen.current = gen;
        void loadReader(url, gen);
      } else if (mode === "document") {
        void prepareDocument(gen);
      }
    },
    [loadReader, prepareDocument, startBrowser],
  );

  const open = useCallback(
    (request: SourceRequest) => {
      stopSession();
      generation.current += 1;
      const gen = generation.current;
      if (!panel.current?.contains(document.activeElement))
        returnFocus.current = document.activeElement as HTMLElement | null;
      setSource(request);
      setCheck({ status: "loading" });
      setView(null);
      setSession({ status: "idle" });
      setReader({ status: "idle" });
      setDocReady(false);
      setFrameLoaded(false);
      void (async () => {
        let result: Check;
        try {
          const res = await fetch(`/api/source-check?url=${encodeURIComponent(request.url)}`, {
            headers: await authHeaders(),
          });
          const data = (await res.json().catch(() => null)) as
            (CheckResult & { error?: string; code?: string }) | null;
          result =
            res.ok && data && !data.error
              ? { status: "ready", data }
              : {
                  status: "error",
                  message: data?.error ?? "The address could not be checked.",
                  code:
                    data?.code ??
                    (res.status === 401 || res.status === 403 ? "access" : "unreachable"),
                  remoteBrowser: !!data?.remoteBrowser,
                  reader: !!data?.reader,
                };
        } catch {
          result = {
            status: "error",
            message: "The address could not be checked.",
            code: "unreachable",
            remoteBrowser: false,
            reader: false,
          };
        }
        if (gen !== generation.current) return;
        setCheck(result);
        if (result.status === "ready") show(initialView(result.data), result.data.finalUrl);
        else if (result.code === "unreachable" && result.remoteBrowser)
          show("browser", request.url);
        else if (result.code === "unreachable" && result.reader) show("reader", request.url);
        else setView("blocked");
      })();
    },
    [authHeaders, show, stopSession],
  );

  const close = useCallback(() => {
    stopSession();
    generation.current += 1;
    setSource(null);
    setView(null);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }, [stopSession]);

  // Plain clicks on outside links anywhere in the app open here. Bubble phase, so handlers that already took the click win.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(el instanceof HTMLAnchorElement)) return;
      const url = interceptTarget(el, e, window.location.origin);
      if (!url) return;
      e.preventDefault();
      open({ url, title: anchorTitle(el) });
    };
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<SourceRequest>).detail;
      if (detail && typeof detail.url === "string") {
        const url = interceptTarget(
          { href: detail.url, hasAttribute: () => false, getAttribute: () => null },
          {
            button: 0,
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            defaultPrevented: false,
          },
          window.location.origin,
        );
        if (url) open({ url, title: detail.title });
      }
    };
    const onHide = () => stopSession();
    document.addEventListener("click", onClick);
    window.addEventListener(SOURCE_EVENT, onRequest);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener(SOURCE_EVENT, onRequest);
      window.removeEventListener("pagehide", onHide);
    };
  }, [open, stopSession]);

  useEffect(() => {
    if (source) setTimeout(() => panel.current?.focus({ preventScroll: true }), 30);
  }, [source]);

  if (!mounted || !source) return null;

  const data = check.status === "ready" ? check.data : null;
  const options = data
    ? data
    : {
        kind: "page" as const,
        embeddable: false,
        remoteBrowser:
          check.status === "error" && check.code === "unreachable" && check.remoteBrowser,
        reader: check.status === "error" && check.code === "unreachable" && check.reader,
      };
  const views = check.status === "loading" ? [] : availableViews(options);
  const host = hostLabel(target);
  const title =
    (view === "reader" && reader.status === "ready" && reader.title) ||
    source.title ||
    data?.fileName ||
    host;
  const downloadable = !!data && data.kind !== "page";

  const download = async () => {
    await getCorpusSession().catch(() => null);
    const a = document.createElement("a");
    a.href = relayUrl(target, false);
    a.download = data?.fileName ?? "";
    a.setAttribute("data-source-viewer", "off");
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const reload = () => {
    if (view === "reader") {
      readerGen.current = generation.current;
      void loadReader(target, generation.current);
    } else {
      setFrameLoaded(false);
      setFrameKey((k) => k + 1);
    }
  };

  const note = (() => {
    if (check.status === "loading") return "Checking how this source can be shown…";
    if (view === "embed")
      return `Shown as published by ${host}. If it stays blank, switch to another view.`;
    if (view === "document")
      return [data?.contentType?.split(";")[0], sizeLabel(data?.size ?? null), `from ${host}`]
        .filter(Boolean)
        .join(" · ");
    if (view === "browser")
      return data && !data.embeddable && data.kind === "page"
        ? "This site does not allow embedding, so it opens in a live browser. It closes with this panel."
        : "A live browser you can click and scroll. It closes with this panel.";
    if (view === "reader")
      return reader.status === "ready" && reader.truncated
        ? "Main text only, shortened. Layout and images are left out."
        : "Main text only. Layout and images are left out.";
    if (view === "file") return "This address is a file to download.";
    return check.status === "error"
      ? check.message
      : (data?.reason ?? "This source cannot be shown here.");
  })();

  const headerButton =
    "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
  const frameSpinner = (label: string) => (
    <div className="absolute inset-0 grid place-items-center bg-background/70" aria-hidden>
      <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {label}
      </span>
    </div>
  );
  const fallback = (message: string) => (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <CircleAlert className="mx-auto size-5 text-muted-foreground" aria-hidden />
        <p className="m-0 mt-2 text-[13px]">{message}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {views
            .filter((v) => v !== view)
            .map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => show(v, target)}
                className="rounded-md border border-border px-2.5 py-1.5 text-[12.5px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                Show {VIEW_LABEL[v].toLowerCase()} view
              </button>
            ))}
          <a
            href={target}
            target="_blank"
            rel="noopener noreferrer"
            data-source-viewer="off"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Open in a new tab <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );

  let content: ReactNode = null;
  if (check.status === "loading" || !view) {
    content = frameSpinner("Checking the source…");
  } else if (view === "embed") {
    content = (
      <>
        <iframe
          key={`embed-${frameKey}`}
          src={target}
          title={`${title} (embedded)`}
          className="absolute inset-0 size-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
          referrerPolicy="no-referrer"
          onLoad={() => setFrameLoaded(true)}
        />
        {frameLoaded ? null : frameSpinner("Loading the page…")}
      </>
    );
  } else if (view === "document") {
    if (!docReady) content = frameSpinner("Preparing the document…");
    else if (data?.kind === "image")
      content = (
        <div className="absolute inset-0 grid place-items-center overflow-auto p-4">
          <img
            key={`img-${frameKey}`}
            src={relayUrl(target, true)}
            alt={title}
            className="max-h-full max-w-full object-contain"
            onLoad={() => setFrameLoaded(true)}
          />
        </div>
      );
    else
      content = (
        <>
          <iframe
            key={`doc-${frameKey}`}
            src={relayUrl(target, true)}
            title={`${title} (document)`}
            className="absolute inset-0 size-full border-0 bg-white"
            onLoad={() => setFrameLoaded(true)}
          />
          {frameLoaded ? null : frameSpinner("Loading the document…")}
        </>
      );
  } else if (view === "browser") {
    if (session.status === "live")
      content = (
        <>
          <iframe
            key={`live-${frameKey}`}
            src={session.liveUrl}
            title={`${title} (interactive)`}
            className="absolute inset-0 size-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            allow="clipboard-read; clipboard-write"
            referrerPolicy="no-referrer"
            onLoad={() => setFrameLoaded(true)}
          />
          {frameLoaded ? null : frameSpinner("Connecting…")}
        </>
      );
    else if (session.status === "error") content = fallback(session.message);
    else content = frameSpinner("Opening a live browser on the page…");
  } else if (view === "reader") {
    if (reader.status === "ready")
      content = (
        <div className="absolute inset-0 overflow-y-auto">
          <article className="mx-auto max-w-[44rem] px-6 py-5 text-[14px] leading-relaxed">
            <AssistantMarkdown text={reader.markdown} />
            {reader.truncated ? (
              <p className="mt-6 border-t border-border pt-3 text-[12px] text-muted-foreground">
                The text continues on the page. Open it in a new tab to read the rest.
              </p>
            ) : null}
          </article>
        </div>
      );
    else if (reader.status === "error") content = fallback(reader.message);
    else content = frameSpinner("Reading the page text…");
  } else if (view === "file") {
    content = (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="m-0 truncate text-[13.5px] font-medium">{data?.fileName ?? host}</p>
              <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
                {[data?.contentType?.split(";")[0], sizeLabel(data?.size ?? null), host]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void download()}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Download className="size-3.5" aria-hidden /> Download
            </button>
            {views.includes("reader") ? (
              <button
                type="button"
                onClick={() => show("reader", target)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12.5px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <AlignLeft className="size-3.5" aria-hidden /> Read as text
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  } else {
    content = fallback(
      check.status === "error"
        ? check.message
        : `${data?.reason ?? "This source cannot be shown here."} Open it in a new tab instead.`,
    );
  }

  const viewer = (
    <div
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label={`Source: ${title}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-surface shadow-2xl outline-none print:hidden"
      style={{ width: wide ? "min(1280px, 100vw)" : "min(860px, 100vw)" }}
    >
      <header className="flex items-start gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[13.5px] font-semibold" title={title}>
            {title}
          </h2>
          <p className="m-0 truncate text-[11.5px] text-muted-foreground" title={target}>
            {target.replace(/^https?:\/\//, "")}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            className={cn(headerButton, "w-auto gap-1 px-1.5 text-[12px]")}
            onClick={() =>
              askAssistant(
                [
                  `Read this source and tell me what it says that matters for my research: ${target}`,
                  `(${title}${data?.kind && data.kind !== "page" ? `, a ${data.kind}` : ""}).`,
                  "Give its date and author or issuing body, the key points with pinpoint quotes, and how it relates to the page I was on. Cite what you use.",
                ].join(" "),
                `About this source: ${title}`.slice(0, 160),
              )
            }
            aria-label="Ask the assistant about this source"
            title="Ask the assistant about this source"
          >
            <MessageCircle className="size-3.5" aria-hidden />
            Ask
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => {
              void navigator.clipboard
                .writeText(target)
                .then(() => toast.success("Link copied"))
                .catch(() => toast.error("Could not copy the link"));
            }}
            aria-label="Copy link"
            title="Copy link"
          >
            <Copy className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={reload}
            disabled={!view || view === "blocked" || view === "file"}
            aria-label="Reload"
            title="Reload"
          >
            <RotateCw className="size-3.5" aria-hidden />
          </button>
          {downloadable ? (
            <button
              type="button"
              className={headerButton}
              onClick={() => void download()}
              aria-label="Download"
              title="Download"
            >
              <Download className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <a
            href={target}
            target="_blank"
            rel="noopener noreferrer"
            data-source-viewer="off"
            className={headerButton}
            aria-label="Open in a new tab"
            title="Open in a new tab"
          >
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
          <button
            type="button"
            className={cn(headerButton, "max-md:hidden")}
            onClick={() => setWide((w) => !w)}
            aria-label={wide ? "Narrower panel" : "Wider panel"}
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
            onClick={close}
            aria-label="Close source"
            title="Close (Esc)"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>
      <div className="flex min-h-9 items-center gap-2 border-b border-border/70 px-3 py-1">
        {views.length > 1 ? (
          <div
            className="flex shrink-0 rounded-md border border-border p-0.5"
            role="group"
            aria-label="View"
          >
            {views.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => show(v, target)}
                aria-pressed={view === v}
                className={cn(
                  "rounded px-2 py-0.5 text-[12px] focus-visible:outline-2 focus-visible:outline-ring",
                  view === v
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        ) : null}
        <p className="m-0 min-w-0 truncate text-[11.5px] text-muted-foreground" title={note}>
          {note}
        </p>
      </div>
      <div ref={body} className="relative min-h-0 flex-1 bg-muted/30">
        {content}
      </div>
    </div>
  );
  return createPortal(viewer, document.body);
}
