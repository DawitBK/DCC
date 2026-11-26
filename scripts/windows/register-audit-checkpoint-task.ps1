<#
.SYNOPSIS
  Registers the daily audit checkpoint job (task L-09) as a Windows scheduled task for the current user.

.DESCRIPTION
  Runs `run-audit-checkpoint.ps1` once a day (default 18:30, after the evening backup) and again 10 minutes
  after every sign-in, so a missed run is made up. The job needs no password: it runs as the person who
  registers it, hidden, only while that person is signed in.

.EXAMPLE
  powershell -File scripts\windows\register-audit-checkpoint-task.ps1 -TaskName DCC-Mirror-Audit-Checkpoint -CopyDir '\\wsl.localhost\Ubuntu-24.04\home\dawit\dcc-audit-checkpoints\mirror' -KeyFile 'wsl:~/dcc-audit-checkpoints/seal.key'
#>
param(
  [string] $TaskName = 'DCC-Audit-Checkpoint',
  [string] $EnvName = '.env.mirror',
  [Parameter(Mandatory = $true)] [string] $CopyDir,
  [Parameter(Mandatory = $true)] [string] $KeyFile,
  [string] $At = '18:30'
)
$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-audit-checkpoint.ps1'
$taskArgs = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -EnvName `"$EnvName`" -CopyDir `"$CopyDir`" -KeyFile `"$KeyFile`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$daily = New-ScheduledTaskTrigger -Daily -At $At
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logon.Delay = 'PT10M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($daily, $logon) -Settings $settings -Description 'DCC audit checkpoint: write, copy to the second place, verify (decision D-06, task L-09).' -Force | Out-Null
Write-Output "Registered task ${TaskName}: daily at $At and 10 minutes after sign-in."
