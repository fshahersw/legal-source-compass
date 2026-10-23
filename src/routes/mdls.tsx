import { createFileRoute, redirect } from "@tanstack/react-router";
import { MDLS_REDIRECT_SEARCH } from "@/lib/atlas/legacyRoutes";

// Former MDL list: the JPML MDL collection in the matters browser (Litigation › MDLs & mass torts).
export const Route = createFileRoute("/mdls")({
  beforeLoad: () => {
    throw redirect({ to: "/matters", search: { ...MDLS_REDIRECT_SEARCH }, replace: true });
  },
});
