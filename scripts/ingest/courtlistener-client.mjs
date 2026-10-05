import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_CACHE = path.resolve('../audit/2026-10-02/metadata');
export const API_ORIGIN = 'https://www.courtlistener.com';
export const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const allowedEndpoints = new Set(['search','dockets','docket-entries','recap-documents','courts','clusters','opinions','opinions-cited','people','positions','retention-events','educations','schools','political-affiliations','sources','aba-ratings','parties','attorneys','originating-court-information','fjc-integrated-database','bankruptcy-information']);

async function readOptional(filename) {
  try { return await fs.readFile(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Fail closed on a torn pair or changed bytes; a cache hit is source evidence. */
function verifyCachedResponse(bytes, provenance, url, method) {
  if (provenance?.source_url !== url || provenance.request_method !== method
      || provenance.http_status !== 200 || provenance.schema_version !== 'courtlistener-rest-v4.7/1'
      || !Number.isFinite(Date.parse(provenance.retrieved_at))
      || provenance.source_sha256 !== sha256(bytes)) throw new Error('CACHE_EVIDENCE_MISMATCH');
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('CACHE_EVIDENCE_INVALID_JSON'); }
}

async function writeImmutable(filename, bytes) {
  try { await fs.writeFile(filename, bytes, {flag: 'wx'}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await fs.readFile(filename)).equals(bytes)) throw new Error('CACHE_ARCHIVE_READBACK_MISMATCH');
}

/** Deduplicate exact bytes while retaining every distinct retrieval receipt. */
async function archiveResponse(cache, bytes, provenance) {
  const raw = path.join(cache, 'api', 'raw');
  const observations = path.join(cache, 'api', 'observations');
  await fs.mkdir(raw, {recursive: true});
  await fs.mkdir(observations, {recursive: true});
  const receipt = Buffer.from(JSON.stringify(provenance));
  await writeImmutable(path.join(raw, `${provenance.source_sha256}.json`), bytes);
  await writeImmutable(path.join(observations, `${sha256(receipt)}.json`), receipt);
}

export class CourtListenerClient {
  constructor(cache=DEFAULT_CACHE, maxRequests=450) { this.cache=cache; this.maxRequests=maxRequests; this.requests=0; this.queue=Promise.resolve(); }
  async initialize() {
    await fs.mkdir(path.join(this.cache,'api'),{recursive:true});
    this.keys=JSON.parse(await fs.readFile(process.env.CORPUS_INGEST_CREDENTIALS ?? 'C:/Users/firas/.codex/private/legal-source-compass.ingest.json','utf8'));
    const lock=path.join(this.cache,'api-collector.lock');
    await fs.mkdir(lock).catch(async(error)=>{
      if(error.code!=='EEXIST')throw error;
      const owner=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));
      try{process.kill(owner.pid,0);throw new Error('Another API collector holds the global rate lock.');}
      catch(check){if(check.code!=='ESRCH')throw check;}
      // Only two known lock artifacts are removed after the recorded process is
      // confirmed gone; no recursive or computed workspace deletion is used.
      await fs.unlink(path.join(lock,'owner.json'));await fs.rmdir(lock);await fs.mkdir(lock);
    });
    this.lock=lock;await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
    this.ledger=JSON.parse(await fs.readFile(path.join(this.cache,'rate-ledger.json'),'utf8').catch(()=>'{"timestamps":[]}'));
    this.initialUsage=await this.usage();
    this.limits=this.initialUsage.current_usage.filter(x=>x.scope==='user');
    if(!this.limits.length || this.limits.some(x=>x.blocked)) throw new Error('CourtListener API user scope unavailable or blocked');
    const inspectedAt=Date.now();
    this.baseline=this.limits.map(x=>({...x, checkedAt:inspectedAt, used:Math.max(0,x.used-this.ledger.timestamps.filter(t=>t>inspectedAt-x.window_seconds*1000).length)}));
    console.log(JSON.stringify({scope:'courtlistener',verifiedLimits:this.limits.map(x=>({rate:x.rate,remaining:x.remaining})),requestBudget:this.maxRequests}));
    return this;
  }
  async close(){
    if(!this.lock)return;
    // Remove only this process's two known lock artifacts; never recurse through
    // a computed cache directory or remove a replacement process's lock.
    const owner=JSON.parse(await fs.readFile(path.join(this.lock,'owner.json'),'utf8'));
    if(owner.pid!==process.pid)throw new Error('Refusing to release another collector\'s rate lock');
    await fs.unlink(path.join(this.lock,'owner.json'));await fs.rmdir(this.lock);this.lock=null;
  }
  async usage(){
    const response=await fetch(`${API_ORIGIN}/api/rest/v4/api-usage/`,{headers:{Authorization:`Token ${this.keys.COURTLISTENER_API_KEY}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw new Error(`Usage API ${response.status}`);
    const body=await response.json();await fs.writeFile(path.join(this.cache,'usage-latest.json'),JSON.stringify(body,null,2));return body;
  }
  validate(url,method){
    const target=new URL(url);
    if(target.origin!==API_ORIGIN||target.username||target.password)throw new Error('Refusing credential host mismatch');
    const match=target.pathname.match(/^\/api\/rest\/v4\/([^/]+)\//);
    if(!match||!allowedEndpoints.has(match[1])||!['GET','OPTIONS'].includes(method))throw new Error('Only read-only, metadata endpoints are permitted');
    return target;
  }
  async reserve(){
    const work=this.queue.then(async()=>{
      if(this.stopped)throw new Error(this.stopped);
      if(this.requests>=this.maxRequests){this.stopped='REQUEST_BUDGET_REACHED';throw new Error(this.stopped);}
      while(true){
        if(this.stopped)throw new Error(this.stopped);
        const now=Date.now();this.ledger.timestamps=this.ledger.timestamps.filter(t=>t>now-86_400_000);
        let delay=0;
        for(const limit of this.baseline){
          const windowMs=limit.window_seconds*1000;
          const recent=this.ledger.timestamps.filter(t=>t>now-windowMs);
          // Existing request history has unknown individual dates: charge it for a
          // full rolling window after inspection. Keep a small safety reserve.
          const initial=now-limit.checkedAt<windowMs?limit.used:0;
          const safety=limit.window_seconds===60?5:limit.window_seconds===3600?30:20;
          if(recent.length+initial>=Math.max(1,limit.limit-safety))delay=Math.max(delay,recent.length?Math.max(250,recent[0]+windowMs-now+200):limit.checkedAt+windowMs-now+200);
        }
        if(delay>60_000){this.stopped=`RATE_WINDOW_DEFERRED Retry-After=${Math.ceil(delay/1000)}`;throw new Error(this.stopped);}
        if(delay>0){if(!this.lastRateLog||now-this.lastRateLog>15_000){this.lastRateLog=now;console.log(JSON.stringify({event:'rate_wait',seconds:Math.ceil(delay/1000)}));}await sleep(delay);continue;}
        // Optional pacing (CL_MIN_GAP_MS): the 2026-10-03 service run was stopped by a 429 (Retry-After=1) after four requests inside one second; a minimum gap
        // between requests removes the burst without changing the ledger limits.
        const minGap=Number(process.env.CL_MIN_GAP_MS??0);
        if(minGap>0&&this.lastRequestAt&&now-this.lastRequestAt<minGap){await sleep(minGap-(now-this.lastRequestAt));continue;}
        this.lastRequestAt=now;
        this.ledger.timestamps.push(now);await fs.writeFile(path.join(this.cache,'rate-ledger.json'),JSON.stringify(this.ledger));this.requests++;return;
      }
    });this.queue=work.catch(()=>{});return work;
  }
  async request(url,{method='GET',refresh=false}={}){
    this.validate(url,method);const key=sha256(`${method} ${url}`);const filename=path.join(this.cache,'api',`${key}.json`);const provenanceFile=path.join(this.cache,'api',`${key}.provenance.json`);
    if(this.stopped)throw new Error(this.stopped);
    const existing=await readOptional(filename), existingReceipt=await readOptional(provenanceFile);
    if(Boolean(existing)!==Boolean(existingReceipt))throw new Error('CACHE_EVIDENCE_MISSING_PAIR');
    if(existing){
      let provenance;
      try { provenance=JSON.parse(existingReceipt.toString('utf8')); }
      catch { throw new Error('CACHE_EVIDENCE_INVALID_RECEIPT'); }
      const data=verifyCachedResponse(existing,provenance,url,method);
      if(!refresh)return {data,provenance,cached:true};
      // Preserve the previous successful pair before any attempt to replace it.
      await archiveResponse(this.cache,existing,provenance);
    }
    await this.reserve();
    const response=await fetch(url,{method,headers:{Authorization:`Token ${this.keys.COURTLISTENER_API_KEY}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(120_000)});
    const bytes=Buffer.from(await response.arrayBuffer());
    const provenance={source_url:url,retrieved_at:new Date().toISOString(),http_status:response.status,source_sha256:sha256(bytes),schema_version:'courtlistener-rest-v4.7/1',request_method:method};
    await fs.appendFile(path.join(this.cache,'request-log.jsonl'),JSON.stringify({...provenance,bytes:bytes.length})+'\n');
    if(response.status===429){const retry=response.headers.get('retry-after');await fs.writeFile(path.join(this.cache,'throttle-stop.json'),JSON.stringify({url,status:429,retryAfter:retry,at:provenance.retrieved_at}));this.stopped=`RATE_LIMIT_STOP Retry-After=${retry??'not supplied'}`;throw new Error(this.stopped);}
    if(response.status===401||response.status===403){this.stopped=`AUTHORIZATION_STOP ${response.status} ${url}`;throw new Error(this.stopped);}
    if(!response.ok)throw new Error(`HTTP ${response.status} ${url}`);
    let data;try{data=JSON.parse(bytes.toString());}catch{throw new Error(`Non-JSON metadata response ${url}`);}
    if(response.status!==200)throw new Error(`Unexpected metadata status ${response.status}`);
    await archiveResponse(this.cache,bytes,provenance);
    await fs.writeFile(filename,bytes);await fs.writeFile(provenanceFile,JSON.stringify(provenance,null,2));
    return {data,provenance,cached:false};
  }
  async paginate(url,entityType,sink,{maxPages=1000,onPage}={}){
    let next=url,pages=0,records=0;const seen=new Set();
    while(next){
      if(pages>=maxPages)return {records,pages,next,complete:false};
      if(seen.has(next))throw new Error('Repeated cursor');seen.add(next);
      const {data,provenance}=await this.request(next);
      if(!Array.isArray(data.results))throw new Error(`Expected paginated results ${next}`);
      for(const item of data.results){
        if(item.id===undefined||item.id===null)throw new Error(`Missing native ID in ${entityType}`);
        await sink({schema_version:'courtlistener-rest-v4.7/1',source_system:'courtlistener',entity_type:entityType,native_id:String(item.id),data:item,provenance:{...provenance,record_sha256:sha256(JSON.stringify(item))}});records++;
      }
      pages++;next=data.next??null;
      // Observations have already been saved. Checkpoint their next cursor now,
      // before a later request can fail and leave the scope counter behind.
      if(onPage)await onPage({records,pages,next,complete:next===null});
    }
    return {records,pages,next:null,complete:true};
  }
}
