import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compareDocketIdentity} from './refresh-priority-dockets.mjs';

const expected = {mdl:'1234',id:'42',key:'cand:4:2022-md-01234'};
function record(changes = {}) {
  const data = {id:42,resource_uri:'https://www.courtlistener.com/api/rest/v4/dockets/42/',
    court:'https://www.courtlistener.com/api/rest/v4/courts/cand/',
    docket_number:'4:22-md-01234',blocked:false,date_blocked:null,...changes};
  return {source_system:'courtlistener',entity_type:'dockets',native_id:'42',
    schema_version:'courtlistener-rest-v4.7/1',data,
    provenance:{schema_version:'courtlistener-rest-v4.7/1',
      source_url:data.resource_uri,http_status:200,retrieved_at:'2026-10-05T07:00:00Z',
      source_sha256:'a'.repeat(64),record_sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')}};
}
test('matches the full court, office, year, case type and sequence',()=>{
  assert.equal(compareDocketIdentity(expected,record()).identity_matches,true);
  for(const changes of [{court:'https://www.courtlistener.com/api/rest/v4/courts/cacd/'},
    {docket_number:'3:22-md-01234'},{docket_number:'4:21-md-01234'},
    {docket_number:'4:22-cv-01234'},{docket_number:'4:22-md-01235'}])
    assert.equal(compareDocketIdentity(expected,record(changes)).identity_matches,false);
});
test('keeps source blocked, date-blocked and unknown states closed',()=>{
  for(const changes of [{blocked:true},{date_blocked:'2026-10-04'},{blocked:null}])
    assert.equal(compareDocketIdentity(expected,record(changes)).blocked,true);
});
test('rejects tampered payloads and mismatched native resources',()=>{
  const r=record();r.data.docket_number='4:22-md-09999';
  assert.throws(()=>compareDocketIdentity(expected,r),/payload/);
  assert.throws(()=>compareDocketIdentity(expected,record({id:43})),/identity/);
});
