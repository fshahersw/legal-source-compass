import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const ALLOWED_HOSTS = new Set(['leg.wa.gov', 'lawfilesext.leg.wa.gov']);
export const MAX_REQUESTS = 100;
export const MIN_DELAY_MS = 1000;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isInside = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

export function validateCapturePlan(plan, {outDir, privateRoot, cwd = process.cwd()} = {}) {
  if (!plan || !Array.isArray(plan.requests) || plan.requests.length === 0) throw new Error('Capture plan must contain at least one exact observed URL.');
  if (plan.requests.length > MAX_REQUESTS) throw new Error(`Capture plan exceeds ${MAX_REQUESTS} requests.`);
  if (!Number.isSafeInteger(plan.maxObjectBytes) || !Number.isSafeInteger(plan.maxTotalBytes) || plan.maxObjectBytes <= 0 || plan.maxTotalBytes <= 0) throw new Error('Capture plan needs positive object and total body caps.');
  const resolvedOutDir = path.resolve(cwd, outDir ?? '');
  const resolvedPrivateRoot = path.resolve(cwd, privateRoot ?? '');
  if (!outDir || !privateRoot || resolvedOutDir === path.parse(resolvedOutDir).root || !isInside(resolvedPrivateRoot, resolvedOutDir)) throw new Error('Output directory must be a nonempty new path inside the Washington private audit root.');
  const ids = new Set();
  const outputPaths = new Set();
  const requests = plan.requests.map((item, index) => {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(item.id)) throw new Error(`Unsafe or missing request id at index ${index}.`);
    if (ids.has(item.id.toLowerCase())) throw new Error(`Duplicate request id: ${item.id}`);
    ids.add(item.id.toLowerCase());
    if (typeof item.url !== 'string') throw new Error(`Missing URL for request ${item.id}.`);
    let url;
    try { url = new URL(item.url); } catch { throw new Error(`Invalid URL for request ${item.id}.`); }
    if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) throw new Error(`Unapproved protocol or publisher host for request ${item.id}.`);
    const bodyPath = path.join(resolvedOutDir, 'raw', `${item.id}.body`);
    if (outputPaths.has(bodyPath)) throw new Error(`Duplicate output path for request ${item.id}.`);
    outputPaths.add(bodyPath);
    return {...item, _parsedUrl: url, _bodyPath: bodyPath};
  });
  const requestedDelay = plan.delayMs;
  const delayMs = Number.isFinite(requestedDelay) ? Math.max(MIN_DELAY_MS, Math.trunc(requestedDelay)) : MIN_DELAY_MS;
  const timeoutMs = Number.isSafeInteger(plan.timeoutMs) && plan.timeoutMs > 0 ? plan.timeoutMs : 45000;
  return {requests, resolvedOutDir, resolvedPrivateRoot, delayMs, timeoutMs};
}

