import fs from 'node:fs/promises';
import path from 'node:path';
import { CourtListenerClient, DEFAULT_CACHE } from './courtlistener-client.mjs';
const client=new CourtListenerClient();
try {
 await client.initialize();
 const endpoints=['dockets','docket-entries','recap-documents','courts','people','positions','parties','attorneys','opinions-cited','clusters'];
 let cursor=0;await fs.mkdir(path.join(DEFAULT_CACHE,'schemas'),{recursive:true});
 await Promise.all(Array.from({length:3},async()=>{
  while(cursor<endpoints.length){const name=endpoints[cursor++];const result=await client.request(`https://www.courtlistener.com/api/rest/v4/${name}/`,{method:'OPTIONS'});await fs.writeFile(path.join(DEFAULT_CACHE,'schemas',`${name}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify({endpoint:name,keys:Object.keys(result.data),filters:result.data.filters,fields:Object.keys(result.data.actions?.GET??result.data.actions?.POST??{})}));}
 }));
 const url='https://www.courtlistener.com/api/rest/v4/dockets/?id__in=8408916,6102388,68222905';
 const result=await client.request(url);await fs.writeFile(path.join(DEFAULT_CACHE,'probe-dockets.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({probeRecords:result.data.results?.length,next:result.data.next,ids:result.data.results?.map(x=>x.id),firstFields:Object.keys(result.data.results?.[0]??{})}));
}finally{await client.close();}
