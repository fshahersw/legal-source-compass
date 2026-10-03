import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Download ORDER for queued PDFs. This is a scheduling heuristic only: it never asserts MDL membership, a legal
// classification or document importance in any stored record. Evidence-based membership belongs to the matter registry.
export const TIER1_MDLS=[3047,3140,3094,3163,3180,3166,3080,3113,3081,2846,2873,2804,3108,3149,3114,3185,3125,3144,3043,3060,3014,2738,2741,3026];
export const TIER2_MDLS=[2885,2924,2323,2973,2789,2921,2672,2843,2800,3031,2606,2592,2545,2782];
const T1=new Set(TIER1_MDLS),T2=new Set(TIER2_MDLS);
// 1 = Tier 1 (pending MDLs with firm-linked evidence), 2 = Tier 2 (recent/closed but important), 3 = other firm-linked parent matter, 4 = unmapped.
export function tierOfMdl(mdl,{parentMaster=false}={}){return T1.has(mdl)?1:T2.has(mdl)?2:(mdl||parentMaster)?3:4;}
export function parseCsv(text){
 if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}
  else if(c!=='\r')field+=c;
 }
 if(field.length||row.length){row.push(field);rows.push(row);}
 const head=rows.shift();return rows.filter(r=>r.length===head.length).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]])));
}
// The court's own MDL/misc number type in a docket number ("...-md-02738"); nothing is inferred beyond that literal text.
export function mdlFromDocketKey(key){const m=/^[a-z]+-\d+:\d{4}-(?:md|mn)-(\d{5})$/.exec(key??'');return m?Number(m[1]):null;}
const sha=b=>createHash('sha256').update(b).digest('hex');
// Maps native case identities (CourtListener docket ids and DocketBird case keys) to a tier for ordering.
export function buildPriorityMap({registryFile,parentMattersCsv}){
 const registryBytes=fs.readFileSync(registryFile),csvBytes=fs.readFileSync(parentMattersCsv);
 const registry=JSON.parse(registryBytes),parents=parseCsv(csvBytes.toString('utf8'));
 const parentMdl=new Map();
 for(const p of parents){const n=Number(p['MDL number']);if(p.Docket&&Number.isInteger(n)&&n>0)parentMdl.set(p.Docket,n);}
 const byCourtListenerId={},byCaseKey={};
 for(const entry of registry){
  const roles=entry.roles??[],master=roles.some(r=>['master','master_candidate','transferee'].includes(r));
  const own=parentMdl.get(entry.case_key)??mdlFromDocketKey(entry.case_key);
  let mdl=null,basis=null;
  if(own&&master){mdl=own;basis='master_docket_number';}
  else if(Number.isInteger(entry.mdl_number)&&entry.mdl_number>0){mdl=entry.mdl_number;basis='registry_mdl_number';}
  else if(own){mdl=own;basis='docket_number';}
  else for(const id of entry.master_ids??[]){const n=parentMdl.get(id)??mdlFromDocketKey(id);if(n){mdl=n;basis='registry_master_ids';break;}}
  const parentMaster=roles.includes('master')||parentMdl.has(entry.case_key);
  const value={tier:tierOfMdl(mdl,{parentMaster}),mdl,case_key:entry.case_key,basis:basis??(parentMaster?'parent_master_without_mdl_number':null)};
  byCaseKey[entry.case_key]=value;
  for(const id of entry.courtlistener_ids??[])byCourtListenerId[String(id)]=value;
 }
 return{schema_version:'seeger-pdf-priority-map/1',generated_at:new Date().toISOString(),
  ordering_only:'Scheduling heuristic; not an MDL-membership or classification assertion.',
  sources:[{file:registryFile,sha256:sha(registryBytes)},{file:parentMattersCsv,sha256:sha(csvBytes)}],by_courtlistener_id:byCourtListenerId,by_case_key:byCaseKey};
}
export function matterOf(row,map){
 return map.by_courtlistener_id[String(row.native_case_id)]??map.by_case_key[row.native_case_id]??{tier:4,mdl:null,case_key:null,basis:null};
}
// 0 court orders/opinions ... 5 administrative. Title text only; a lower rank is fetched earlier.
export function docRank(title){
 const t=String(title??'').toUpperCase().replace(/\s+/g,' ').trim();
 if(/(NOTICE OF APPEARANCE|ATTORNEY APPEARANCE|MOTION TO APPEAR|PRO HAC VICE|SPECIAL ADMISSION|CERTIFICATE OF SERVICE|CERTIFICATE OF INTERESTED|CORPORATE DISCLOSURE|DISCLOSURE STATEMENT|TRANSCRIPT ORDER|SUMMONS|WAIVER OF SERVICE|MOTION TO WITHDRAW|NOTICE OF WITHDRAWAL|CHANGE OF ADDRESS|NOTICE OF CHANGE|FILED IN '?ERROR|SUBSTITUTION OF COUNSEL|MOTION TO SUBSTITUTE|NOTICE OF SERVICE)/.test(t))return 5;
 if(/SHORT FORM COMPLAINT|COMPLAINT \(SHORT FORM\)/.test(t)&&!/ANSWER|MOTION TO/.test(t))return 3;
 if(/(TRANSFER ORDER|CASE MANAGEMENT ORDER|PRETRIAL ORDER|MEMORANDUM OPINION|MEMORANDUM AND ORDER|MEMORANDUM ORDER|OPINION AND ORDER|\bOPINION\b|FINAL APPROVAL|FINAL JUDGMENT|REPORT AND RECOMMENDATION|DAUBERT)/.test(t))return 0;
 if(/^(?:TEXT ORDER|ORDER|ORDER BY JUDGE|MINUTE ORDER|JUDGMENT|EXPLANATION AND ORDER)\b/.test(t)||/^ORDER\b/.test(t)||/\bORDER\b/.test(t.slice(0,30)))return 0;
 if(/^(?:FIRST |SECOND |THIRD )?(?:AMENDED |MASTER |CONSOLIDATED |CLASS ACTION )?COMPLAINT\b/.test(t)||/SETTLEMENT AGREEMENT|CLASS ACTION SETTLEMENT/.test(t))return 1;
 if(/(MOTION|MEMORANDUM|BRIEF|OPPOSITION|REPLY|RESPONSE|DECLARATION|AFFIDAVIT|APPENDIX|EXHIBIT)/.test(t)&&!/ANSWER/.test(t))return 2;
 return 4;
}
// Deterministic order. Phase 0: Tier 1-2 documents of rank 0-2 (orders/opinions, complaints, motions and briefs); phase 1: the rest of Tier 1-2
// (short-form complaint notices, answers, administrative); phase 2: other firm-linked and unmapped matters. Inside a phase: tier, document
// rank, smaller matter first (more matters finish sooner), newest filing first, locator. Tier 1 therefore precedes Tier 2 for every document class.
const phaseOf=i=>i.matter.tier<=2?(i.rank<=2?0:1):2;
export function orderRows(rows,map){
 const infos=rows.map(row=>({row,matter:matterOf(row,map),rank:docRank(row.title)}));
 const size=new Map();for(const i of infos){const k=i.matter.case_key??('case:'+i.row.native_case_id);size.set(k,(size.get(k)??0)+1);}
 for(const i of infos){i.key=i.matter.case_key??('case:'+i.row.native_case_id);i.size=size.get(i.key);}
 infos.sort((a,b)=>phaseOf(a)-phaseOf(b)||a.matter.tier-b.matter.tier||a.rank-b.rank||a.size-b.size||(a.key<b.key?-1:a.key>b.key?1:0)||String(b.row.filing_date??'').localeCompare(String(a.row.filing_date??''))||(a.row.download_url<b.row.download_url?-1:a.row.download_url>b.row.download_url?1:0));
 return infos;
}
export function summarize(infos){
 const tiers={},ranks={},matters=new Map();
 for(const i of infos){tiers[i.matter.tier]=(tiers[i.matter.tier]??0)+1;ranks[i.rank]=(ranks[i.rank]??0)+1;const k=i.key;const m=matters.get(k)??{case_key:i.matter.case_key,mdl:i.matter.mdl,native_case_id:i.row.native_case_id,tier:i.matter.tier,rows:0};m.rows++;matters.set(k,m);}
 return{tier_counts:tiers,rank_counts:ranks,matters:[...matters.values()].sort((a,b)=>a.tier-b.tier||b.rows-a.rows)};
}
