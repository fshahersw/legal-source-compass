/** Source-qualified identity comparison only; never a publisher-native merge. */
export function sourceQualifiedDocketKey(value, knownYear) {
 const match=String(value??'').match(/^(\d+):(\d{2,4})-([a-z]+)-0*(\d+)(?:-[A-Z][A-Z0-9-]*)?$/i);
 if(!match)return null;
 let year=match[2];
 if(year.length===2){
  const qualified=typeof knownYear==='number'&&Number.isInteger(knownYear)?String(knownYear):knownYear;
  if(typeof qualified!=='string'||!/^\d{4}$/.test(qualified)||!qualified.endsWith(year))return null;
  year=qualified;
 }
 if(!/^\d{4}$/.test(year))return null;
 // Normalize harmless leading zeros without Number precision loss.
 const sequence=match[4].replace(/^0+(?=\d)/,'');
 return [match[1],year,match[3].toLowerCase(),sequence].join(':');
}

export function exactDocketReferenceCandidates(source,cases) {
 if(!Array.isArray(cases))throw Error('Provider case list is not an array');
 const expected=sourceQualifiedDocketKey(source.docketNumber,source.dateFiled?.slice(0,4));
 const matching=cases.filter(item=>item.court_id===source.court_id&&expected&&sourceQualifiedDocketKey(item.case_number,item.year_filed??item.date_filed?.slice(0,4))===expected);
 const unique=new Map();
 for(const item of matching){
  if(typeof item.id!=='string'||!item.id)throw Error('Matching case lacks provider identity');
  const prior=unique.get(item.id);
  if(prior&&(prior.court_id!==item.court_id||prior.case_number!==item.case_number||String(prior.year_filed??'')!==String(item.year_filed??'')))throw Error('Contradictory repeated provider case identity');
  unique.set(item.id,item);
 }
 const matches=[...unique.values()];
 return {expected,matches,resolution:!expected?'unresolved_source_year':matches.length===1?'unique_exact_reference':matches.length>1?'ambiguous_exact_references':'no_exact_reference',definitive_association_allowed:matches.length===1&&Boolean(expected),publisher_native_merge:false};
}

export function docketSheetMetadataCoverage(caseId,recent,oldest=null) {
 const views=[recent,...(oldest?[oldest]:[])];const documents=new Map();
 for(const view of views){
  if(!Array.isArray(view.documents)||!Number.isInteger(view.entries_returned)||view.entries_returned!==view.documents.length||!Number.isInteger(view.entries_total)||view.entries_total<view.entries_returned||view.entries_total<0)throw Error('Docket sheet count mismatch');
  for(const row of view.documents){
   if(typeof row.id!=='string'||!row.id.startsWith(caseId+'-'))throw Error('Docket document identity mismatch');
   documents.set(row.id,row);
  }
 }
 const totals=views.map(x=>x.entries_total);const sameTotals=totals.every(x=>x===totals[0]);const total=sameTotals?totals[0]:null;
 if(total!==null&&documents.size>total)throw Error('Unique docket metadata exceeds provider total');
 return {documents,unique_document_metadata:documents.size,provider_total:total,provider_totals_consistent:sameTotals,complete:sameTotals&&documents.size===total,missing_metadata:total===null?null:total-documents.size,restricted_metadata_rows:[...documents.values()].filter(x=>x.restricted===true).length,coverage_note:total===null?'Provider total changed between captures':documents.size<total?'Provider end views leave unresolved middle entries':'Every provider-reported metadata entry represented by a native document identity'};
}
