import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash}from'node:crypto';
import {exactSearchResolution,headerMatches,recordProviderQuota,providerData,validateFirmHit,validatePlanBytes,reserveRpcAttempt,RPC_CEILING,sourceNativeIdentityGroups,candidateSourcesAgree} from './collect-docketbird-recent-expansion.mjs';
const source={court_id:'njd',docketNumber:'2:26-cv-08564',dateFiled:'2026-09-01'};
const native={id:'njd-2:2026-cv-08564',court_id:'njd',case_number:'2:2026-cv-08564',year_filed:2026};
test('incomplete search cannot confer a unique exact association',()=>{
 assert.equal(exactSearchResolution(source,{cases:[native],found:2,next_cursor:'later'}).definitive_association_allowed,false);
 assert.equal(exactSearchResolution(source,{cases:[native],found:1}).definitive_association_allowed,false);
 assert.equal(exactSearchResolution(source,{cases:[native],found:1,next_cursor:null}).definitive_association_allowed,true);
});
test('multiple provider identities for the same qualified docket stay held',()=>{
 const result=exactSearchResolution(source,{cases:[native,{...native,id:'second-native-id'}],found:2,next_cursor:null});
 assert.equal(result.resolution,'ambiguous_exact_references');assert.equal(result.publisher_native_merge,false);assert.equal(result.definitive_association_allowed,false);
});
test('header identity stays native when its docket number is absent and rejects contradictions',()=>{
 const header={id:native.id,court_id:'njd',case_number:null,date_filed:null};
 assert.equal(headerMatches(source,native.id,header),true);assert.equal(header.case_number,null);
 assert.equal(headerMatches(source,native.id,{...header,court_id:'nysd'}),false);
 assert.equal(headerMatches(source,native.id,{...header,id:'different-id'}),false);
 assert.equal(headerMatches(source,native.id,{...header,case_number:'2:2026-cv-08565'}),false);
});
test('provider quota remains tool qualified and zero stops further collection',()=>{
 const state={provider_quota:{}};recordProviderQuota(state,'search_cases',{remaining_today:3});recordProviderQuota(state,'get_case',{remaining_today:22});
 assert.equal(state.provider_quota.search_cases.minimum_observed,3);assert.equal(state.provider_quota.get_case.minimum_observed,22);
 recordProviderQuota(state,'search_cases',{remaining_today:0});assert.equal(state.stop_reason,'PROVIDER_REMAINING_TODAY_ZERO');
 recordProviderQuota(state,'search_cases',{remaining_today:2});assert.equal(state.provider_quota.search_cases.minimum_observed,0);assert.equal(state.stop_reason,'PROVIDER_REMAINING_TODAY_ZERO');
});
test('malformed quota is held, absent quota is not invented, document tools are disallowed',()=>{
 const state={provider_quota:{}};recordProviderQuota(state,'get_case',{});assert.deepEqual(state.provider_quota,{});
 for(const value of[-1,'30',NaN,0.5])assert.throws(()=>recordProviderQuota(state,'get_case',{remaining_today:value}),/INVALID_PROVIDER_QUOTA/);
 assert.equal(state.stop_reason,'INVALID_PROVIDER_QUOTA');assert.throws(()=>recordProviderQuota(state,'get_document',{remaining_today:30}),/DISALLOWED/);
 assert.throws(()=>providerData({isError:true}),/PROVIDER_TOOL_ERROR/);
});
test('a native hit must retain the exact firm query and native-record digest',()=>{
 const data={docket_id:42,docketNumber:source.docketNumber,court_id:'njd',dateFiled:source.dateFiled},p={source_url:'https://www.courtlistener.com/api/rest/v4/search/?q=firm%3A%22Seeger+Weiss%22&type=d',http_status:200,request_method:'GET',retrieved_at:'2026-10-02T13:00:00Z',source_sha256:'a'.repeat(64),record_sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
 const row={source_system:'courtlistener',entity_type:'firm-search-hits',native_id:'42',data,provenance:p};validateFirmHit(row);
 assert.throws(()=>validateFirmHit({...row,data:{...data,docket_id:43}}),/FIRM_QUERY/);
 assert.throws(()=>validateFirmHit({...row,provenance:{...p,source_url:p.source_url.replace('courtlistener.com','evil.example')}}),/FIRM_QUERY/);
 assert.throws(()=>validateFirmHit({...row,provenance:{...p,source_url:'https://www.courtlistener.com/api/rest/v4/search/?q=Seeger+Weiss&type=d'}}),/FIRM_QUERY/);
});
test('execution requires the reviewed external plan digest, not a self asserted hash',()=>{
 const bytes=Buffer.from('{"targets":[]}'),digest=createHash('sha256').update(bytes).digest('hex');
 assert.deepEqual(validatePlanBytes(bytes,digest),{targets:[]});assert.throws(()=>validatePlanBytes(bytes),/EXTERNALLY_PINNED/);assert.throws(()=>validatePlanBytes(Buffer.from('{"targets":[42]}'),digest),/EXTERNALLY_PINNED/);
});
test('request ceiling counts protocol and metadata reservations and stops at the limit',()=>{
 const state={rpc_attempts:0};for(let i=0;i<RPC_CEILING;i++)reserveRpcAttempt(state);assert.equal(state.rpc_attempts,1400);assert.throws(()=>reserveRpcAttempt(state),/RPC_CEILING/);assert.equal(state.rpc_attempts,1400);
 const exhausted={rpc_attempts:19,stop_reason:'PROVIDER_REMAINING_TODAY_ZERO'};assert.throws(()=>reserveRpcAttempt(exhausted),/PROVIDER_REMAINING/);assert.equal(exhausted.rpc_attempts,19);
});
test('all firm-hit native IDs remain distinct when their qualified docket locator is identical',()=>{
 const groups=sourceNativeIdentityGroups([{native_id:'42',data:source},{native_id:'77',data:{...source,docketNumber:'2:2026-cv-008564'}},{native_id:'88',data:{...source,court_id:'nysd'}},{native_id:'99',data:{...source,docketNumber:'26-cv-08564'}}]);
 assert.deepEqual(groups.get('njd|2:2026:cv:8564'),['42','77']);assert.deepEqual(groups.get('nysd|2:2026:cv:8564'),['88']);assert.equal(groups.size,2);
});
test('one provider identity cannot acquire two contradictory source dockets through a missing header number',()=>{
 const a={source},b={source:{...source,docketNumber:'2:26-cv-08565'}};
 assert.equal(candidateSourcesAgree([a,b]),false);assert.equal(candidateSourcesAgree([a,{source:{...source,court_id:'nysd'}}]),false);assert.equal(candidateSourcesAgree([a,{source:{...source,docketNumber:'26-cv-08564'}}]),false);
 assert.equal(candidateSourcesAgree([a,{source:{...source,docketNumber:'2:2026-cv-008564'}}]),true);assert.equal(candidateSourcesAgree([]),false);
});
