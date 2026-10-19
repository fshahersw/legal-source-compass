import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/law_/regulations")({
  component: () => <Outlet />,
});
