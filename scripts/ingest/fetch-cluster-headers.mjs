import fs from 'node:fs/promises';
import path from 'node:path';
import { CourtListenerClient,DEFAULT_CACHE,sha256 } from './courtlistener-client.mjs';

// Follow only source-supplied cluster resources. This never follows opinion URLs,
// paid PACER endpoints, document links, or a guessed cluster/opinion number.
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const source=path.resolve(args.input??path.join(DEFAULT_CACHE,'identity-normalized','testosterone-native-dockets.jsonl'));
const limit=Number(args.limit??6);
if(!Number.isInteger(limit)||limit<1||limit>12)throw new Error('Bounded cluster-header limit must be 1–12');
const observed=(await fs.readFile(source,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const resources=new Map();
for(const docket of observed){
 for(const resource of docket.data.clusters??[]){
  const url=new URL(resource);
  if(url.origin!=='https://www.courtlistener.com'||!/^\/api\/rest\/v4\/clusters\/\d+\/$/.test(url.pathname))throw new Error('Unverified native cluster resource');
  resources.set(resource,docket.native_id);
 }
}
const targets=[...resources].slice(0,limit);
const client=new CourtListenerClient(DEFAULT_CACHE,limit);
const records=[];let cursor=0;
try{
 await client.initialize();
 const workers=await Promise.allSettled(Array.from({length:3},async()=>{
  while(cursor<targets.length){
   const [url,docketId]=targets[cursor++];const {data,provenance}=await client.request(url);
   if(String(data.id)!==url.match(/\/clusters\/(\d+)\/$/)[1])throw new Error('Native cluster identity mismatch');
   const nativeDocket=data.docket_id??data.docket?.match(/\/dockets\/(\d+)\/$/)?.[1];
   if(String(nativeDocket)!==docketId)throw new Error('Native cluster belongs to another docket');
   for(const opinionResource of data.sub_opinions??[]){
    const opinionUrl=new URL(opinionResource);
    if(opinionUrl.origin!=='https://www.courtlistener.com'||!/^\/api\/rest\/v4\/opinions\/\d+\/$/.test(opinionUrl.pathname))throw new Error('Unverified native sub-opinion resource');
   }
   records.push({schema_version:'courtlistener-rest-v4.7/1',source_system:'courtlistener',entity_type:'clusters',native_id:String(data.id),data,provenance:{...provenance,record_sha256:sha256(JSON.stringify(data)),source_docket_native_id:docketId,selection_reasons:['native_docket_supplied_cluster_resource']}});
  }
 }));
 const failed=workers.find(x=>x.status==='rejected');if(failed)throw failed.reason;
}finally{await client.close();}
records.sort((a,b)=>Number(a.native_id)-Number(b.native_id));
const directory=path.join(DEFAULT_CACHE,'citation-normalized');await fs.mkdir(directory,{recursive:true});
const output=path.join(directory,'clusters.jsonl');const text=records.map(x=>JSON.stringify(x)).join('\n')+'\n';await fs.writeFile(output,text);
const opinions=new Set(records.flatMap(row=>row.data.sub_opinions??[]));
const receipt={schema_version:'native-cluster-header-collection/1',source,observed_source_cluster_resources:resources.size,collected_cluster_headers:records.length,native_sub_opinion_resources:opinions.size,output,sha256:sha256(text),complete_file:true,complete_observed_cluster_scope:records.length===resources.size,pdf_downloads:0,opinion_text_fetches:0};
await fs.writeFile(path.join(DEFAULT_CACHE,'native-cluster-header-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
