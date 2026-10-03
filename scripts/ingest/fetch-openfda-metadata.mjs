/** Original publisher bulk metadata only; no PDF targets or clinical-event datasets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
if(!args.output)throw new Error('Require a fresh private output directory');
const output=path.resolve(args.output);await fs.mkdir(output,{recursive:true});
const sha256=x=>createHash('sha256').update(x).digest('hex');
async function capture(url,name){
 const u=new URL(url);
 if(u.protocol!=='https:'||!['api.fda.gov','download.open.fda.gov'].includes(u.hostname)||u.username||u.password||/\.pdf(?:$|[?#])/i.test(url))throw new Error('Invalid FDA metadata target');
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw new Error('FDA publisher HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 await fs.writeFile(path.join(output,name),bytes,{flag:'wx'});
 return {source_url:url,file:name,source_sha256:sha256(bytes),bytes:bytes.length,http_status:response.status,retrieved_at:new Date().toISOString()};
}
const original=await capture('https://api.fda.gov/download.json','download-original.json');
const manifest=JSON.parse(await fs.readFile(path.join(output,original.file),'utf8'));
const selected=[['device','enforcement'],['drug','enforcement'],['device','classification'],['device','recall']];
const datasets=[];
for(const [category,endpoint]of selected){
 const source=manifest.results?.[category]?.[endpoint];
 if(!source||!Array.isArray(source.partitions)||!Number.isSafeInteger(source.total_records))throw new Error('Missing bulk dataset');
 const partitions=[];
 for(let i=0;i<source.partitions.length;i++){
  const p=source.partitions[i];
  if(!new URL(p.file).pathname.endsWith('.json.zip'))throw new Error('Only original JSON ZIP partitions are allowed');
  const receipt=await capture(p.file,`${category}-${endpoint}-${String(i+1).padStart(4,'0')}.json.zip`);
  if((await fs.readFile(path.join(output,receipt.file))).subarray(0,4).toString('hex')!=='504b0304')throw new Error('Non-ZIP source bytes');
  partitions.push({...receipt,expected_records:p.records});
  console.log(JSON.stringify({dataset:category+'/'+endpoint,partition:i+1,bytes:receipt.bytes,expected_records:p.records}));
 }
 datasets.push({category,endpoint,export_date:source.export_date,expected_records:source.total_records,partitions});
}
await fs.writeFile(path.join(output,'acquisition-manifest.json'),JSON.stringify({schema_version:'openfda-bulk-metadata-acquisition/1',download_manifest:original,publisher_manifest_last_updated:manifest.meta?.last_updated,datasets,pdf_downloads:0,clinical_event_datasets:0,qualification:'Original dated FDA research metadata. Recall enforcement status is not a current lifecycle finding; no medical-care, case-causation, defect, liability or litigation-membership inference.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({datasets:datasets.length,records:datasets.reduce((s,d)=>s+d.expected_records,0),pdf_downloads:0}));
