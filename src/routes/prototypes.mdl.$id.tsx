import { createFileRoute, redirect } from "@tanstack/react-router";

// Former MDL dossier prototype: its trajectory, momentum, peers and product-signal parts are on the MDL command page.
// The prototype component (src/components/prototypes/MdlDossierPrototype.tsx) is kept, unrouted.
export const Route = createFileRoute("/prototypes/mdl/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/matters/$id", params: { id: params.id }, replace: true });
  },
});
