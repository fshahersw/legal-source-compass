import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceProgressFile,retryTransferFileOperation} from './backfill-pdfs-to-supabase.mjs';
test('a temporary Windows reader lock does not terminate verified PDF work',async()=>{
 let calls=0;const delays=[];await replaceProgressFile('part','progress',{rename:async()=>{if(++calls<3)throw Object.assign(Error('locked'),{code:'EPERM'});},pause:async ms=>delays.push(ms)});assert.equal(calls,3);assert.deepEqual(delays,[30,60]);
});
test('file locks recover within a bounded window and retain the exact failed operation',async()=>{
 let calls=0;await retryTransferFileOperation('receipt_fsync',async()=>{if(++calls<5)throw Object.assign(Error('lock'),{code:'EBUSY'});},{pause:async()=>{}});assert.equal(calls,5);
 calls=0;await assert.rejects(retryTransferFileOperation('progress_snapshot_replace',async()=>{calls++;throw Object.assign(Error('full'),{code:'ENOSPC'});},{pause:async()=>{}}),e=>e.code==='ENOSPC'&&e.operation==='progress_snapshot_replace');assert.equal(calls,1);
});
test('persistent locks stay bounded and data loss errors never retry',async()=>{
 for(const code of ['EBUSY','ENOSPC']){let calls=0;await assert.rejects(replaceProgressFile('part','progress',{rename:async()=>{calls++;throw Object.assign(Error('failed'),{code});},pause:async()=>{}}),e=>e.code===code);assert.equal(calls,code==='EBUSY'?7:1);}
});
