import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  MEMORY_MESSAGES,
  rollingMemory,
  sanitizeCitationCheck,
  type AssistantAttachment,
  type AssistantEvent,
  type AssistantSource,
  type AssistantStep,
  type CitationCheck,
  type PageContext,
} from "@/lib/assistant/protocol";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Shown instead of `content` for questions sent from page actions. */
  display?: string | undefined;
  status: "streaming" | "done" | "error" | "stopped";
  steps: AssistantStep[];
  sources: AssistantSource[];
  notes: string[];
  attachments: { name: string; type: string }[];
  /** Every citation found in the answer with its lookup status; absent when the answer cites none. */
  citationCheck?: CitationCheck | null;
};

const STORE = "assistant:messages:v1";
const id = () => Math.random().toString(36).slice(2, 10);

function load(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORE);
    const parsed = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (m) =>
              m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
          )
          .map((m) => ({
            ...m,
            status: m.status === "streaming" ? "stopped" : m.status,
            citationCheck: sanitizeCitationCheck(m.citationCheck),
          }))
          .slice(-MEMORY_MESSAGES)
      : [];
  } catch {
    return [];
  }
}

/** Conversation state with a rolling memory of eight messages, kept in this browser only. */
export function useAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    typeof window === "undefined" ? [] : load(),
  );
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify(messages.filter((m) => m.status !== "streaming").slice(-MEMORY_MESSAGES)),
      );
    } catch {
      // storage unavailable: memory lasts for this page only
    }
  }, [messages]);

  const patch = useCallback((mid: string, change: (m: ChatMessage) => ChatMessage) => {
    setMessages((all) => all.map((m) => (m.id === mid ? change(m) : m)));
  }, []);

  const send = useCallback(
    async (
      text: string,
      attachments: AssistantAttachment[],
      page: PageContext | null,
      display?: string,
    ) => {
      const question = text.trim();
      if (!question || busy) return;
      const user: ChatMessage = {
        id: id(),
        role: "user",
        content: question,
        display,
        status: "done",
        steps: [],
        sources: [],
        notes: [],
        attachments: attachments.map((a) => ({ name: a.name, type: a.type })),
      };
      const reply: ChatMessage = {
        id: id(),
        role: "assistant",
        content: "",
        status: "streaming",
        steps: [],
        sources: [],
        notes: [],
        attachments: [],
      };
      const prior = messages.filter((m) => m.status === "done" && m.content.trim());
      setMessages((all) => [...all, user, reply].slice(-(MEMORY_MESSAGES + 2)));
      setBusy(true);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch("/api/assistant", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: rollingMemory(
              [...prior, user].map((m) => ({ role: m.role, content: m.content })),
            ),
            page,
            attachments,
          }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "The assistant could not answer right now.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let round = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 2);
            if (!line.startsWith("data:")) continue;
            let event: AssistantEvent;
            try {
              event = JSON.parse(line.slice(5)) as AssistantEvent;
            } catch {
              continue;
            }
            if (event.type === "delta") {
              patch(reply.id, (m) => {
                if (event.round > round) {
                  const notes = m.content.trim() ? [...m.notes, m.content.trim()] : m.notes;
                  round = event.round;
                  return { ...m, notes, content: event.text };
                }
                return { ...m, content: m.content + event.text };
              });
            } else if (event.type === "step") {
              patch(reply.id, (m) => {
                const i = m.steps.findIndex((s) => s.id === event.step.id);
                const steps =
                  i >= 0
                    ? m.steps.map((s, k) => (k === i ? event.step : s))
                    : [...m.steps, event.step];
                return { ...m, steps };
              });
            } else if (event.type === "done") {
              patch(reply.id, (m) => ({
                ...m,
                content: event.text || m.content,
                sources: event.sources,
                citationCheck: sanitizeCitationCheck(event.citation_check),
                status: "done",
              }));
            } else if (event.type === "error") {
              patch(reply.id, (m) => ({ ...m, content: event.message, status: "error" }));
            }
          }
        }
        patch(reply.id, (m) =>
          m.status === "streaming"
            ? {
                ...m,
                status: m.content ? "done" : "error",
                content: m.content || "No answer was returned.",
              }
            : m,
        );
      } catch (error) {
        if (controller.signal.aborted) patch(reply.id, (m) => ({ ...m, status: "stopped" }));
        else
          patch(reply.id, (m) => ({
            ...m,
            status: "error",
            content:
              error instanceof Error ? error.message : "The assistant could not answer right now.",
          }));
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, messages, patch],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const reset = useCallback(() => {
    abort.current?.abort();
    setMessages([]);
  }, []);

  return { messages, busy, send, stop, reset };
}
