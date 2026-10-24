import {
  Archive,
  Building2,
  CircleHelp,
  Columns3,
  Gavel,
  Landmark,
  LibraryBig,
  MapPinHouse,
  Scale,
  University,
} from "lucide-react";
import type { CourtTypeGroup } from "@/lib/courts/artwork";

/** Generic emblem per recorded court type; always labelled as a court type, never as a seal. */
export const courtTypeIcons = {
  "us-supreme": Landmark,
  "federal-appellate": Columns3,
  "federal-district": University,
  "federal-bankruptcy": Scale,
  "state-high": Landmark,
  "state-appellate": LibraryBig,
  "state-trial": Gavel,
  county: MapPinHouse,
  "local-specialty": Building2,
  historical: Archive,
  unclassified: CircleHelp,
} satisfies Record<CourtTypeGroup, typeof Landmark>;
