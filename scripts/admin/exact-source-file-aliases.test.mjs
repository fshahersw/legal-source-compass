import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadExactSourceFileAliases,validateExactSourceURI} from './exact-source-file-aliases.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('exact occurrence URI excludes traversal, query, remote, and other roots',()=>{
 assert.match(validateExactSourceURI('file:///C:/Users/firas/Downloads/SW-BULK/catalog/masters.jsonl'),/masters\.jsonl$/);
 for(const uri of ['file:///C:/Users/firas/Downloads/SW-BULK/catalog/../registry/masters.jsonl','file:///C:/Users/firas/Downloads/SW-BULK/catalog/..\\registry/masters.jsonl','file:///C:/Users/firas/Downloads/SW-BULK/catalog/%2e%2e/registry/masters.jsonl','file:///C:/Users/firas/Downloads/SW-BULK/catalog/%2fmasters.jsonl','file:///C:/Users/firas/Downloads/SW-BULK/catalog/masters.jsonl:stream','file:///C:/Users/firas/Downloads/SW-BULK/catalog/masters.jsonl?token=value','file:///C:/Users/firas/.codex/private/masters.jsonl','https://example.com/masters.jsonl'])assert.throws(()=>validateExactSourceURI(uri));
});
const directory='C:/Users/firas/.codex/private/seeger-weiss-cleanup-receipts-20261002/run-32d3ccb8-d4a4-4046-a084-a0a5d2e4586b';
let exists=true;try{await fs.access(directory);}catch{exists=false;}
test('completed pinned cleanup receipt resolves only exact SHA and byte-identical retained file',{skip:!exists},async()=>{
 const aliasManifestPath=directory+'/source-file-aliases.jsonl',executeReceiptPath=directory+'/execute-receipt.jsonl';
 const aliasBytes=await fs.readFile(aliasManifestPath),receiptBytes=await fs.readFile(executeReceiptPath);const options={aliasManifestPath,executeReceiptPath,aliasManifestSha256:sha(aliasBytes),executeReceiptSha256:sha(receiptBytes)};
 const resolver=await loadExactSourceFileAliases(options);assert.equal(resolver.aliasCount,88);const a=JSON.parse(aliasBytes.toString('utf8').split('\n')[0]).original_occurrence_alias;
 const resolved=await resolver.resolve({originalFileURI:a.original_file_uri,sourceFileSha256:a.original_file_sha256,sourceFileBytes:a.original_file_bytes});
 assert.equal(resolved.originalOccurrenceFileURI,a.original_file_uri);assert.equal(resolved.resolvedFileURI,a.retained_file_uri);assert.equal(resolved.aliasApplied,true);assert.equal(resolved.publisherIdentityMergeAllowed,false);assert.equal(resolved.executeReceiptSha256,sha(receiptBytes));
 await assert.rejects(()=>resolver.resolve({originalFileURI:a.original_file_uri,sourceFileSha256:'0'.repeat(64),sourceFileBytes:a.original_file_bytes}));
 await assert.rejects(()=>resolver.resolve({originalFileURI:a.original_file_uri,sourceFileSha256:a.original_file_sha256,sourceFileBytes:a.original_file_bytes+1}));
 await assert.rejects(()=>loadExactSourceFileAliases({...options,aliasManifestSha256:'0'.repeat(64)}));
 await assert.rejects(()=>loadExactSourceFileAliases({...options,executeReceiptSha256:'0'.repeat(64)}));
});
