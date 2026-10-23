import {
  BookOpen,
  Bookmark,
  Building2,
  ChartLine,
  Gavel,
  Landmark,
  LayoutDashboard,
  Library,
  MapPinned,
  PackageSearch,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { NavigationSection } from "@/lib/atlas/navigation";

/** One clear icon per section (lucide), the same in the sidebar, the icon rail, the drawer and the hubs. */
export const SECTION_ICONS: Record<NavigationSection, LucideIcon> = {
  overview: LayoutDashboard,
  places: MapPinned,
  courts: Landmark,
  litigation: Gavel,
  law: BookOpen,
  enforcement: ShieldAlert,
  safety: PackageSearch,
  companies: Building2,
  insights: ChartLine,
  sources: Library,
  saved: Bookmark,
};
