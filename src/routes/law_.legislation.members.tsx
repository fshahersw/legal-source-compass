import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/law_/legislation/members")({
  component: () => <Outlet />,
});
