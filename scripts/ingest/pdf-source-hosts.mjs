// Which source hosts each batch runner owns. A row aimed at any other host is never fetched by that runner.
// Official court hosts (*.uscourts.gov, jpml, govinfo.gov) belong to the official-mdl agent, which honors each site's robots.txt
// Crawl-delay (www.njd.uscourts.gov: 10 s) - far slower than the 1 request/s this pipeline paces CourtListener storage at.
export const RUNNER_HOSTS = {
  courtlistener: { hosts: ['storage.courtlistener.com'], skip_reason: 'non_courtlistener_host' },
  docketbird: { hosts: ['docketbird-case-documents.s3.amazonaws.com'], skip_reason: 'non_docketbird_host' }
};
// Queue rows of every provider except DocketBird are consumed by the CourtListener runner.
export const runnerFamilyOf = provider => (provider === 'docketbird' ? 'docketbird' : 'courtlistener');
export function sourceHostOf(row) {
  try { return new URL(String(row?.download_url)).hostname.toLowerCase(); } catch { return null; }
}
export function hostAllowed(row, allowedHosts) {
  const host = sourceHostOf(row);
  return host !== null && allowedHosts.includes(host);
}
export const hostAllowedForFamily = (row, family = runnerFamilyOf(row?.provider)) => hostAllowed(row, RUNNER_HOSTS[family].hosts);
