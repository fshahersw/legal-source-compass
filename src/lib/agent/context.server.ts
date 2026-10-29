/**
 * What the agent brings into each task from its workspace: the user's saved preferences and facts, the procedures that
 * match the task, the last few tasks it did, and what is new in its folder. Memories it brings in are marked as used,
 * so the ones that keep helping rank first. Everything here is data the user or earlier tasks saved; it is labelled as
 * such in the prompt. Server-only.
 */
import { listEpisodes, listFiles, listMemories, touchMemories, type Memory } from "./store.server";

const STOP = new Set(
  "the a an and or of to in on for with by at from is are was were be this that these those what which who how why when where do does did can could should would will my our your their its it me us show find tell give get make about into over than then".split(
    " ",
  ),
);

export function taskWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP.has(w)),
    ),
  ].slice(0, 30);
}

export function scoreMemory(m: Memory, words: string[]): number {
  if (!words.length) return 0;
  const hay = `${m.title} ${m.body} ${m.tags.join(" ")}`.toLowerCase();
  return words.reduce(
    (s, w) => s + (hay.includes(w) ? (m.title.toLowerCase().includes(w) ? 2 : 1) : 0),
    0,
  );
}

export type AgentContext = { text: string; usedIds: string[]; unread: number };

/** Pick memories for a task: every preference, the most used facts plus matching ones, and matching procedures. */
export function pickMemories(
  all: Memory[],
  task: string,
): { preferences: Memory[]; facts: Memory[]; procedures: Memory[] } {
  const words = taskWords(task);
  const byScore = (list: Memory[]) =>
    list
      .map((m) => ({ m, s: scoreMemory(m, words) }))
      .sort(
        (a, b) => b.s - a.s || b.m.uses - a.m.uses || b.m.updated_at.localeCompare(a.m.updated_at),
      );
  const preferences = all.filter((m) => m.kind === "preference").slice(0, 25);
  const facts = byScore(all.filter((m) => m.kind === "fact"))
    .filter((x, i) => x.s > 0 || i < 12)
    .slice(0, 25)
    .map((x) => x.m);
  const procedures = byScore(all.filter((m) => m.kind === "procedure"))
    .filter((x) => x.s >= 2)
    .slice(0, 4)
    .map((x) => x.m);
  return { preferences, facts, procedures };
}

export async function buildAgentContext(owner: string, task: string): Promise<AgentContext> {
  const [memories, episodes, files] = await Promise.all([
    listMemories(owner).catch(() => [] as Memory[]),
    listEpisodes(owner, 6).catch(() => []),
    listFiles(owner, { limit: 6 }).catch(() => ({ total: 0, unread: 0, rows: [] })),
  ]);
  const { preferences, facts, procedures } = pickMemories(memories, task);
  const lines: string[] = [];
  if (preferences.length) {
    lines.push(
      "Preferences this user asked for (follow them unless the current request says otherwise):",
    );
    for (const m of preferences) lines.push(`- [${m.id}] ${m.title}: ${m.body}`);
  }
  if (facts.length) {
    lines.push("", "Facts you saved about this user's work:");
    for (const m of facts) lines.push(`- [${m.id}] ${m.title}: ${m.body}`);
  }
  if (procedures.length) {
    lines.push(
      "",
      "Procedures you saved that may fit this task (reuse their steps when they apply):",
    );
    for (const m of procedures) lines.push(`- [${m.id}] ${m.title}:\n${m.body}`);
  }
  if (episodes.length) {
    lines.push("", "Your most recent tasks for this user (newest first):");
    for (const e of episodes)
      lines.push(
        `- ${e.created_at.slice(0, 10)} · ${e.task.slice(0, 160)} → ${e.summary.slice(0, 220).replace(/\s+/g, " ")}`,
      );
  }
  if (files.total) {
    lines.push("", `Agent folder: ${files.total} files, ${files.unread} unread. Newest:`);
    for (const f of files.rows)
      lines.push(
        `- [${f.id}] ${f.kind} · ${f.title}${f.unread ? " (unread)" : ""} · ${f.created_at.slice(0, 10)}`,
      );
  }
  const used = [...preferences, ...facts, ...procedures].map((m) => m.id);
  if (used.length) void touchMemories(owner, used).catch(() => undefined);
  return { text: lines.join("\n"), usedIds: used, unread: files.unread };
}

/** The site paths a task opened, from the go_to calls in its turns. */
export function pathsFromTurns(turns: { role: string; content: unknown }[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    if (t.role !== "assistant" || !Array.isArray(t.content)) continue;
    for (const b of t.content as { type?: string; name?: string; input?: { path?: unknown } }[])
      if (b.type === "tool_use" && b.name === "go_to" && typeof b.input?.path === "string") {
        const p = b.input.path.slice(0, 300);
        if (!out.includes(p)) out.push(p);
      }
  }
  return out.slice(0, 20);
}
