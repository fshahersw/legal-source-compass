import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled agent tasks for the caller's workspace: list them, pause or resume one, run one now (the run happens in
 * this request and returns its report), or delete one. New schedules are created by the agent itself.
 */
export const Route = createFileRoute("/api/agent/schedules")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { guard, json, failure } = await import("@/lib/agent/http.server");
        const who = await guard(request, "schedules");
        if (who instanceof Response) return who;
        const { listSchedules } = await import("@/lib/agent/store.server");
        try {
          return json({ schedules: await listSchedules(who.owner) });
        } catch (error) {
          return failure(error, "Schedules could not be read.");
        }
      },
      POST: async ({ request }) => {
        const { guard, json, readJson, failure, UUID_RE } = await import("@/lib/agent/http.server");
        const who = await guard(request, "schedules-write", 60);
        if (who instanceof Response) return who;
        const body = await readJson(request, 4096);
        if (body instanceof Response) return body;
        const id = typeof body["id"] === "string" ? body["id"] : "";
        if (!UUID_RE.test(id)) return json({ error: "A schedule id is required." }, 400);
        const action = body["action"];
        const store = await import("@/lib/agent/store.server");
        const { nextRun } = await import("@/lib/agent/schedule");
        try {
          const s = await store.getSchedule(who.owner, id);
          if (!s) return json({ error: "No such scheduled task." }, 404);
          if (action === "delete")
            return json({ deleted: await store.deleteSchedule(who.owner, id) });
          if (action === "pause" || action === "resume") {
            const active = action === "resume";
            const spec = {
              cadence: s.cadence,
              at: s.at_time,
              weekday: s.weekday,
              monthday: s.monthday,
              tz: s.tz,
            };
            const saved = await store.putSchedule(who.owner, {
              id,
              title: s.title,
              task: s.task,
              cadence: s.cadence,
              at: s.at_time,
              weekday: s.weekday,
              monthday: s.monthday,
              tz: s.tz,
              active,
              nextRunAt: active ? nextRun(spec, Date.now()) : null,
            });
            return json({ schedule: saved });
          }
          if (action === "run") {
            const { runScheduledTask } = await import("@/lib/agent/runner.server");
            const out = await runScheduledTask(who.owner, s);
            return json(out, out.ok ? 200 : 502);
          }
          return json({ error: "Unknown action." }, 400);
        } catch (error) {
          return failure(error, "The scheduled task could not be changed.");
        }
      },
    },
  },
});
