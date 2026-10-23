import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Former preview of the state legislation panel and the originating-bill box. Both are mounted now: the panel on the
 * state page (its Law section), the box on public-law record pages. A code that is not two letters opens Legislation.
 */
export const Route = createFileRoute("/prototypes/legislation/$state")({
  beforeLoad: ({ params }) => {
    const usps = params.state.toUpperCase();
    if (/^[A-Z]{2}$/.test(usps))
      throw redirect({ to: "/places/$state", params: { state: usps }, replace: true });
    throw redirect({ to: "/law/legislation", replace: true });
  },
});
