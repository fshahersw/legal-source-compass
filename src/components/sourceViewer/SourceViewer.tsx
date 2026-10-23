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
import { askAssistant } from "@/components/assistant/askAssistant";
import { ReaderArticle } from "./ReaderArticle";
import { runOpenFlow } from "./openFlow";
import {
  createSessionRefresher,
  createSourceClient,
  type CheckFailure,
  type CheckOutcome,
} from "./sourceClient";
import {
  SLOW_WAIT_MS,
  SOURCE_EVENT,
  VIEW_LABEL,
  availableViews,
  failureViews,
  hostLabel,
  interceptTarget,
  relayUrl,
  sizeLabel,
  startViews,
  type CheckResult,
  type SourceRequest,
  type ViewMode,
} from "./sourceLinks";
import {
  LIVE_FRAME_GRACE_MS,
  RACE_HEDGE_MS,
  raceChosen,
  raceFailed,
  raceHedge,
  raceReady,
  startRace,
  type Race,
  type RaceStep,
} from "./viewRace";

type Check =
  | { status: "loading" }
  | { status: "ready"; data: CheckResult }
  | (Omit<CheckFailure, "ok"> & { status: "error"; document: boolean });
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

/** From this size a document is announced as large: the viewer needs a while to receive it. */
const LARGE_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Views whose frames stay mounted once shown, so switching back is instant and keeps the reader's place. */
const LAYERED: ViewMode[] = ["embed", "document", "browser", "reader"];

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function anchorTitle(anchor: HTMLAnchorElement): string | undefined {
  const text = squash(
    anchor.getAttribute("aria-label") || anchor.title || anchor.innerText || "",
  ).slice(0, 200);
  return text && !/^https?:\/\//i.test(text) ? text : undefined;
}

// What the panel asks the server, remembered between openings (one check per address, one text per address).
let lastToken: string | null = null;
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    lastToken = data.session?.access_token ?? null;
  } catch {
    lastToken = null;
  }
  return lastToken ? { authorization: `Bearer ${lastToken}` } : {};
}
const client = createSourceClient({
  fetch: (input, init) => window.fetch(input, init),
  headers: authHeaders,
});
/** Refreshes the short-lived session cookie so the same-site relay can be loaded by a frame (frames cannot send headers). */
const ensureSession = createSessionRefresher(() => getCorpusSession());

const PLAIN_CLICK = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

