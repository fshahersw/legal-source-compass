import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyticsClient, captureSnapshot } from './collect.mjs';
import { requireValue, MonitorError, atomicJson } from '../regulatory/core.mjs';

export function parseArgs(args) {
  const [command, ...rest] = args; requireValue(['capture', 'land', 'daily'].includes(command), 'COMMAND_INVALID');
  const options = {};
  for (const arg of rest) { const match = arg.match(/^--(output|through|seed|execute)(?:=(.*))?$/); requireValue(match && !Object.hasOwn(options, match[1]), 'ARGUMENT_INVALID'); requireValue(match[1] === 'execute' ? match[2] === undefined : typeof match[2] === 'string' && match[2].length > 0, 'ARGUMENT_INVALID'); options[match[1]] = match[1] === 'execute' ? true : match[2]; }
  requireValue(typeof options.output === 'string', 'OUTPUT_REQUIRED');
  requireValue(/(?:^|[\\/])private(?:[\\/]|$)/i.test(path.resolve(options.output)), 'PRIVATE_DIRECTORY_REQUIRED');
  requireValue(command === 'capture' || options.execute === true, 'EXECUTE_REQUIRED');
  requireValue(command !== 'land' || options.through === undefined, 'ARGUMENT_INVALID');
  requireValue(!options.seed || (command !== 'land' && /(?:^|[\\/])private(?:[\\/]|$)/i.test(path.resolve(options.seed))), 'PRIVATE_SEED_REQUIRED');
  return { command, ...options };
}
export async function main(args = process.argv.slice(2)) {
  const opts = parseArgs(args); const directory = path.resolve(opts.output);
  if (opts.command !== 'land') await captureSnapshot({ directory, through: opts.through, client: analyticsClient({ directory, seedDirectory: opts.seed }) });
  if (opts.command !== 'capture') {
    const { assertPublishableSnapshot, cloudClient, publishSnapshot } = await import('./cloud.mjs');
    const snapshot = JSON.parse(await fs.readFile(path.join(directory, 'snapshot.json'), 'utf8'));
    assertPublishableSnapshot(snapshot);
    const receipt = await publishSnapshot({ snapshot, directory, cloud: cloudClient() });
    await atomicJson(path.join(directory, 'landing-receipt.json'), receipt); console.log(JSON.stringify(receipt));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(JSON.stringify({ error: error instanceof MonitorError ? error.code : 'FDA_ANALYTICS_FAILED' })); process.exitCode = 1; });
