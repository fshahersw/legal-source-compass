[CmdletBinding()]
param(
 [string]$PlanLiteralPath = 'C:\Users\firas\OneDrive\Documents\ChatGPT\corpusss\private\seeger-weiss-cleanup-inventory-20261002\exact-duplicate-candidates.jsonl',
 [string]$ReceiptRoot = 'C:\Users\firas\.codex\private\seeger-weiss-cleanup-receipts-20261002',
 [switch]$Execute
)

# The human authorized bulk garbage removal. This script only removes the exact,
# pinned 88 byte-identical metadata copies after validation and durable aliases.
# Default invocation performs validation/preparation; -Execute performs deletion.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PinnedPlanSha256 = '88e6ca0b2182f2cc5b94e2b36127d5b630d52b7faee6b7d91b240be73c3a8e2e'
$PinnedPlanBytes = 177619
$PinnedRowCount = 88
$DownloadsRoots = @(
 'C:\Users\firas\Downloads\MATTER-ETL-BATCH-PIPELINE',
 'C:\Users\firas\Downloads\SW-BULK\catalog',
 'C:\Users\firas\Downloads\SW-BULK\AWS-BATCH1-DOCKETS',
 'C:\Users\firas\Downloads\SW-BULK\publiclaw_registry_v2',
 'C:\Users\firas\Downloads\SW-BULK\corpus',
 'C:\Users\firas\Downloads\SW-BULK\recap-pdfs',
 'C:\Users\firas\Downloads\SW-BULK\catalog_test',
 'C:\Users\firas\Downloads\SW-BULK\registry',
 'C:\Users\firas\Downloads\SW-BULK\stateurls',
 'C:\Users\firas\Downloads\SW-BULK\_archive',
 'C:\Users\firas\Downloads\SW-BULK\_staging',
 'C:\Users\firas\Downloads\SW-BULK\source_gap_reconciliation_2026-08-22',
 'C:\Users\firas\Downloads\SW-BULK\daubert_scan',
 'C:\Users\firas\Downloads\SW-BULK\phase2_source_catalog_v1_2026-08-22',
 'C:\Users\firas\Downloads\SW-BULK\phase1_directory_contract_v3_2026-08-22',
 'C:\Users\firas\Downloads\Seeger_Weiss_Enriched_Sou',
 'C:\Users\firas\Downloads\Seeger_Weiss_Enriched_Source_Registry_v4'
) | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
$Utf8NoBom = [Text.UTF8Encoding]::new($false)

function Get-AbsoluteLiteralPath([string]$LiteralPath) {
 if ($LiteralPath -notmatch '^[A-Za-z]:[\\/]' -or $LiteralPath -match '[*?]' -or $LiteralPath.Substring(2).Contains(':')) { throw 'Absolute local literal file path required.' }
 return [IO.Path]::GetFullPath($LiteralPath)
}

function Assert-NoReparseAncestors([string]$LiteralPath) {
 $cursor = Get-AbsoluteLiteralPath $LiteralPath
 while ($cursor) {
  if (Test-Path -LiteralPath $cursor) {
   $item = Get-Item -LiteralPath $cursor -Force
   if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point rejected.' }
  }
  $next = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
  if ($next -eq $cursor) { break }
  $cursor = $next
 }
}