export async function ensureOutputDirectoryUnused(outDir, privateRoot) {
  try {
    await fs.lstat(outDir);
    throw new Error(`Refusing to overwrite existing evidence directory ${outDir}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parent = path.dirname(outDir);
  const stat = await fs.stat(parent);
  if (!stat.isDirectory()) throw new Error(`Output parent is not a directory: ${parent}`);
  const realPrivateRoot = await fs.realpath(privateRoot);
  const realParent = await fs.realpath(parent);
  if (!isInside(realPrivateRoot, realParent) && realPrivateRoot !== realParent) throw new Error('Output parent resolves outside the Washington private audit root.');
}

export function stopReasonFor(record) {
  if (record.outcome === 'transport-error' || record.outcome === 'redirect-rejected' || record.outcome === 'streamed-body-over-cap' || record.outcome === 'declared-body-over-cap' || record.outcome === 'storage-error') return record.outcome;
  if (record.outcome === 'http-non-200' && (record.status === 401 || record.status === 403 || record.status === 429 || (record.status >= 500 && record.status <= 599))) return `http-${record.status}`;
  return null;
}

async function writeAttemptJournal(journalPath, record) {
  await fs.appendFile(journalPath, JSON.stringify(record) + '\n', {encoding: 'utf8'});
}

export async function capturePlan({plan, planBytes, planPath, outDir, privateRoot, fetchImpl = fetch, sleepImpl = (ms) => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date().toISOString()}) {
  const validated = validateCapturePlan(plan, {outDir, privateRoot});
  const {requests, resolvedOutDir, delayMs, timeoutMs} = validated;
  await ensureOutputDirectoryUnused(resolvedOutDir, validated.resolvedPrivateRoot);
  await fs.mkdir(resolvedOutDir);
  const rawDir = path.join(resolvedOutDir, 'raw');
  await fs.mkdir(rawDir);
  const copiedPlanPath = path.join(resolvedOutDir, 'capture-plan.json');
  await fs.writeFile(copiedPlanPath, planBytes, {flag: 'wx'});
  const journalPath = path.join(resolvedOutDir, 'request-journal.jsonl');
  const journal = await fs.open(journalPath, 'wx');
  await journal.close();

  const startedAt = now();
  const results = [];
  let storedBytes = 0;
  let stopReason = null;
  for (let i = 0; i < requests.length; i++) {
    const item = requests[i];
    const record = {id: item.id, label: item.label ?? null, url: item.url, discovery: item.discovery ?? null, startedAt: now()};
    try {
      const response = await fetchImpl(item._parsedUrl, {redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: {'user-agent': 'LegalSourceAtlas public-source capture pilot (contact: source provenance project)'}});
      const finalUrl = new URL(response.url || item.url);
      if (!ALLOWED_HOSTS.has(finalUrl.hostname.toLowerCase()) || !['http:', 'https:'].includes(finalUrl.protocol)) {
        await response.body?.cancel().catch(() => {});
        record.finalUrl = response.url || null;
        record.status = response.status;
        record.outcome = 'redirect-rejected';
        record.error = `Redirect left approved publisher hosts/protocols: ${finalUrl.host}`;
      } else {
        record.finalUrl = response.url || item.url;
        record.status = response.status;
        record.contentType = response.headers.get('content-type');
        record.contentLengthHeader = response.headers.get('content-length');
        record.etag = response.headers.get('etag');
        record.lastModified = response.headers.get('last-modified');
        if (response.status !== 200) {
          await response.body?.cancel().catch(() => {});
          record.outcome = 'http-non-200';
        } else {
          const declared = Number(record.contentLengthHeader);
          if (Number.isFinite(declared) && declared > plan.maxObjectBytes) {
            await response.body?.cancel().catch(() => {});
            record.outcome = 'declared-body-over-cap';
            record.bytesObservedBeforeStop = 0;
          } else {
            const chunks = [];
            let bytes = 0;
            let overCap = false;
            for await (const chunk of response.body ?? []) {
              bytes += chunk.length;
              if (bytes > plan.maxObjectBytes || storedBytes + bytes > plan.maxTotalBytes) { overCap = true; break; }
              chunks.push(chunk);
            }
            if (overCap) {
              await response.body?.cancel().catch(() => {});
              record.outcome = 'streamed-body-over-cap';
              record.bytesObservedBeforeStop = bytes;
            } else {
              const body = Buffer.concat(chunks);
              record.bytes = body.length;
              record.sha256 = sha256(body);
              record.rawPath = `${path.relative(process.cwd(), item._bodyPath).replaceAll('\\', '/')}`;
              try {
                await fs.writeFile(item._bodyPath, body, {flag: 'wx'});
                storedBytes += body.length;
                record.outcome = 'captured';
              } catch (error) {
                record.outcome = 'storage-error';
                record.error = String(error?.message ?? error).slice(0, 500);
                record.rawPath = null;
              }
            }
          }
        }
      }
    } catch (error) {
      record.outcome = 'transport-error';
      record.error = String(error?.message ?? error).slice(0, 500);
    }
    record.completedAt = now();
    results.push(record);
    await writeAttemptJournal(journalPath, record);
    console.log(JSON.stringify({id: record.id, outcome: record.outcome, bytes: record.bytes ?? record.bytesObservedBeforeStop ?? 0, status: record.status ?? null}));
    stopReason = stopReasonFor(record);
    if (stopReason) break;
    if (i + 1 < requests.length) await sleepImpl(delayMs);
  }
  const unattempted = requests.slice(results.length).map(item => ({id: item.id, label: item.label ?? null, url: item.url, reason: stopReason ? 'not-attempted-after-stop' : 'not-attempted'}));
  const receipt = {
    schemaVersion: 2,
    startedAt,
    completedAt: now(),
    planPath,
    planSha256: sha256(planBytes),
    limits: {maxRequests: MAX_REQUESTS, maxObjectBytes: plan.maxObjectBytes, maxTotalBytes: plan.maxTotalBytes, minDelayMs: MIN_DELAY_MS, effectiveDelayMs: delayMs, timeoutMs},
    count: results.length,
    requestedCount: requests.length,
    storedBodies: results.filter(x => x.outcome === 'captured').length,
    storedBytes,
    stopped: Boolean(stopReason),
    stopReason,
    requestJournalPath: path.relative(process.cwd(), journalPath).replaceAll('\\', '/'),
    unattempted,
    results
  };
  const receiptPath = path.join(resolvedOutDir, 'receipt.json');
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  return {receipt, receiptPath, receiptSha256: sha256(await fs.readFile(receiptPath))};
}
