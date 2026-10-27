/**
 * The litigation calculators: four in-page tabs, each built on published official series. Former tab ids (life,
 * state-rates, sources) still open the tab that now holds their content.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CpiByArea } from "./CpiByArea";
import { DamagesInputs } from "./DamagesInputs";
import { InflationCalculator, type InflationDefaults } from "./InflationCalculator";
import { PostJudgmentCalculator, type PjiDefaults } from "./PostJudgmentCalculator";
import { PresentValueCalculator } from "./PresentValueCalculator";
import { StateRatesTable } from "./StateRatesTable";

export const CALCULATOR_TABS = [
  { id: "interest", label: "Judgment interest" },
  { id: "inflation", label: "Inflation" },
  { id: "present-value", label: "Present value" },
  { id: "damages", label: "Damages inputs" },
] as const;
export type CalculatorTab = (typeof CALCULATOR_TABS)[number]["id"];

/** Tab ids used before the four-tab layout, and the tab that now holds their content. */
export const LEGACY_CALCULATOR_TABS: Record<string, CalculatorTab> = {
  life: "damages",
  "state-rates": "interest",
  sources: "damages",
};

/** A tab id from the URL (current or former) as a current tab, or undefined. */
export function calculatorTab(raw: unknown): CalculatorTab | undefined {
  if (typeof raw !== "string") return undefined;
  const current = CALCULATOR_TABS.find((t) => t.id === raw);
  return current ? current.id : LEGACY_CALCULATOR_TABS[raw];
}

export function CalculatorsPage({
  tab,
  onTab,
  pji,
  inflation,
}: {
  tab: CalculatorTab;
  onTab: (tab: CalculatorTab) => void;
  pji?: PjiDefaults;
  inflation?: InflationDefaults;
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as CalculatorTab)} className="min-w-0">
      <div className="overflow-x-auto">
        <TabsList className="h-8">
          {CALCULATOR_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="h-6 px-2 text-[12px]">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="interest">
        {tab === "interest" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <PostJudgmentCalculator {...(pji ? { defaults: pji } : {})} />
            <StateRatesTable />
          </div>
        ) : null}
      </TabsContent>
      <TabsContent value="inflation">
        {tab === "inflation" ? (
          <div className="flex min-w-0 flex-col gap-4">
            <InflationCalculator {...(inflation ? { defaults: inflation } : {})} />
            <CpiByArea />
          </div>
        ) : null}
      </TabsContent>
      <TabsContent value="present-value">
        {tab === "present-value" ? <PresentValueCalculator /> : null}
      </TabsContent>
      <TabsContent value="damages">{tab === "damages" ? <DamagesInputs /> : null}</TabsContent>
    </Tabs>
  );
}
