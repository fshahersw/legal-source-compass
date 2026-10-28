import { useQuery } from "@tanstack/react-query";
import { nationalQuery } from "@/components/courts/caseload/caseloadQueries";
import { ChartCard } from "@/components/kit/ChartCard";
import { LineTrend } from "@/components/charts/LineTrend";
import { metricFormatter } from "@/components/charts/format";
import { clearanceRows } from "./clearanceRate";

export function ClearanceRateChart() {
  const query = useQuery(nationalQuery);
  const rows = clearanceRows(query.data?.years ?? []).slice(-20);
  const latest = rows.at(-1);
  const axis = { keys: rows.map((r) => String(r.fy)), label: (k: string) => `FY${k}`, tick: (k: string) => k };
  const counts = metricFormatter("count"), percent = metricFormatter("percent");
  const source = { source: { label: "Federal Judicial Center, Integrated Database", href: "https://www.fjc.gov/research/idb/civil-cases-filed-terminated-and-pending-sy-1988-present" },
    period: rows.length ? `FY${rows[0]?.fy}–FY${latest?.fy}` : undefined,
    about: <p>Terminations divided by filings, multiplied by 100. A ratio above 100% means more terminations than filings in the same fiscal year, not a direct measure of backlog or efficiency. Partial years are excluded; missing years remain gaps.</p> };
  return <ChartCard id="civil-clearance" title={latest?.rate !== null && latest?.rate !== undefined ? `FY${latest.fy}: ${percent.full(latest.rate)} civil clearance ratio` : "Civil filings and terminations"}
    subtitle="Federal civil cases · complete fiscal years" source={source}
    state={query.isPending ? "loading" : query.isError ? "error" : !rows.length ? "empty" : "ready"}
    onRetry={() => void query.refetch()} height={340}
    data={{ title: "Civil filings, terminations and clearance ratio", rows, rowKey: (r) => String(r.fy),
      columns: [{key:"fy",label:"Fiscal year",value:(r)=>r.fy},{key:"filings",label:"Filings (cases)",value:(r)=>r.filings},{key:"terminations",label:"Terminations (cases)",value:(r)=>r.terminations},{key:"rate",label:"Clearance (%)",value:(r)=>r.rate}], source }}>
    <div className="space-y-3">
      <div><p className="text-meta text-muted-foreground">Filings and terminations · cases</p>
        <LineTrend axis={axis} formatter={counts} height={180} ariaLabel="Federal civil filings and terminations by fiscal year" series={[
          {id:"filings",label:"Filings",points:rows.map((r)=>({key:String(r.fy),value:r.filings}))},
          {id:"terminations",label:"Terminations",points:rows.map((r)=>({key:String(r.fy),value:r.terminations}))}]} /></div>
      <div className="border-t border-border pt-2"><p className="text-meta text-muted-foreground">Clearance ratio · 100% = equal flows</p>
        <LineTrend axis={axis} formatter={percent} height={150} ariaLabel="Civil clearance ratio with a 100 percent equal-flows reference" colorSlot={(_id,i)=>i===0?2:3} series={[
          {id:"clearance",label:"Clearance",points:rows.map((r)=>({key:String(r.fy),value:r.rate}))},
          {id:"reference",label:"Equal flows",points:rows.map((r)=>({key:String(r.fy),value:100,partial:true}))}]} /></div>
    </div>
  </ChartCard>;
}