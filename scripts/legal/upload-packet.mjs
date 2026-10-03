import fs from 'node:fs';
import crypto from 'node:crypto';
import { adminClient } from './admin-client.mjs';
import { mdlPacket } from '../../src/lib/legal/packets.ts';
const [packetPath, credentials, approvalPath] = process.argv.slice(2);
const packet = mdlPacket.parse(JSON.parse(fs.readFileSync(packetPath, 'utf8')));
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const digest = hash(packet);
const run = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
const rows = packet.records.map(record => ({ input_key: hash(record), source_name: record.source_name, source_year: record.date_type === 'retrieved' ? null : Number(record.date.slice(0,4)), raw: record, candidates: [record], errors: [] }));
const manifest = { schema_version: packet.schema_version, scope: 'MDL-2738 reviewed official source packet', packet_sha256: digest, complete: false };
const result = await adminClient(credentials)('corpus_legal_stage_v3', { p_run: run, p_manifest: manifest, p_rows: rows });
if (result.received !== rows.length || result.accepted_candidates !== rows.length) throw Error('Packet staging acknowledgement mismatch');
// Separate source review is required. This file scopes promotion to the exact
// reviewed payload hashes; the intake RPC itself never approves records.
fs.writeFileSync(approvalPath, `begin;\nupdate legal_atlas.records set review_status='approved' where input_key in (${rows.map(r => `'${r.input_key}'`).join(',')}) and review_status='pending';\nupdate legal_atlas.ingest_runs set status='awaiting_audit',finished_at=now() where run_id='${run}';\ncommit;\nselect count(*) as reviewed_packet_records from legal_atlas.records where input_key in (${rows.map(r => `'${r.input_key}'`).join(',')}) and review_status='approved';\n`);
console.log(JSON.stringify({ ...result, packet_sha256: digest, approval_file: approvalPath }));
