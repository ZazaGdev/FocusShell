# Adds one project lead pane to the running FocusShell window.
# The manager runs this when the user asks it to open a project.
# -Lead <n> (2 to 5) opens the project's extra lead n, lead-<Project>-<n>, as tab n of the same
# pane (app only, #1485); -Second is -Lead 2. With -Worktree that lead works in its own git
# worktree (state\worktrees\<Project>-<n>, branch lead-<n>) instead of the project folder.
# -Model starts the lead on that Claude model (#202), only when the user names one; that pane
# keeps it through a Restart, and nothing is saved for the project.
param([Parameter(Mandatory = $true)][string]$Project, [switch]$Second, [int]$Lead = 0, [switch]$Worktree,
  [ValidateSet('fable', 'opus', 'sonnet', 'haiku')][string]$Model)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Import-Module (Join-Path $root 'src\FocusShell.psm1') -Force
$cfg = Get-DeckConfig (Join-Path $root 'projects.json')

if ($Second -and -not $Lead) { $Lead = 2 }
if ($Lead -eq 1) { $Lead = 0 }
if ($Lead -and ($Lead -lt 2 -or $Lead -gt 5)) {
  Write-Output "Refused: a project runs at most five leads, lead-$Project and lead-$Project-2 to lead-$Project-5. -Lead takes 2 to 5; close one of them first to free its number."
  exit 1
}
if ($Worktree -and -not $Lead) {
  Write-Output "Refused: -Worktree is for an extra lead only. Add -Lead 2 to 5."
  exit 1
}
$p = $cfg.projects | Where-Object { $_.name -ieq $Project } | Select-Object -First 1
if (-not $p) {
  Write-Output "Unknown project '$Project'. Known: $(($cfg.projects | ForEach-Object { $_.name }) -join ', '). Add it to projects.json first."
  exit 1
}
# When the FocusShell app is running, ask it to open a tab instead of a Terminal pane.
$pidFile = Join-Path $root 'state/app.pid'
if (Test-Path $pidFile) {
  $appPid = (Get-Content -Raw $pidFile).Trim()
  if ($appPid -and (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) {
    $req = Join-Path $root 'state/requests'
    New-Item -ItemType Directory -Force -Path $req | Out-Null
    $kind = if ($Lead) { "open$Lead" } else { 'open' }
    $leadName = if ($Lead) { "lead-$($p.name)-$Lead" } else { "lead-$($p.name)" }
    $body = if ($Lead) { if ($Worktree) { 'worktree' } else { 'same' } } else { $p.name }
    if ($Model) { $body = @($body, "model=$($Model.ToLower())") }
    $out = Join-Path $req "$kind-$($p.name).out"
    # The app answers in <kind>-<Project>.out, "Started ..." or "Failed: ...", once the session
    # has run for a few seconds (#185). No answer within 30 seconds: ask once more, then give up.
    for ($attempt = 1; $attempt -le 2; $attempt++) {
      Remove-Item -Force -ErrorAction SilentlyContinue $out
      Set-Content -Path (Join-Path $req "$kind-$($p.name).req") -Value $body
      for ($i = 0; $i -lt 150; $i++) {
        Start-Sleep -Milliseconds 200
        if (Test-Path $out) {
          $answer = (Get-Content -Raw $out).Trim()
          Remove-Item -Force -ErrorAction SilentlyContinue $out
          $where = if ($Lead) { if ($Worktree) { " It works in its own worktree (state\worktrees\$($p.name)-$Lead, branch lead-$Lead)." } else { ' It works in the project folder.' } } else { '' }
          if ($answer -like 'Started*') { Write-Output "$answer$where It shows in ListAgents within about 20 seconds."; exit 0 }
          if ($answer -like 'Already open*') { Write-Output $answer; exit 0 }
          Write-Output $answer
          exit 1
        }
      }
      if ($attempt -eq 1) { Write-Output "The FocusShell app did not answer within 30 seconds; asking again." }
    }
    Write-Output "Failed: the FocusShell app did not answer the request to open $leadName, twice. It may be busy or stuck; tell the user to check the FocusShell window."
    exit 1
  }
}
if ($Lead -or $Model) {
  Write-Output "$(if ($Lead) { 'An extra lead' } else { 'Opening a lead on a named model' }) needs the FocusShell app. Start it with the FocusShell shortcut."
  exit 1
}

if (-not (Test-ProjectTrusted -Path $p.path -TrustedPaths (Get-ClaudeTrustedPaths))) {
  Write-Output "$($p.name) is not trusted in Claude Code yet. Open it once by hand (cd $($p.path); claude) and accept the trust prompt."
  exit 1
}
$open = Get-OpenLeadNames (Get-ClaudeCommandLines)
if ($open -contains $p.name) {
  Write-Output "lead-$($p.name) is already open."
  exit 0
}
if (-not (Test-ManagerRunning)) {
  Write-Output "The FocusShell window is not open. Start it with the FocusShell shortcut."
  exit 1
}

$leadFile = Write-LeadPrompt -DeckRoot $root -Project $p
# Pane 0 is the first lead and pane 1 the manager; later leads follow from 2.
$target = if ($open.Count -le 1) { 0 } else { $open.Count }
Clear-ClaudeSessionEnv
Start-Process wt -ArgumentList (Get-AddPaneArgs -Lead $leadFile -TargetPane $target)
Write-Output "Opened lead-$($p.name). It takes about 20 seconds to come online."
