/**
 * The navigator's conversation and run loop in the browser. A task streams from /api/navigator; when the agent asks
 * for browser tools the stream ends with the calls, this hook runs them one by one on the live page (the user sees
 * each), and posts the results back to resume. Repeats until the agent answers, fails or the user stops it.
 */
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { collectPageContext } from "@/components/assistant/pageContext";
import {
  NAV_MAX_MESSAGE_CHARS,
  NAV_MEMORY_MESSAGES,
  type ClientCall,
  type NavigatorEvent,
  type NavigatorSource,
  type NavigatorStep,
} from "@/lib/navigator/protocol";
import { clearOverlays } from "./pointer";
import { execute, runningLabel, settle } from "./executor";

export type NavMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "running" | "done" | "error" | "stopped";
  steps: NavigatorStep[];
  notes: string[];
  sources: NavigatorSource[];
  /** Pages the task visited, in order. */
  trail: string[];
};

const uid = () => Math.random().toString(36).slice(2, 10);

function memory(messages: NavMessage[]): { role: "user" | "assistant"; content: string }[] {
  let tail = messages
    .filter((m) => m.status === "done" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, NAV_MAX_MESSAGE_CHARS) }))
    .slice(-NAV_MEMORY_MESSAGES);
  while (tail.length && tail[0]!.role !== "user") tail = tail.slice(1);
  return tail;
}

type Pending = Extract<NavigatorEvent, { type: "client_tools" }>;

export function useNavigator(panelRef: React.RefObject<HTMLElement | null>) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<NavMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, change: (m: NavMessage) => NavMessage) => {
    setMessages((all) => all.map((m) => (m.id === id ? change(m) : m)));
  }, []);

  const upsertStep = useCallback(
    (id: string, step: NavigatorStep) =>
      patch(id, (m) => {
        const i = m.steps.findIndex((s) => s.id === step.id);
        return {
          ...m,
          steps: i >= 0 ? m.steps.map((s, k) => (k === i ? step : s)) : [...m.steps, step],
        };
      }),
    [patch],
  );

  const run = useCallback(
    async (text: string) => {
      const question = text.trim().slice(0, NAV_MAX_MESSAGE_CHARS);
      if (!question || busy) return;
      const user: NavMessage = {
        id: uid(),
        role: "user",
        content: question,
        status: "done",
        steps: [],
        notes: [],
        sources: [],
        trail: [],
      };
      const reply: NavMessage = {
        ...user,
        id: uid(),
        role: "assistant",
        content: "",
        status: "running",
      };
      const history = memory([...messages, user]);
      setMessages((all) => [...all, user, reply]);
      setBusy(true);
      const controller = new AbortController();
      abort.current = controller;
      const ctx = { router, queryClient, panel: panelRef.current, signal: controller.signal };
      const startPath = `${location.pathname}${location.search}`;
      patch(reply.id, (m) => ({ ...m, trail: [startPath] }));
      let body: Record<string, unknown> = {
        messages: history,
        page: collectPageContext(panelRef.current),
        resume: null,
      };
      let round = 0;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        for (let hop = 0; hop < 40; hop++) {
          const res = await fetch("/api/navigator", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
          });
          if (!res.ok || !res.body) {
            const err = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(err?.error ?? "The navigator could not continue right now.");
          }
          let pending: Pending | null = null;
          let finished = false;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buffer.indexOf("\n\n")) >= 0) {
              const line = buffer.slice(0, cut).trim();
              buffer = buffer.slice(cut + 2);
              if (!line.startsWith("data:")) continue;
              let event: NavigatorEvent;
              try {
                event = JSON.parse(line.slice(5)) as NavigatorEvent;
              } catch {
                continue;
              }
              if (event.type === "delta") {
                const r = event.round;
                patch(reply.id, (m) => {
                  if (r > round) {
                    round = r;
                    const notes = m.content.trim() ? [...m.notes, m.content.trim()] : m.notes;
                    return { ...m, notes, content: event.text };
                  }
                  return { ...m, content: m.content + event.text };
                });
              } else if (event.type === "step") upsertStep(reply.id, event.step);
              else if (event.type === "client_tools") pending = event;
              else if (event.type === "done") {
                finished = true;
                patch(reply.id, (m) => ({
                  ...m,
                  content: event.text || m.content,
                  sources: event.sources,
                  status: "done",
                }));
              } else if (event.type === "error") {
                finished = true;
                patch(reply.id, (m) => ({ ...m, content: event.message, status: "error" }));
              }
            }
          }
          if (finished || !pending) break;
          // run the browser tools in order, then resume
          const results: { id: string; content: string; is_error?: boolean }[] = [];
          for (const call of pending.calls as ClientCall[]) {
            if (controller.signal.aborted) break;
            upsertStep(reply.id, {
              id: call.id,
              label: runningLabel(call),
              detail: "",
              state: "running",
            });
            const out = await execute(call, ctx);
            upsertStep(reply.id, {
              id: call.id,
              label: out.label,
              detail: out.detail,
              state: out.isError ? "failed" : "done",
              path: out.path,
            });
            patch(reply.id, (m) =>
              m.trail.at(-1) === out.path ? m : { ...m, trail: [...m.trail, out.path] },
            );
            results.push({
              id: call.id,
              content: out.content,
              ...(out.isError ? { is_error: true } : {}),
            });
          }
          if (controller.signal.aborted) break;
          body = {
            messages: history,
            page: null,
            resume: { ...pending.resume, results },
          };
        }
        await settle(ctx, 3000);
      } catch (error) {
        if (!controller.signal.aborted)
          patch(reply.id, (m) => ({
            ...m,
            content:
              error instanceof Error
                ? error.message
                : "The navigator could not continue right now.",
            status: "error",
          }));
      } finally {
        patch(reply.id, (m) =>
          m.status === "running"
            ? {
                ...m,
                status: controller.signal.aborted ? "stopped" : m.content ? "done" : "error",
                content: controller.signal.aborted
                  ? m.content || "Stopped."
                  : m.content || "No answer was returned.",
                steps: m.steps.map((s) =>
                  s.state === "running" ? { ...s, state: "failed" as const } : s,
                ),
              }
            : m,
        );
        setBusy(false);
        abort.current = null;
        setTimeout(clearOverlays, 2500);
      }
    },
    [busy, messages, panelRef, patch, queryClient, router, upsertStep],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    clearOverlays();
  }, []);

  const clear = useCallback(() => {
    if (!busy) setMessages([]);
  }, [busy]);

  return { messages, busy, run, stop, clear };
}
