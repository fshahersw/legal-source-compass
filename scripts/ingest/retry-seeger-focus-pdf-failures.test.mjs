import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isPermanentFailure,outcomes,lines} from './retry-seeger-focus-pdf-failures.mjs';

test('permanent source answers are never retried, transient and legacy generic failures are',()=>{
 for(const error of ['SOURCE_HTTP_404','SOURCE_HTTP_403','SOURCE_HTTP_410','NOT_A_PDF','SOURCE_SHA1_MISMATCH','CLOUD_HASH_MISMATCH'])assert.equal(isPermanentFailure({state:'failed',error}),true,error);
 for(const error of ['SOURCE_HTTP_503','CLOUD_UPLOAD_HTTP_520','TRANSFER_OR_INTEGRITY_FAILURE','NETWORK_ERROR','SOURCE_TIMEOUT'])assert.equal(isPermanentFailure({state:'failed',error}),false,error);
 // An explicit flag from the Oct 3 worker wins over the legacy error-code rule.
 assert.equal(isPermanentFailure({state:'failed',error:'SOURCE_HTTP_503',retryable:false}),true);
 assert.equal(isPermanentFailure({state:'failed',error:'SOURCE_HTTP_404',retryable:true}),false);
});

test('the latest outcome per document decides: a later verification clears an earlier failure, a failure never undoes a verification',()=>{
 const r=(state,id,extra={})=>({provider:'courtlistener-public-locator',native_document_id:id,state,...extra});
 const map=outcomes([r('failed','a',{error:'SOURCE_HTTP_503'}),r('failed','b',{error:'NOT_A_PDF'}),r('failed','c',{error:'NETWORK_ERROR'}),r('cloud_verified','c'),r('cloud_verified','d'),r('failed','d',{error:'SOURCE_HTTP_503'}),r('download_pending','e')]);
 const get=id=>map.get('courtlistener-public-locator|'+id);
 assert.deepEqual(get('a'),{verified:false,error:'SOURCE_HTTP_503',permanent:false,at:undefined});
 assert.deepEqual(get('b'),{verified:false,error:'NOT_A_PDF',permanent:true,at:undefined});
 assert.equal(get('c').verified,true);assert.equal(get('d').verified,true);assert.equal(get('e'),undefined);
});

test('only complete JSONL lines are read from a receipts file that is still being appended',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'retry-')),'r.jsonl');
 fs.writeFileSync(file,'{"a":1}\n{"b":2}\n{"c":');
 assert.deepEqual(lines(file),[{a:1},{b:2}]);
 assert.deepEqual(lines(file+'.missing'),[]);
});

test('merging transfer directories keeps the most recent failure regardless of directory order',()=>{
 const old={provider:'courtlistener',native_document_id:'1',state:'failed',error:'TRANSFER_OR_INTEGRITY_FAILURE',recorded_at:'2026-10-02T10:00:00.000Z'};
 const newer={provider:'courtlistener',native_document_id:'1',state:'failed',error:'SOURCE_SHA1_MISMATCH',retryable:false,recorded_at:'2026-10-03T10:00:00.000Z'};
 const map=new Map();outcomes([newer],map);outcomes([old],map);
 assert.equal(map.get('courtlistener|1').error,'SOURCE_SHA1_MISMATCH');assert.equal(map.get('courtlistener|1').permanent,true);
});
