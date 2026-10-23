import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/law_/uscode")({
  component: () => <Outlet />,
});