/** A loading state that says more, and offers the way out, when it takes long. */
function Waiting({ label, slowText, href }: { label: string; slowText: string; href: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="absolute inset-0 grid place-items-center bg-background/70" role="status">
      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
        </span>
        {slow ? (
          <>
            <span className="max-w-xs text-[12px] text-muted-foreground">{slowText}</span>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-source-viewer="off"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              Open in a new tab <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Outside links open here instead of a new tab: framable pages are shown directly, documents through a same-site relay,
 * and pages that refuse framing as extracted text or in a disposable interactive browser, whichever is ready first. Every
 * outbound fetch and browser session is made by the server, which only reaches public addresses.
 */
export function SourceViewer() {
  const [mounted, setMounted] = useState(false);
  const [source, setSource] = useState<SourceRequest | null>(null);
  const [check, setCheck] = useState<Check>({ status: "loading" });
  const [view, setView] = useState<ViewMode | null>(null);
  const [visited, setVisited] = useState<ViewMode[]>([]);
  const [session, setSession] = useState<Session>({ status: "idle" });
  const [reader, setReader] = useState<Reader>({ status: "idle" });
  const [cookieReady, setCookieReady] = useState(false);
  const [loaded, setLoaded] = useState<Partial<Record<ViewMode, boolean>>>({});
  const [frameKeys, setFrameKeys] = useState<Partial<Record<ViewMode, number>>>({});
  const [raceError, setRaceError] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const liveId = useRef<string | null>(null);
  const cancelFlow = useRef<(() => void) | null>(null);
  const viewRef = useRef<ViewMode | null>(null);
  // The source generation each view last started loading for, so a view is loaded once per source (retried after a failure).
  const browserGen = useRef(-1);
  const readerGen = useRef(-1);
  const readerPending = useRef(false);
  // Views offered together race: the first one ready is shown, and the next is started if the first is slow (see viewRace.ts).
  const race = useRef<Race>(startRace([]));
  const raceUrl = useRef("");
  const hedgeTimer = useRef<number | undefined>(undefined);
  const beginRef = useRef<(mode: ViewMode, url: string) => void>(() => undefined);

  useEffect(() => setMounted(true), []);

  /** Ends the hosted browser, if one is running; keepalive lets it finish while the page unloads. */
  const stopSession = useCallback(() => {
    const id = liveId.current;
    liveId.current = null;
    if (!id) return;
    void fetch(`/api/source-browser?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      keepalive: true,
      headers: lastToken ? { authorization: `Bearer ${lastToken}` } : {},
    }).catch(() => null);
  }, []);

  const target = check.status === "ready" ? check.data.finalUrl : (source?.url ?? "");

  const select = useCallback((mode: ViewMode) => {
    viewRef.current = mode;
    setView(mode);
  }, []);

  /** Carries out what a race step decided: a view to start, a view to show, and when the race is over, no more waiting. */
  const applyStep = useCallback(
    (step: RaceStep, message?: string) => {
      race.current = step.race;
      if (!step.race.open) window.clearTimeout(hedgeTimer.current);
      if (step.start) beginRef.current(step.start, raceUrl.current);
      if (step.show) {
        if (step.show === "blocked") setRaceError(message ?? null);
        select(step.show);
      }
    },
    [select],
  );

  /** A started view is ready: if the first view is still to be picked, this one is it. */
  const settleReady = useCallback(
    (mode: ViewMode, gen: number) => {
      if (gen === generation.current) applyStep(raceReady(race.current, mode));
    },
    [applyStep],
  );

  /** A started view failed: the next is started, and when every one has failed the panel shows why. */
  const settleFailed = useCallback(
    (mode: ViewMode, message: string, gen: number) => {
      if (gen === generation.current) applyStep(raceFailed(race.current, mode), message);
    },
    [applyStep],
  );

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
        liveId.current = data.id;
        if (gen !== generation.current) {
          stopSession();
          return;
        }
        setLoaded((l) => ({ ...l, browser: false }));
        setSession({ status: "live", id: data.id, liveUrl: data.liveUrl });
      } catch (error) {
        if (gen !== generation.current) return;
        browserGen.current = -1;
        const message =
          error instanceof Error ? error.message : "The interactive view could not start.";
        setSession({ status: "error", message });
        settleFailed("browser", message, gen);
      }
    },
    [settleFailed, stopSession],
  );

  const loadReader = useCallback(
    async (url: string, gen: number, fresh = false) => {
      readerPending.current = true;
      setReader({ status: "loading" });
      const outcome = await client.reader(url, { fresh });
      if (gen !== generation.current) return;
      readerPending.current = false;
      if (outcome.ok) {
        setReader({ status: "ready", ...outcome.data });
        settleReady("reader", gen);
        return;
      }
      readerGen.current = -1;
      setReader({ status: "error", message: outcome.message });
      settleFailed("reader", outcome.message, gen);
    },
    [settleFailed, settleReady],
  );

  /** Starts whatever a view needs, once per source, without switching to it. */
  const begin = useCallback(
    (mode: ViewMode, url: string) => {
      const gen = generation.current;
      setVisited((v) => (v.includes(mode) ? v : [...v, mode]));
      if (mode === "browser" && browserGen.current !== gen) {
        browserGen.current = gen;
        void startBrowser(url, gen);
      } else if (mode === "reader" && readerGen.current !== gen) {
        readerGen.current = gen;
        void loadReader(url, gen);
      } else if (mode === "document") {
        void ensureSession().then(() => {
          if (gen === generation.current) setCookieReady(true);
        });
      }
    },
    [loadReader, startBrowser],
  );
  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  /** Switches the panel to a view the person chose (or the only one there is), starting it if need be. */
  const show = useCallback(
    (mode: ViewMode, url: string) => {
      race.current = raceChosen(race.current);
      window.clearTimeout(hedgeTimer.current);
      begin(mode, url);
      select(mode);
    },
    [begin, select],
  );

  /**
   * Starts the views a source opens with: one is shown at once. Several race: the first is started now, the next if the first
   * has not answered shortly (or has failed), and whichever is ready first is shown.
   */
  const run = useCallback(
    (modes: ViewMode[], url: string) => {
      window.clearTimeout(hedgeTimer.current);
      race.current = startRace(modes);
      raceUrl.current = url;
      setRaceError(null);
      if (modes.length === 1) {
        show(modes[0]!, url);
        return;
      }
      begin(modes[0]!, url);
      const gen = generation.current;
      hedgeTimer.current = window.setTimeout(() => {
        if (gen === generation.current) applyStep(raceHedge(race.current));
      }, RACE_HEDGE_MS);
    },
    [applyStep, begin, show],
  );

  /** Starts the live browser behind the current view when the pointer rests on its tab, so the click finds it ready. */
  const warmBrowser = useCallback(
    (url: string) => {
      const gen = generation.current;
      if (browserGen.current === gen) return;
      browserGen.current = gen;
      void startBrowser(url, gen);
    },
    [startBrowser],
  );

  const applyCheck = useCallback(
    (outcome: CheckOutcome, request: SourceRequest, gen: number) => {
      if (gen !== generation.current) return;
      if (outcome.ok) {
        setCheck({ status: "ready", data: outcome.data });
        const modes = startViews(outcome.data);
        // A document already loading from its address is left alone: reloading it would throw the progress away.
        if (modes.length === 1 && viewRef.current === modes[0]) return;
        run(modes, outcome.data.finalUrl);
        return;
      }
      const started = viewRef.current === "document";
      const keep = started && outcome.code === "unreachable";
      setCheck({
        status: "error",
        message: outcome.message,
        code: outcome.code,
        remoteBrowser: outcome.remoteBrowser,
        reader: outcome.reader,
        document: keep,
      });
      if (started && !keep) setVisited((v) => v.filter((m) => m !== "document"));
      const modes = failureViews(outcome, keep);
      if (modes.length === 1 && viewRef.current === modes[0]) return;
      run(modes, request.url);
    },
    [run],
  );

  const open = useCallback(
    (request: SourceRequest) => {
      cancelFlow.current?.();
      stopSession();
      generation.current += 1;
      const gen = generation.current;
      if (!panel.current?.contains(document.activeElement))
        returnFocus.current = document.activeElement as HTMLElement | null;
      viewRef.current = null;
      window.clearTimeout(hedgeTimer.current);
      race.current = startRace([]);
      readerPending.current = false;
      setSource(request);
      setCheck({ status: "loading" });
      setView(null);
      setVisited([]);
      setSession({ status: "idle" });
      setReader({ status: "idle" });
      setCookieReady(false);
      setLoaded({});
      setFrameKeys({});
      setRaceError(null);
      cancelFlow.current = runOpenFlow({ client, refreshSession: ensureSession }, request.url, {
        optimistic: (mode) => show(mode, request.url),
        checked: (outcome) => applyCheck(outcome, request, gen),
      });
    },
    [applyCheck, show, stopSession],
  );

  const close = useCallback(() => {
    cancelFlow.current?.();
    cancelFlow.current = null;
    stopSession();
    generation.current += 1;
    viewRef.current = null;
    window.clearTimeout(hedgeTimer.current);
    race.current = startRace([]);
    setSource(null);
    setView(null);
    setVisited([]);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  }, [stopSession]);

  // Plain clicks on outside links anywhere in the app open here. Bubble phase, so handlers that already took the click win.
  // A pointer resting on such a link (or pressing it) starts the embeddability check, so the click usually finds it answered.
  useEffect(() => {
    const linkTarget = (e: Event): string | null => {
      const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
      return el instanceof HTMLAnchorElement
        ? interceptTarget(el, PLAIN_CLICK, window.location.origin)
        : null;
    };
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
          PLAIN_CLICK,
          window.location.origin,
        );
        if (url) open({ url, title: detail.title });
      }
    };
    let hoverTimer: number | undefined;
    let hoverUrl: string | null = null;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const url = linkTarget(e);
      if (!url || url === hoverUrl) return;
      window.clearTimeout(hoverTimer);
      hoverUrl = url;
      hoverTimer = window.setTimeout(() => client.prefetchCheck(url), 120);
    };
    const onOut = () => {
      window.clearTimeout(hoverTimer);
      hoverUrl = null;
    };
    const onDown = (e: PointerEvent) => {
      const url = linkTarget(e);
      if (url) client.prefetchCheck(url);
    };
    const onHide = () => stopSession();
    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerout", onOut, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener(SOURCE_EVENT, onRequest);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearTimeout(hoverTimer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener(SOURCE_EVENT, onRequest);
      window.removeEventListener("pagehide", onHide);
    };
  }, [open, stopSession]);

  useEffect(() => {
    if (!source) return;
    const timer = window.setTimeout(() => panel.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [source]);

  if (!mounted || !source) return null;

  const data = check.status === "ready" ? check.data : null;
  const unreachable = check.status === "error" && check.code === "unreachable";
  const options = data
    ? data
    : {
        kind: check.status === "error" && check.document ? ("pdf" as const) : ("page" as const),
        embeddable: false,
        remoteBrowser: unreachable && check.remoteBrowser,
        reader: unreachable && check.reader,
      };
  const views = check.status === "loading" && !visited.length ? [] : availableViews(options);
  const host = hostLabel(target);
  const title =
    (view === "reader" && reader.status === "ready" && reader.title) ||
    source.title ||
    data?.fileName ||
    host;
  // A document that started loading before the check answered can already be downloaded.
  const downloadable =
    (!!data && data.kind !== "page") || (check.status === "loading" && view === "document");
  const frameLoaded = (v: ViewMode) => !!loaded[v];
  const markLoaded = (v: ViewMode) => setLoaded((l) => (l[v] ? l : { ...l, [v]: true }));
  const frameKey = (v: ViewMode) => frameKeys[v] ?? 0;

  const download = async () => {
    await ensureSession();
    const a = document.createElement("a");
    a.href = relayUrl(target, false);
    a.download = data?.fileName ?? "";
    a.setAttribute("data-source-viewer", "off");
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const reload = () => {
    if (!view) return;
    if (view === "reader") {
      readerGen.current = generation.current;
      void loadReader(target, generation.current, true);
    } else {
      setLoaded((l) => ({ ...l, [view]: false }));
      setFrameKeys((k) => ({ ...k, [view]: (k[view] ?? 0) + 1 }));
    }
  };

  const note = (() => {
    if (view === null)
      return check.status === "loading"
        ? "Checking how this source can be shown…"
        : "Opening the page. The first view that is ready is shown.";
    if (check.status === "loading") return `Loading the document from ${host}…`;
    if (view === "embed")
      return `Shown as published by ${host}. If it stays blank, switch to another view.`;
    if (view === "document")
      return [
        data?.contentType?.split(";")[0],
        sizeLabel(data?.size ?? null),
        `from ${host}`,
        // The PDF viewer shows nothing until it has the whole file (or enough of it), and a frame cannot report that.
        data?.size && data.size >= LARGE_DOCUMENT_BYTES
          ? "large file: the first page can take a moment to appear"
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    if (view === "browser")
      return data && !data.embeddable && data.kind === "page"
        ? "This site does not allow embedding, so it opens in a live browser. It closes with this panel."
        : "A live browser you can click and scroll. It closes with this panel.";
    if (view === "reader")
      return reader.status === "ready" && reader.truncated
        ? "Main text only, shortened. Layout and images are left out."
        : views.includes("browser")
          ? "Main text only. Layout and images are left out. Choose Interactive for the page itself."
          : "Main text only. Layout and images are left out.";
    if (view === "file") return "This address is a file to download.";
    return (
      raceError ??
      (check.status === "error"
        ? check.message
        : (data?.reason ?? "This source cannot be shown here."))
    );
  })();

  const headerButton =
    "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40";
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
  const waiting = (label: string, slowText: string) => (
    <Waiting label={label} slowText={slowText} href={target} />
  );

  const layer = (v: ViewMode): ReactNode => {
    if (v === "embed")
      return (
        <>
          <iframe
            key={`embed-${frameKey(v)}`}
            src={target}
            title={`${title} (embedded)`}
            className="absolute inset-0 size-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer"
            onLoad={() => markLoaded(v)}
          />
          {frameLoaded(v)
            ? null
            : waiting(
                "Loading the page…",
                `${host} is slow to load. You can keep waiting or open it in a new tab.`,
              )}
        </>
      );
    if (v === "document") {
      if (!cookieReady)
        return waiting("Preparing the document…", "This is taking longer than usual.");
      // The relay follows redirects itself, so the address as clicked keeps the frame stable while the check answers.
      const src = relayUrl(source.url, true);
      if (data?.kind === "image")
        return (
          <div className="absolute inset-0 grid place-items-center overflow-auto p-4">
            <img
              key={`img-${frameKey(v)}`}
              src={src}
              alt={title}
              className="max-h-full max-w-full object-contain"
              onLoad={() => markLoaded(v)}
            />
          </div>
        );
      return (
        <>
          <iframe
            key={`doc-${frameKey(v)}`}
            src={src}
            title={`${title} (document)`}
            className="absolute inset-0 size-full border-0 bg-white"
            onLoad={() => markLoaded(v)}
          />
          {frameLoaded(v)
            ? null
            : waiting(
                "Loading the document…",
                `${host} is slow to send it. You can keep waiting or open it in a new tab.`,
              )}
        </>
      );
    }
    if (v === "browser") {
      if (session.status === "live")
        return (
          <>
            <iframe
              key={`live-${frameKey(v)}`}
              src={session.liveUrl}
              title={`${title} (interactive)`}
              className="absolute inset-0 size-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              allow="clipboard-read; clipboard-write"
              referrerPolicy="no-referrer"
              onLoad={() => {
                markLoaded(v);
                // The live view paints a moment after it connects; if the text is about to arrive, let it go first.
                const gen = generation.current;
                window.setTimeout(
                  () => settleReady("browser", gen),
                  readerPending.current ? LIVE_FRAME_GRACE_MS : 0,
                );
              }}
            />
            {frameLoaded(v) ? null : waiting("Connecting…", "The live browser is slow to connect.")}
          </>
        );
      if (session.status === "error") return fallback(session.message);
      return waiting(
        "Opening a live browser on the page…",
        "The live browser is slow to start. You can keep waiting or open the page in a new tab.",
      );
    }
    // reader
    if (reader.status === "ready")
      return (
        <div className="absolute inset-0 overflow-y-auto">
          <ReaderArticle markdown={reader.markdown} truncated={reader.truncated} />
        </div>
      );
    if (reader.status === "error") return fallback(reader.message);
    return waiting("Reading the page text…", "Reading the page is taking longer than usual.");
  };

  let content: ReactNode = null;
  if (view === "file") {
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
  } else if (view === "blocked") {
    content = fallback(
      raceError ??
        (check.status === "error"
          ? check.message
          : `${data?.reason ?? "This source cannot be shown here."} Open it in a new tab instead.`),
    );
  } else if (view === null) {
    content =
      check.status === "loading"
        ? waiting(
            "Checking the source…",
            `${host} is slow to answer. You can keep waiting or open it in a new tab.`,
          )
        : waiting(
            "Opening the page…",
            "This page is slow to open. You can keep waiting or open it in a new tab.",
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
                onPointerEnter={v === "browser" ? () => warmBrowser(target) : undefined}
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
        {visited
          .filter((v) => LAYERED.includes(v))
          .map((v) => (
            <div key={v} className="absolute inset-0" hidden={view !== v}>
              {layer(v)}
            </div>
          ))}
        {content}
      </div>
    </div>
  );
  return createPortal(viewer, document.body);
}
