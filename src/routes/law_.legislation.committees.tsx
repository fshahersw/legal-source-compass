import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/law_/legislation/committees")({
  component: () => <Outlet />,
});
