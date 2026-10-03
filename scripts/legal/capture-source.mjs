import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [destination,...urls]=process.argv.slice(2);
if(!destination||!urls.length)throw Error('Usage: capture-source.mjs DESTINATION URL...');
fs.mkdirSync(destination,{recursive:true});
for(const value of urls){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('Expected a public HTTPS source');
 const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error(`Source HTTP ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());const sha256=createHash('sha256').update(bytes).digest('hex');
 const receipt={source_url:value,final_url:response.url,retrieved_at:new Date().toISOString(),http_status:response.status,content_type:response.headers.get('content-type'),sha256,bytes:bytes.length};
 const ext=receipt.content_type?.includes('pdf')?'.pdf':'.html';
 const target=path.join(destination,sha256+ext);if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{flag:'wx'});
 fs.writeFileSync(path.join(destination,sha256+'.provenance.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 const links=ext==='.html'?[...bytes.toString('utf8').matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(m=>new URL(m[1],response.url).href).filter(h=>/\.pdf|iframe|2738|talc|order|j-j|table|embed/i.test(h)):[];
 console.log(JSON.stringify({...receipt,file:target,links:[...new Set(links)]}));
}