function Assert-DownloadsBoundary([string]$LiteralPath) {
 $absolute = Get-AbsoluteLiteralPath $LiteralPath
 foreach ($root in $DownloadsRoots) {
  if ($absolute.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { return }
 }
 throw 'File is outside explicitly named Downloads roots.'
}

function Get-RegularLiteralFile([string]$LiteralPath) {
 $absolute = Get-AbsoluteLiteralPath $LiteralPath
 Assert-NoReparseAncestors $absolute
 $resolved = Resolve-Path -LiteralPath $absolute
 if ($resolved.Provider.Name -ne 'FileSystem') { throw 'Filesystem provider required.' }
 $item = Get-Item -LiteralPath $resolved.ProviderPath -Force
 if ($item -isnot [IO.FileInfo] -or $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Regular file required.' }
 return $item
}

function Get-VerifiedContent([string]$LiteralPath, [string]$ExpectedSha, [long]$ExpectedBytes) {
 $before = Get-RegularLiteralFile $LiteralPath
 $hash = (Get-FileHash -LiteralPath $before.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
 $after = Get-RegularLiteralFile $LiteralPath
 if ($before.Length -ne $after.Length -or $before.LastWriteTimeUtc.Ticks -ne $after.LastWriteTimeUtc.Ticks) { throw 'File changed while hashing.' }
 if ($after.Length -ne $ExpectedBytes -or $hash -cne $ExpectedSha) { throw 'Pinned file checksum or byte count mismatch.' }
 return [PSCustomObject]@{ Path = $after.FullName; Sha256 = $hash; Bytes = $after.Length; LastWriteTimeUtc = $after.LastWriteTimeUtc.ToString('o') }
}

function Assert-ExternalReceiptPath([string]$LiteralPath) {
 $absolute = Get-AbsoluteLiteralPath $LiteralPath
 foreach ($root in $DownloadsRoots) {
  if ($absolute.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $absolute.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Receipts must stay outside target roots.' }
 }
 Assert-NoReparseAncestors $absolute
 return $absolute
}

$plan = Get-VerifiedContent $PlanLiteralPath $PinnedPlanSha256 $PinnedPlanBytes
$rows = @([IO.File]::ReadAllLines($plan.Path, $Utf8NoBom) | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
if ($rows.Count -ne $PinnedRowCount) { throw 'Pinned plan row count mismatch.' }
$targets = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$keepers = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$validated = [Collections.Generic.List[object]]::new()
$ordinal = 0
foreach ($row in $rows) {
 $ordinal += 1
 if ($row.schema_version -cne 'exact-metadata-file-duplicate-candidate/1' -or $row.classification -cne 'byte_identical_metadata_export_copy' -or $row.status -cne 'candidate_only_root_revalidate_then_alias_receipt_before_delete' -or $row.delete_authorization_executed -ne $false -or $row.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $row.bytes -le 0) { throw 'Invalid candidate qualification.' }
 $targetPath = Get-AbsoluteLiteralPath $row.delete_candidate_path
 $keeperPath = Get-AbsoluteLiteralPath $row.retained_canonical_path
 Assert-DownloadsBoundary $targetPath
 Assert-DownloadsBoundary $keeperPath
 if ($targetPath.Equals($keeperPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Candidate equals retained canonical file.' }
 if (-not $targets.Add($targetPath)) { throw 'Repeated candidate path.' }
 [void]$keepers.Add($keeperPath)
 $target = Get-VerifiedContent $targetPath $row.sha256 ([long]$row.bytes)
 $keeper = Get-VerifiedContent $keeperPath $row.sha256 ([long]$row.bytes)
 $alias = $row.required_alias
 if ($alias.original_file_uri -cne $row.source_file_uri -or $alias.retained_file_uri -cne $row.retained_canonical_file_uri -or $alias.original_file_sha256 -cne $row.sha256 -or $alias.retained_file_sha256 -cne $row.sha256 -or $alias.original_file_bytes -ne $row.bytes -or $alias.retained_file_bytes -ne $row.bytes -or $alias.payload_or_record_identity_merge_allowed -ne $false -or $alias.original_occurrence_provenance_preserved -ne $true) { throw 'Original occurrence alias mismatch.' }
 $originalUri = [Uri]$alias.original_file_uri
 $retainedUri = [Uri]$alias.retained_file_uri
 if ($originalUri.Scheme -cne 'file' -or $retainedUri.Scheme -cne 'file' -or -not (Get-AbsoluteLiteralPath $originalUri.LocalPath).Equals($target.Path, [StringComparison]::OrdinalIgnoreCase) -or -not (Get-AbsoluteLiteralPath $retainedUri.LocalPath).Equals($keeper.Path, [StringComparison]::OrdinalIgnoreCase)) { throw 'Alias file URI/path mismatch.' }
 $validated.Add([PSCustomObject]@{ Ordinal = $ordinal; Target = $target; Keeper = $keeper; Original = $row })
}
foreach ($keeper in $keepers) { if ($targets.Contains($keeper)) { throw 'A retained canonical file is also a deletion target.' } }

# Persist the exact pinned plan and every original occurrence alias externally
# before the first destructive operation. Each execution uses a new receipt file.
$externalRoot = Assert-ExternalReceiptPath $ReceiptRoot
New-Item -ItemType Directory -Path $externalRoot -Force | Out-Null
$runId = [Guid]::NewGuid().ToString()
$runDirectory = Join-Path $externalRoot ('run-' + $runId)
New-Item -ItemType Directory -Path $runDirectory | Out-Null
[void](Assert-ExternalReceiptPath $runDirectory)
$savedPlanPath = Join-Path $runDirectory 'pinned-deletion-plan.jsonl'
Copy-Item -LiteralPath $plan.Path -Destination $savedPlanPath
$durablePlanStream = [IO.FileStream]::new($savedPlanPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
try { $durablePlanStream.Flush($true) } finally { $durablePlanStream.Dispose() }
[void](Get-VerifiedContent $savedPlanPath $PinnedPlanSha256 $PinnedPlanBytes)
$aliasPath = Join-Path $runDirectory 'source-file-aliases.jsonl'
$aliasLines = foreach ($entry in $validated) {
 [ordered]@{ schema_version = 'retained-source-file-alias/1'; run_id = $runId; plan_sha256 = $PinnedPlanSha256; original_occurrence_alias = $entry.Original.required_alias; source_version_or_release = $entry.Original.source_version_or_release; source_pointer_impact = $entry.Original.source_pointer_impact; alias_status = 'validated_before_specific_file_deletion' } | ConvertTo-Json -Depth 20 -Compress
}
[IO.File]::WriteAllLines($aliasPath, [string[]]$aliasLines, $Utf8NoBom)
$durableAliasStream = [IO.FileStream]::new($aliasPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
try { $durableAliasStream.Flush($true) } finally { $durableAliasStream.Dispose() }
$aliasSha256 = (Get-FileHash -LiteralPath $aliasPath -Algorithm SHA256).Hash.ToLowerInvariant()
$receiptPath = Join-Path $runDirectory 'execute-receipt.jsonl'
$stream = [IO.FileStream]::new($receiptPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read, 4096, [IO.FileOptions]::WriteThrough)
$writer = [IO.StreamWriter]::new($stream, $Utf8NoBom)
$writer.AutoFlush = $true
function Write-DurableReceipt([object]$Value) {
 $writer.WriteLine(($Value | ConvertTo-Json -Depth 20 -Compress))
 $writer.Flush()
 $stream.Flush($true)
}
$deleted = 0
$deletedBytes = [long]0
try {
 Write-DurableReceipt ([ordered]@{ event = 'full_plan_prepared'; run_id = $runId; utc = [DateTime]::UtcNow.ToString('o'); plan_sha256 = $PinnedPlanSha256; candidate_count = $validated.Count; external_alias_sha256 = $aliasSha256; deletion_enabled = [bool]$Execute })
 foreach ($entry in $validated) {
  # Revalidate both literal paths immediately before each specific deletion.
  Assert-DownloadsBoundary $entry.Target.Path
  Assert-DownloadsBoundary $entry.Keeper.Path
  $freshTarget = Get-VerifiedContent $entry.Target.Path $entry.Original.sha256 ([long]$entry.Original.bytes)
  $freshKeeper = Get-VerifiedContent $entry.Keeper.Path $entry.Original.sha256 ([long]$entry.Original.bytes)
  Write-DurableReceipt ([ordered]@{ event = 'prepared'; run_id = $runId; ordinal = $entry.Ordinal; utc = [DateTime]::UtcNow.ToString('o'); target = $freshTarget; retained_canonical = $freshKeeper; alias_manifest_sha256 = $aliasSha256 })
  if (-not $Execute) { continue }
  try {
   Remove-Item -LiteralPath $freshTarget.Path -Force -ErrorAction Stop
   if (Test-Path -LiteralPath $freshTarget.Path) { throw 'Target remains after removal.' }
   $finalKeeper = Get-VerifiedContent $freshKeeper.Path $entry.Original.sha256 ([long]$entry.Original.bytes)
   $deleted += 1
   $deletedBytes += [long]$entry.Original.bytes
   Write-DurableReceipt ([ordered]@{ event = 'deleted'; run_id = $runId; ordinal = $entry.Ordinal; utc = [DateTime]::UtcNow.ToString('o'); original_file_uri = $entry.Original.source_file_uri; original_sha256 = $entry.Original.sha256; deleted_bytes = $entry.Original.bytes; retained_canonical = $finalKeeper })
  } catch {
   Write-DurableReceipt ([ordered]@{ event = 'stopped_unknown_or_failed_outcome'; run_id = $runId; ordinal = $entry.Ordinal; utc = [DateTime]::UtcNow.ToString('o'); original_file_uri = $entry.Original.source_file_uri; error_type = $_.Exception.GetType().FullName })
   throw 'Specific-file deletion stopped; inspect its external receipt before resuming.'
  }
 }
 foreach ($keeperPath in $keepers) {
  $entry = $validated | Where-Object { $_.Keeper.Path.Equals($keeperPath, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
  [void](Get-VerifiedContent $keeperPath $entry.Original.sha256 ([long]$entry.Original.bytes))
 }
 Write-DurableReceipt ([ordered]@{ event = 'complete'; run_id = $runId; utc = [DateTime]::UtcNow.ToString('o'); deleted_files = $deleted; deleted_bytes = $deletedBytes; final_retained_keeper_count = $keepers.Count; all_final_keepers_rehashed = $true; validation_only = -not [bool]$Execute })
} finally {
 $writer.Dispose()
 $stream.Dispose()
}
[ordered]@{ status = $(if ($Execute) { 'deleted_exact_duplicates' } else { 'validated_only' }); validated_files = $validated.Count; deleted_files = $deleted; deleted_bytes = $deletedBytes; receipt_directory = $runDirectory; plan_sha256 = $PinnedPlanSha256; alias_sha256 = $aliasSha256 } | ConvertTo-Json -Compress
