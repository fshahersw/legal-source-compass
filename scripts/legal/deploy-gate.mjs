import { adminClient } from './admin-client.mjs';
import { assertDeployReport } from '../../src/lib/legal/deploy.ts';
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/deploy-gate.mjs')) {
  try {
    const report = assertDeployReport(await adminClient(process.env.LEGAL_ATLAS_CREDENTIALS)('corpus_legal_deploy_check_v3', {}));
    console.log(JSON.stringify({ gate: 'legal-atlas-v3', passed: true, counts_by_type: report.counts_by_type }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
