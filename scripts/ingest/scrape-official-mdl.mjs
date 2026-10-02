import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CACHE, sha256 } from './courtlistener-client.mjs';
const cache=DEFAULT_CACHE;
const keys=JSON.parse(await fs.readFile(process.env.CORPUS_INGEST_CREDENTIALS??'C:/Users/firas/.codex/private/legal-source-compass.ingest.json','utf8'));
const briefs=JSON.parse(await fs.readFile('public/data/research/mdl-briefs.json','utf8')).briefs;
const identityAudit=process.argv.includes('--identity-audit');
const identityUrls=['https://www.ohsd.uscourts.gov/multidistrict-litigation-2846','https://www.njd.uscourts.gov/benicar-olmesartan-litigation','https://www.gand.uscourts.gov/17md2782','https://www.ilnd.uscourts.gov/mdl.aspx'];
const urls=identityAudit?identityUrls:[...new Set([
 'https://www.jpml.uscourts.gov/pending-mdls',
 ...briefs.flatMap(x=>[x.directoryUrl,x.ordersUrl]),
 'https://www.jpml.uscourts.gov/pending-mdls-0',
 'https://www.jpml.uscourts.gov/statistics-info',
 'https://www.jpml.uscourts.gov/panel-orders',
 'https://www.jpml.uscourts.gov/hearing-session-orders-archive',
 'https://www.jpml.uscourts.gov/mdl-quarterly-caseload-summary',
 'https://www.njd.uscourts.gov/elmiron-pentosan-polysulfate-sodium-products-liability-litigation',
 'https://www.njd.uscourts.gov/elmiron-case-management-orders',
 'https://cand.uscourts.gov//case-of-interest/in-re-uber-technologies-passenger-sexual-assault-litigation/',
].filter(Boolean))].slice(0,20);
const directory=path.join(cache,'firecrawl');await fs.mkdir(directory,{recursive:true});
const stoppedHosts=new Set();const records=[];
const decode=text=>text.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&nbsp;',' ');
function validateTarget(url){const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.uscourts.gov')||/\.pdf(?:$|[?#])/i.test(u.href))throw new Error('Only official court HTML targets are permitted');return u;}
for(const url of urls){
 const target=validateTarget(url);if(stoppedHosts.has(target.hostname))continue;
 const filename=path.join(directory,`${sha256(url)}.json`);const provenanceFile=filename.replace(/\.json$/,'.provenance.json');
 let raw=await fs.readFile(filename).catch(()=>null);
 const existingProvenance=raw?JSON.parse(await fs.readFile(provenanceFile,'utf8').catch(()=>'null')):null;
 let status=200;
 if(!raw){
  const response=await fetch('https://api.firecrawl.dev/v2/scrape',{method:'POST',headers:{Authorization:`Bearer ${keys.FIRECRAWL_API_KEY}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(90_000),body:JSON.stringify({url,formats:['markdown','html','links'],onlyMainContent:false,maxAge:0,proxy:'basic',parsers:[]})});
  status=response.status;raw=Buffer.from(await response.arrayBuffer());await fs.writeFile(filename,raw);
 }
 const response=JSON.parse(raw.toString());
 if(existingProvenance)status=existingProvenance.http_status;
 const provenance=existingProvenance??{source_url:url,retrieved_at:new Date().toISOString(),http_status:status,source_sha256:sha256(raw),schema_version:'firecrawl-html-inventory/1',collector:'firecrawl-v2',proxy:'basic',pdf_downloads:0};
 const content=response.data??{};const targetStatus=Number(content.metadata?.statusCode??200);
 await fs.writeFile(provenanceFile,JSON.stringify({...provenance,target_status:targetStatus},null,2));
 if(status===429||status===401||status===402||status===403){console.log(JSON.stringify({scope:'firecrawl',status,event:'stop',url}));break;}
 if(targetStatus===403||targetStatus===429||/robots.*(?:denied|blocked|disallowed)/i.test(String(response.error??''))){stoppedHosts.add(target.hostname);console.log(JSON.stringify({scope:'target',status:targetStatus,event:'host_stop',url}));continue;}
 if(!response.success||targetStatus>=400){console.log(JSON.stringify({url,status,targetStatus,error:response.error??null}));continue;}
 const labels=new Map();
 for(const anchor of String(content.html??'').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  try{const href=new URL(decode(anchor[1]),url).href;const label=decode(anchor[2].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();if(label)labels.set(href,label);}catch{}
 }
 const links=[...new Set((content.links??[]).map(link=>typeof link==='string'?link:link.url).filter(Boolean))].map(href=>{try{const u=new URL(href,url);return {url:u.href,label:labels.get(u.href)??null,is_pdf_url:/\.pdf(?:$|[?#])/i.test(u.href),availability:'not_independently_verified'};}catch{return null;}}).filter(Boolean);
 const data={title:content.metadata?.title??null,source_url:url,resolved_url:content.metadata?.url??content.metadata?.sourceURL??url,published_at:content.metadata?.publishedTime??null,links,markdown:content.markdown??null};
 const record={schema_version:'firecrawl-html-inventory/1',source_system:'official-court',entity_type:identityAudit?'mdl-identity-source-pages':'mdl-source-pages',native_id:sha256(url),data,provenance:{...provenance,record_sha256:sha256(JSON.stringify(data)),target_status:targetStatus}};
 records.push(record);console.log(JSON.stringify({url,status:targetStatus,links:links.length,pdfURLs:links.filter(x=>x.is_pdf_url).length,bytes:raw.length}));
}
const dest=path.join(cache,identityAudit?'identity-normalized':'live-normalized',identityAudit?'mdl-identity-source-pages.jsonl':'mdl-source-pages.jsonl');await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,records.map(x=>JSON.stringify(x)).join('\n')+'\n');
await fs.writeFile(path.join(cache,identityAudit?'firecrawl-identity-manifest.json':'firecrawl-manifest.json'),JSON.stringify({pages:records.length,pdf_urls:records.reduce((a,b)=>a+b.data.links.filter(x=>x.is_pdf_url).length,0),stopped_hosts:[...stoppedHosts],attempt_cap:20,pdf_downloads:0,output:dest},null,2));
