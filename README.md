# Legal Source Atlas

A searchable U.S. litigation source atlas: courts, judges, matters and MDLs, law and regulation, statutes of limitations, and the source library behind them. Home (`/`) is the map; the source library is `/sources/library`.

Built with [Lovable](https://lovable.dev) (TanStack Start, React, Tailwind, shadcn/ui). Live app: https://legal-source-compass.lovable.app. Edits made in the Lovable editor are committed to this repository and vice versa.

## Data rules

The full rules live in [`AGENTS.md`](./AGENTS.md). In short:

- No fabricated data. Rows come from the protected snapshot bundles (served by `/api/bundles` from private storage; `public/data/` must stay absent) or from the read-only external corpus.
- The website reads the external corpus only through server functions in `src/lib/external/*` and `src/lib/matters/*`. Credentials live only in environment variables and never reach the client or this repository.
- Unknown or uncountable values show as "Not recorded" or "too large to count".

## Development

```sh
bun install
bun run dev        # local dev server
bun run build      # production build
bun run lint       # eslint
bun run test       # vitest (some suites read private/data, which is not in git)
npx tsc --noEmit   # typecheck
```

## Layout

- `src/routes/` file-based routes (`routeTree.gen.ts` is generated).
- `src/components/` UI by area (`atlas`, `corpus`, `matters`, `limitations`, `legal`, `research`, `ui`).
- `src/lib/` domain logic, server functions and tests.
- `scripts/` ingest, admin and verification tooling; `database/contracts/` versioned SQL contracts.
- `docs/` dated evidence and decision records.
