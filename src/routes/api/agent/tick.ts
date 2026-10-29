import { createFileRoute } from "@tanstack/react-router";

/**
 * The scheduler's heartbeat. Every five minutes the database (pg_cron, agent.tick) posts a one-time token here when a
 * scheduled task is due. The token is redeemed once against the database, so no shared secret lives on the site; then
 * up to two due tasks run headless and save their reports. Requests without a fresh token do nothing.
 */
export const Route = createFileRoute("/api/agent/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let token = "";
        try {
          const body = (await request.json()) as { token?: unknown };
          token = typeof body.token === "string" ? body.token : "";
        } catch {
          token = "";
        }
        if (!/^[a-f0-9]{64}$/.test(token)) return Response.json({ ok: false }, { status: 400 });
        const { claimTick, claimSchedules } = await import("@/lib/agent/store.server");
        try {
          if (!(await claimTick(token))) return Response.json({ ok: false }, { status: 403 });
          const due = await claimSchedules(2);
          const { runScheduledTask } = await import("@/lib/agent/runner.server");
          const results = [];
          for (const s of due) {
            const r = await runScheduledTask(s.owner, s, { budgetMs: 120_000 });
            results.push({ id: s.id, ok: r.ok });
          }
          return Response.json({ ok: true, ran: results.length, results });
        } catch (error) {
          console.error("agent tick", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
