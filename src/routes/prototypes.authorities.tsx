import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Former preview of the statute ↔ regulation panels. The panels are mounted on the pages they were designed for: a
 * U.S. Code section page (?usc=<title>/<section>), a CFR part page (?cfr=<title>/<part>), and the CFR index with the
 * agency index (no query).
 */
const PAIR = /^([0-9a]{1,3})\/([A-Za-z0-9._-]{1,40})$/;

export const Route = createFileRoute("/prototypes/authorities")({
  beforeLoad: ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const usc = typeof search["usc"] === "string" ? PAIR.exec(search["usc"]) : null;
    const cfr = typeof search["cfr"] === "string" ? PAIR.exec(search["cfr"]) : null;
    if (usc)
      throw redirect({
        to: "/law/uscode/$title/$section",
        params: { title: usc[1]!, section: usc[2]! },
        replace: true,
      });
    if (cfr)
      throw redirect({
        to: "/law/cfr/$title/part/$part",
        params: { title: cfr[1]!, part: cfr[2]! },
        replace: true,
      });
    throw redirect({ to: "/law/cfr", replace: true });
  },
});
