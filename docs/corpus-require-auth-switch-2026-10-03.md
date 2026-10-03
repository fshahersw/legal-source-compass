# Optional accounts: the `CORPUS_REQUIRE_AUTH` switch — October 3, 2026

Owner decision (2026-10-03): account configuration must not block the app. The server-side access enforcement written for
the October 2 P0 review (`docs/auth-access-audit-2026-10-02.md`) is kept intact, but it is now controlled by **one**
server-side environment variable.

| `CORPUS_REQUIRE_AUTH` | Behaviour |
| --- | --- |
| unset, empty or anything except `1` / `true` (**default**) | Every page, server function, `/api/bundles` snapshot page and `/api/files` artifact request works **without** a session. Same exposure as the previously deployed site. Sign-in / sign-up / password reset (Lovable's `/auth`, `/reset-password`, sidebar account box) stay available as optional features. |
| `1` or `true` | The verified-account enforcement applies unchanged: every server function, `/api/bundles` and `/api/files` call must carry a provider-verified, confirmed-email, non-anonymous account (`requireCorpusAccess`). The client shows the sign-in card instead of the app until the server admits the browser. |

## Where the switch is read

- `src/lib/auth/accessPolicy.ts` — `corpusAuthRequired()` (the only place the variable name appears).
- `src/lib/auth/access.server.ts` — `requireCorpusAccess()` returns an open-access identity immediately when the switch is off;
  no auth-provider client is created and no credential is read. All callers (`access.middleware.ts`, `/api/files`,
  `/api/bundles`, `getLegalMdlPacket`, snapshot reader) go through this one function.
- `src/lib/auth/access.functions.ts` — `getCorpusSession()` answers the client gate's probe: `{ required: false }` (open) or
  the verified identity.
- `src/components/auth/CorpusAccessGate.tsx` — renders the app as soon as the probe says `required: false`.
  `/auth` and `/reset-password` render outside the gate in both modes.

The variable is server-only. It is never exposed to the browser bundle and there is no development bypass: local development
uses the same switch (unset = open).

## Running

- Local, open (default): `npm run dev`.
- Local, enforced: `CORPUS_REQUIRE_AUTH=1 npm run dev` (needs a working auth project and a confirmed account).
- Deployed: set `CORPUS_REQUIRE_AUTH=true` in the server environment (alongside `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`)
  only after the application auth project has the email provider and redirect URLs configured.

## Tests

`src/lib/auth/access.test.ts` forces the switch **on** inside its enforcement suites (so they pass in either ambient mode)
and has dedicated cases for the off mode (no provider call, no credential read, open identity). The whole suite passes with
the variable unset and with `CORPUS_REQUIRE_AUTH=1`.

## Build note

`npm run build` is plain `vite build` again (as upstream). The Codex legal-database deploy gate needs the corpus service-role
key and is now `npm run build:gated` (`generate-db.ts --check && deploy-gate.mjs && vite build`); run it where those
credentials are available. A build must not require a service-role key.
