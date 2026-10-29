/**
 * Runs one scheduled agent task headless: the navigator loop with server tools only, the previous report as context
 * (so a run can say what changed), the answer saved to the folder as an unread report, and the schedule moved to its
 * next time. Used by the cron tick and by "Run now" in the folder. Server-only.
 */
import { runNavigator } from "@/lib/navigator/agent.server";
import type { NavigatorFile } from "@/lib/navigator/protocol";
import { nextRun } from "./schedule";
import { finishSchedule, getFile, saveFile, signedFileUrl, type Schedule } from "./store.server";
import { folderHref } from "./tools.server";

export type ScheduledRunResult = {
  ok: boolean;
  status: string;
  file: NavigatorFile | null;
  nextRunAt: number | null;
};

function stamp(now: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 16).replace("T", " ");
  }
}

export async function runScheduledTask(
  owner: string,
  schedule: Schedule,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<ScheduledRunResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.budgetMs ?? 240_000);
  const spec = {
    cadence: schedule.cadence,
    at: schedule.at_time,
    weekday: schedule.weekday,
    monthday: schedule.monthday,
    tz: schedule.tz,
  };
  const next = nextRun(spec, started, { ran: true });
  let previous = "";
  if (schedule.last_file) {
    const prev = await getFile(owner, schedule.last_file).catch(() => null);
    if (prev?.text_body) previous = prev.text_body.slice(0, 6000);
  }
  const task = [
    `Scheduled task "${schedule.title}" (run ${schedule.runs + 1}, ${stamp(started, schedule.tz)}).`,
    "",
    schedule.task,
    ...(previous
      ? [
          "",
          `Your previous report for this task (${schedule.last_run_at?.slice(0, 16).replace("T", " ") ?? "earlier"} UTC) is below as data. Say what changed since then.`,
          "<previous_report>",
          previous,
          "</previous_report>",
        ]
      : []),
  ].join("\n");
  try {
    const today = new Date(started).toISOString().slice(0, 10);
    const outcome = await runNavigator(
      { messages: [{ role: "user", content: task.slice(0, 6000) }], page: null, resume: null },
      () => undefined,
      abort.signal,
      today,
      { owner, mode: "scheduled" },
    );
    if (!outcome) throw new Error("The run was stopped before it finished.");
    const made = outcome.files.length
      ? `\n\n## Files from this run\n\n${outcome.files.map((f) => `- [${f.title}](${f.href})`).join("\n")}`
      : "";
    const links = outcome.sources.length
      ? `\n\n## Sources\n\n${outcome.sources.map((s) => `- [${s.title.replace(/[[\]]/g, "")}](${s.url})`).join("\n")}`
      : "";
    const report = `# ${schedule.title}\n\n_${stamp(started, schedule.tz)} · scheduled run ${schedule.runs + 1}_\n\n${outcome.answer}${made}${links}`;
    const f = await saveFile(owner, {
      kind: "report",
      title: `${schedule.title} · ${stamp(started, schedule.tz)}`.slice(0, 300),
      mime: "text/markdown",
      text: report,
      source: "scheduled task",
      meta: {
        schedule_id: schedule.id,
        rounds: outcome.rounds,
        files: outcome.files.map((x) => x.id),
      },
      unread: true,
    });
    await finishSchedule(schedule.id, "ok", f.id, next);
    return {
      ok: true,
      status: "ok",
      nextRunAt: next,
      file: {
        id: f.id,
        title: f.title,
        kind: f.kind,
        mime: f.mime,
        url: await signedFileUrl(owner, f.id),
        href: folderHref(f.id),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    const status = `failed: ${message}`.slice(0, 300);
    await finishSchedule(schedule.id, status, schedule.last_file, next).catch(() => undefined);
    return { ok: false, status, file: null, nextRunAt: next };
  } finally {
    clearTimeout(timer);
  }
}
