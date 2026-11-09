# Closes one project lead's tab in the running FocusShell window and ends its session.
# The CTO runs this when the user asks it to close a project. The app refuses a lead that
# is busy or has a task in progress unless -Force is given, and says why. -Lead <n> (2 to 5)
# closes only that extra lead, lead-<Project>-<n> (#1485), and removes its worktree once its
# work is merged; -Second is -Lead 2.
param([Parameter(Mandatory = $true)][string]$Project, [switch]$Force, [switch]$Second, [int]$Lead = 0)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Import-Module (Join-Path $root 'src\FocusShell.psm1') -Force
$cfg = Get-DeckConfig (Join-Path $root 'projects.json')

if ($Second -and -not $Lead) { $Lead = 2 }
if ($Lead -eq 1) { $Lead = 0 }
$p = $cfg.projects | Where-Object { $_.name -ieq $Project } | Select-Object -First 1
$name = if ($p) { $p.name } else { $Project }
if ($Lead -and ($Lead -lt 2 -or $Lead -gt 5)) {
  Write-Output "Refused: a project runs at most five leads, lead-$name and lead-$name-2 to lead-$name-5, so there is no lead $Lead to close. -Lead takes 2 to 5."
  exit 1
}
$kind = if ($Lead) { "close$Lead" } else { 'close' }
$leadName = if ($Lead) { "lead-$name-$Lead" } else { "lead-$name" }

$pidFile = Join-Path $root 'state/app.pid'
$running = $false
if (Test-Path $pidFile) {
  $appPid = (Get-Content -Raw $pidFile).Trim()
  $running = [bool]($appPid -and (Get-Process -Id $appPid -ErrorAction SilentlyContinue))
}
if (-not $running) {
  Write-Output "The FocusShell app is not running, so there is no $leadName tab to close."
  exit 1
}

$req = Join-Path $root 'state/requests'
New-Item -ItemType Directory -Force -Path $req | Out-Null
$out = Join-Path $req "$kind-$name.out"
Remove-Item -Force -ErrorAction SilentlyContinue $out
Set-Content -Path (Join-Path $req "$kind-$name.req") -Value $(if ($Force) { 'force' } else { '' })

# The app answers in close-<Project>.out within a few seconds; removing a worktree takes longer.
$tries = if ($Lead) { 100 } else { 50 }
for ($i = 0; $i -lt $tries; $i++) {
  Start-Sleep -Milliseconds 200
  if (Test-Path $out) {
    $answer = (Get-Content -Raw $out).Trim()
    Remove-Item -Force -ErrorAction SilentlyContinue $out
    Write-Output $answer
    if ($answer -like 'Closed*') { exit 0 } else { exit 1 }
  }
}
Write-Output "Asked the FocusShell app to close $leadName, but it did not answer within $($tries / 5) seconds."
exit 1
