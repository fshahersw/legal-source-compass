import fs from 'node:fs/promises';
import path from 'node:path';
import { CourtListenerClient, DEFAULT_CACHE } from './courtlistener-client.mjs';
const masters=JSON.parse(await fs.readFile('private/data/mdl-documents/master-dockets.json','utf8'));
const client=new CourtListenerClient(DEFAULT_CACHE,30);const results=[];
try{
 await client.initialize();
 let cursor=0;const ids=Object.keys(masters).map(Number);
 const workers=await Promise.allSettled(Array.from({length:3},async()=>{
  while(cursor<ids.length){
   const id=ids[cursor++];const response=await client.request(`https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=${id}&count=on`);
   if(!Number.isInteger(response.data.count))throw new Error('Count response missing exact count');
   results.push({docket_id:id,mdl_number:masters[id],entries:response.data.count,pages_at_20:Math.ceil(response.data.count/20),provenance:response.provenance});
   console.log(JSON.stringify({docket_id:id,mdl_number:masters[id],entries:response.data.count}));
  }
 }));
 const failed=workers.find(x=>x.status==='rejected');if(failed)throw failed.reason;
 results.sort((a,b)=>a.entries-b.entries);const report={sources:results,complete_counts:results.length===ids.length,total_entries:results.reduce((a,b)=>a+b.entries,0),total_pages_at_20:results.reduce((a,b)=>a+b.pages_at_20,0),pdf_downloads:0};
 await fs.writeFile(path.join(DEFAULT_CACHE,'master-scope-counts.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await client.close();}
