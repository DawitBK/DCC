<#
.SYNOPSIS
  Takes an audit checkpoint of the DCC database and verifies every earlier one against the second place (decision D-06, task L-09).

.DESCRIPTION
  Runs from a checkout that has the built backend (`npm run build -w @dcc/backend`). Writes one checkpoint
  line (events counted, hash of the newest event) to this server's folder AND to the copy folder, then
  verifies every checkpoint against the database. A verify that fails is a SECURITY INCIDENT, not a
  maintenance task: stop, keep the copy, tell the Group CTO.

  The sealing key is read from a file kept WITH THE COPY (for example on the Linux host), never from this
  repository and never from the DCC environment file, so someone who can only edit this server cannot forge a line.

.PARAMETER EnvName
  `.env.mirror` (default) or `.env.production`: which settings file the backend uses.
.PARAMETER CopyDir
  The second place: a folder the DCC database administrators cannot write to (a UNC path to the Linux host's share, or another server's folder).
.PARAMETER LocalDir
  This server's own folder for the checkpoint file.
.PARAMETER KeyFile
  A file holding the sealing key; read through WSL when the path starts with `wsl:` (for example `wsl:~/dcc-audit-checkpoints/seal.key`), else read directly.
.PARAMETER LogFile
  Where the result is appended.

.EXAMPLE
  powershell -File scripts\windows\run-audit-checkpoint.ps1 -CopyDir '\\wsl.localhost\Ubuntu-24.04\home\dawit\dcc-audit-checkpoints\mirror' -KeyFile 'wsl:~/dcc-audit-checkpoints/seal.key' -LocalDir 'C:\DCC-DATA\audit-checkpoints'
#>
param(
  [string] $EnvName = '.env.mirror',
  [Parameter(Mandatory = $true)] [string] $CopyDir,
  [Parameter(Mandatory = $true)] [string] $KeyFile,
  [string] $LocalDir = (Join-Path $env:LOCALAPPDATA 'DCC\audit-checkpoints'),
  [string] $LogFile = (Join-Path $env:LOCALAPPDATA 'DCC\audit-checkpoint.log')
)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile), $LocalDir | Out-Null

function Write-Log([string] $line) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Add-Content -Path $LogFile -Value "$stamp $line"
  Write-Output $line
}

try {
  $key = if ($KeyFile.StartsWith('wsl:')) { (wsl -d Ubuntu-24.04 -- bash -lc ('cat ' + $KeyFile.Substring(4))).Trim() } else { (Get-Content -Raw $KeyFile).Trim() }
  if (-not $key) { throw 'The sealing key could not be read.' }
  $env:DCC_AUDIT_CHECKPOINT_KEY = $key
  $env:DCC_AUDIT_CHECKPOINT_COPY_DIR = $CopyDir
  $env:DCC_AUDIT_CHECKPOINT_DIR = $LocalDir
  Push-Location $repo
  try {
    $script = 'portal/backend/dist/platform/audit/checkpoint-cli.js'
    # Verify first (what was said before must still be true), then add today's line, then verify again.
    $before = & node scripts/run-with-env.mjs $EnvName node $script verify 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Log "VERIFY FAILED BEFORE WRITING: $before"; exit 1 }
    $written = & node scripts/run-with-env.mjs $EnvName node $script write 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Log "WRITE FAILED: $written"; exit 1 }
    $after = & node scripts/run-with-env.mjs $EnvName node $script verify 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Log "VERIFY FAILED AFTER WRITING: $after"; exit 1 }
    Write-Log ("OK: " + (($written -split "`n")[0]).Trim() + ' | ' + ($after.Trim() -split "`n")[-1].Trim())
  } finally {
    Pop-Location
    Remove-Item Env:DCC_AUDIT_CHECKPOINT_KEY -ErrorAction SilentlyContinue
  }
} catch {
  Write-Log "ERROR: $($_.Exception.Message)"
  exit 1
}
