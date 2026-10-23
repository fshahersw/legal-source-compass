import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseMapSearch } from "@/components/places/mapSearch";

// Former address of the map home: the Overview section is "/" (the map's metric and layer are kept).
export const Route = createFileRoute("/overview")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/",
      search: parseMapSearch(location.search as Record<string, unknown>),
      replace: true,
    });
  },
});
