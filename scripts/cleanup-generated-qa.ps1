# Manual cleanup prepared at the user's request. This script has NOT been run.
# Keeps source, screenshots/logs, Nox VMs/backups, APK 92 and APK 94.
[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$taskArtifactRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../artifacts')).Path
$taskNames = @(
  'filter-native91-android', 'filter-native91-ios',
  'music-filter-fix90-android', 'music-filter-fix90-ios',
  'music-filter-fix-android', 'music-filter-fix-ios',
  'deletion-fix-android', 'deletion-fix-ios',
  'ui-inbox-mobile-export', 'landmarks-android-export', 'landmarks-ios-export',
  'CampusMate-3.1.3-88-deletion.apk',
  'CampusMate-3.1.3-90-music-filter-deletion.apk',
  'CampusMate-3.1.3-91-filter-native.apk'
)
foreach ($taskName in $taskNames) {
  $taskPath = Join-Path $taskArtifactRoot $taskName
  if (!(Test-Path -LiteralPath $taskPath)) { continue }
  $taskResolved = (Resolve-Path -LiteralPath $taskPath).Path
  if (!$taskResolved.StartsWith($taskArtifactRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside artifacts' }
  if ((Get-Item -LiteralPath $taskResolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Link target refused' }
  if ($PSCmdlet.ShouldProcess($taskResolved, 'Remove generated QA output')) {
    Remove-Item -LiteralPath $taskResolved -Recurse -Force
  }
}
$taskQaRoot = 'C:\Temp\CampusMate-QA-92'
foreach ($taskName in @('android', 'ios', 'ios-expo-go.bundle')) {
  $taskPath = Join-Path $taskQaRoot $taskName
  if (!(Test-Path -LiteralPath $taskPath)) { continue }
  $taskResolved = (Resolve-Path -LiteralPath $taskPath).Path
  if (!$taskResolved.StartsWith($taskQaRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside QA directory' }
  if ($PSCmdlet.ShouldProcess($taskResolved, 'Remove generated QA output')) {
    Remove-Item -LiteralPath $taskResolved -Recurse -Force
  }
}
Get-PSDrive C,D | Select-Object Name,Used,Free
