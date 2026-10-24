/** Decorative header photos per sidebar section (generic architecture, never presented as a specific institution's mark). */
import courts from "@/assets/headers/courts.jpg";
import law from "@/assets/headers/law.jpg";
import litigation from "@/assets/headers/litigation.jpg";
import enforcement from "@/assets/headers/enforcement.jpg";
import places from "@/assets/headers/places.jpg";
import companies from "@/assets/headers/companies.jpg";
import safety from "@/assets/headers/safety.jpg";
import insights from "@/assets/headers/insights.jpg";

export const SECTION_BACKDROPS: Partial<Record<string, string>> = {
  courts,
  law,
  litigation,
  enforcement,
  places,
  companies,
  safety,
  insights,
};
