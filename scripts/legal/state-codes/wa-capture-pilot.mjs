import fs from 'node:fs/promises';
import {capturePlan} from './wa-capture-core.mjs';

const planPath = process.argv[2] ?? 'private/audit-2026-10-05/full-state-codes/wa/capture-pilot-plan.json';
const outDir = process.argv[3] ?? 'private/audit-2026-10-05/full-state-codes/wa/capture-pilot-20261005';
const privateRoot = 'private/audit-2026-10-05/full-state-codes/wa';
const planBytes = await fs.readFile(planPath);
const plan = JSON.parse(planBytes.toString('utf8'));
const {receipt, receiptPath, receiptSha256} = await capturePlan({plan, planBytes, planPath, outDir, privateRoot});
console.log(JSON.stringify({receiptPath, storedBodies: receipt.storedBodies, storedBytes: receipt.storedBytes, stopped: receipt.stopped, stopReason: receipt.stopReason, unattemptedCount: receipt.unattempted.length, receiptSha256}));
