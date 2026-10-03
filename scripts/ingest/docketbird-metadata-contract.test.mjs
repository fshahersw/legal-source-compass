import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceQualifiedDocketKey,exactDocketReferenceCandidates,docketSheetMetadataCoverage}from'./docketbird-metadata-contract.mjs';
const source={court_id:'njd',docketNumber:'2:24-md-03113',dateFiled:'2024-06-07'};
const candidate={id:'njd-2:2024-md-03113',court_id:'njd',case_number:'2:24-md-03113',year_filed:2024};
test('numeric and string publisher years resolve a two-digit source year identically',()=>{
 assert.equal(sourceQualifiedDocketKey('2:24-md-03113',2024),'2:2024:md:3113');
 assert.equal(sourceQualifiedDocketKey('2:24-md-03113','2024'),'2:2024:md:3113');
 assert.equal(exactDocketReferenceCandidates(source,[candidate]).resolution,'unique_exact_reference');
});
test('unknown/mismatched years and missing division/type never acquire a century',()=>{
 for(const year of [null,undefined,1925,'24','2024x',NaN])assert.equal(sourceQualifiedDocketKey('2:24-md-03113',year),null);
 assert.equal(sourceQualifiedDocketKey('24-md-03113',2024),null);
 assert.equal(sourceQualifiedDocketKey('2:2024-03113',2024),null);
 assert.equal(sourceQualifiedDocketKey('2:2024-md-03113',2001),'2:2024:md:3113');
});
test('court/year/division/type/sequence mismatches remain separate',()=>{
 const bad=[{...candidate,court_id:'jpml'},{...candidate,case_number:'0:24-md-03113'},{...candidate,case_number:'2:24-cv-03113'},{...candidate,case_number:'2:24-md-03114'},{...candidate,case_number:'2:2001-md-03113'}];
 assert.equal(exactDocketReferenceCandidates(source,bad).matches.length,0);
});
test('multiple exact provider IDs remain ambiguous and prohibit a definitive association',()=>{
 const result=exactDocketReferenceCandidates(source,[candidate,{...candidate,id:'njd-2:2024-md-03113-distinct'}]);
 assert.equal(result.matches.length,2);assert.equal(result.resolution,'ambiguous_exact_references');assert.equal(result.definitive_association_allowed,false);assert.equal(result.publisher_native_merge,false);
});
test('duplicate identity observations are deduplicated; contradictory repeated IDs stop',()=>{
 assert.equal(exactDocketReferenceCandidates(source,[candidate,{...candidate}]).matches.length,1);
 assert.throws(()=>exactDocketReferenceCandidates(source,[candidate,{...candidate,case_number:'2:2024-md-03113'}]),/Contradictory/);
});
const view=(ids,total)=>({documents:ids.map(id=>({id:'njd-2:2024-md-03113-'+id})),entries_returned:ids.length,entries_total:total});
test('end-view overlap and missing middle records do not become complete coverage',()=>{
 const result=docketSheetMetadataCoverage(candidate.id,view([1,2,3],7),view([3,4,5],7));
 assert.equal(result.unique_document_metadata,5);assert.equal(result.missing_metadata,2);assert.equal(result.complete,false);
});
test('same-total full metadata coverage and zero-row views preserve provider counting grain',()=>{
 const result=docketSheetMetadataCoverage(candidate.id,view([1,2],3),view([2,3],3));assert.equal(result.complete,true);assert.equal(result.missing_metadata,0);
 assert.equal(docketSheetMetadataCoverage(candidate.id,view([],0)).complete,true);
});
test('changed provider totals are held; invalid counts or another-case IDs stop',()=>{
 const result=docketSheetMetadataCoverage(candidate.id,view([1,2],4),view([3],5));assert.equal(result.provider_total,null);assert.equal(result.complete,false);assert.equal(result.missing_metadata,null);
 assert.throws(()=>docketSheetMetadataCoverage(candidate.id,{...view([1],3),entries_returned:2}),/count mismatch/);
 assert.throws(()=>docketSheetMetadataCoverage(candidate.id,view([1,2],1)),/count mismatch/);
 assert.throws(()=>docketSheetMetadataCoverage(candidate.id,{documents:[{id:'jpml-0:2024-md-03113-1'}],entries_returned:1,entries_total:1}),/identity mismatch/);
});
