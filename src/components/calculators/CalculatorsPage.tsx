/** The litigation calculators: in-page tabs (six), each a calculator or table built on published official series. */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EconSourcesPanel } from "./EconSourcesPanel";
import { InflationCalculator, type InflationDefaults } from "./InflationCalculator";
import { LifeExpectancyLookup } from "./LifeExpectancyLookup";
import { PostJudgmentCalculator, type PjiDefaults } from "./PostJudgmentCalculator";
import { PresentValueCalculator } from "./PresentValueCalculator";
import { StateRatesTable } from "./StateRatesTable";

export const CALCULATOR_TABS = [
  { id: "interest", label: "Post-judgment interest" },
  { id: "inflation", label: "Inflation" },
  { id: "present-value", label: "Present value" },
  { id: "life", label: "Life expectancy" },
  { id: "state-rates", label: "State rates" },
  { id: "sources", label: "Sources" },
] as const;
export type CalculatorTab = (typeof CALCULATOR_TABS)[number]["id"];

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
        {tab === "interest" ? <PostJudgmentCalculator {...(pji ? { defaults: pji } : {})} /> : null}
      </TabsContent>
      <TabsContent value="inflation">
        {tab === "inflation" ? (
          <InflationCalculator {...(inflation ? { defaults: inflation } : {})} />
        ) : null}
      </TabsContent>
      <TabsContent value="present-value">
        {tab === "present-value" ? <PresentValueCalculator /> : null}
      </TabsContent>
      <TabsContent value="life">{tab === "life" ? <LifeExpectancyLookup /> : null}</TabsContent>
      <TabsContent value="state-rates">
        {tab === "state-rates" ? <StateRatesTable /> : null}
      </TabsContent>
      <TabsContent value="sources">{tab === "sources" ? <EconSourcesPanel /> : null}</TabsContent>
    </Tabs>
  );
}
