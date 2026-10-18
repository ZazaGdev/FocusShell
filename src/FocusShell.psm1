# Pure helpers for FocusShell. No side effects: everything here is unit tested.

# projects.json settings plus every folder under scanRoots (default: the deck's parent).
# Projects are named after their folder; a projects.json entry adds settings by path.
function Get-DeckConfig([string]$Path) {
  $c = Get-Content -Raw -Path $Path | ConvertFrom-Json
  $deckRoot = Split-Path -Parent (Resolve-Path $Path)
  $roots = @($c.scanRoots | Where-Object { $_ })
  if (-not $roots.Count) { $roots = @(Split-Path -Parent $deckRoot) }
  $norm = { param($x) ([string]$x -replace '\\', '/').TrimEnd('/').ToLowerInvariant() }
  $explicit = @{}
  foreach ($p in @($c.projects)) { $explicit[(& $norm $p.path)] = $p }
  $list = New-Object System.Collections.ArrayList
  $seen = @{}
  foreach ($root in $roots) {
    foreach ($d in (Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.StartsWith('.') })) {
      $k = & $norm $d.FullName
      if ($seen[$k]) { continue }
      $seen[$k] = $true
      $test = if ($explicit[$k]) { $explicit[$k].test } else { '' }
      [void]$list.Add([pscustomobject]@{ name = $d.Name; path = $d.FullName; test = $test })
    }
  }
  foreach ($p in @($c.projects)) {
    $k = & $norm $p.path
    if (-not $seen[$k]) { $seen[$k] = $true; [void]$list.Add([pscustomobject]@{ name = $p.name; path = $p.path; test = $p.test }) }
  }
  $c.projects = @($list | Sort-Object name)
  # A projects.json without lastSelected (the Demo's) gets an empty one rather than failing.
  $c | Add-Member -NotePropertyName lastSelected -NotePropertyValue @($c.lastSelected) -Force
  $c
}

# Claude Code records folder trust in ~/.claude.json under projects["G:/path"].
# Takes the list of trusted paths from Get-TrustedPaths.
function Test-ProjectTrusted([string]$Path, [string[]]$TrustedPaths) {
  $want = ($Path -replace '\\', '/').TrimEnd('/')
  foreach ($t in $TrustedPaths) { if ($t.TrimEnd('/') -ieq $want) { return $true } }
  $false
}

# Windows PowerShell's ConvertFrom-Json rejects keys that differ only by case,
# and ~/.claude.json can hold both "G:/x" and "g:/x", so use a case-sensitive parser.
function Get-TrustedPaths([string]$JsonText) {
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $ser.MaxJsonLength = [int]::MaxValue
  $d = $ser.DeserializeObject($JsonText)
  if (-not $d.ContainsKey('projects')) { return @() }
  @(foreach ($k in $d['projects'].Keys) {
    $v = $d['projects'][$k]
    if ($v -is [System.Collections.IDictionary] -and $v.ContainsKey('hasTrustDialogAccepted') -and $v['hasTrustDialogAccepted'] -eq $true) { $k }
  })
}

function Get-LeadPaneArgs([string]$Name, [string]$Path, [string]$PromptFile) {
  "--title `"lead-$Name`" -d `"$Path`" cmd /k claude -n lead-$Name --permission-mode auto --append-system-prompt-file `"$PromptFile`""
}

function Format-Size([double]$x) {
  $x.ToString('0.###', [Globalization.CultureInfo]::InvariantCulture)
}

# Leads across the top in equal widths, manager across the bottom.
# wt splits only the focused pane, so the manager split comes first while the
# first lead still spans the full width.
function Get-WindowArgs($Leads, [string]$DeckRoot) {
  $Leads = @($Leads)
  $n = $Leads.Count
  $first = $Leads[0]
  $parts = @("-w focusshell new-tab " + (Get-LeadPaneArgs $first.Name $first.Path $first.PromptFile))
  $parts += "split-pane -H -s 0.3 --title `"cto`" -d `"$DeckRoot`" cmd /k claude -n cto --permission-mode auto"
  if ($n -gt 1) {
    $parts += 'move-focus up'
    for ($i = 1; $i -lt $n; $i++) {
      $size = Format-Size (($n - $i) / ($n - $i + 1))
      $l = $Leads[$i]
      $parts += "split-pane -V -s $size " + (Get-LeadPaneArgs $l.Name $l.Path $l.PromptFile)
    }
  }
  $parts -join ' ; '
}

function Get-AddPaneArgs($Lead, [int]$TargetPane) {
  "-w focusshell focus-pane -t $TargetPane ; split-pane -V -s 0.5 " + (Get-LeadPaneArgs $Lead.Name $Lead.Path $Lead.PromptFile)
}

function New-LeadPrompt([string]$Template, [string]$Project, [string]$TaskFile, [string]$Test) {
  if (-not $Test) { $Test = "the project's usual test command, if it has one" }
  $Template.Replace('{{PROJECT}}', $Project).Replace('{{TASKFILE}}', $TaskFile).Replace('{{TEST}}', $Test).Replace('{{MANAGER}}', 'cto')
}

function Get-OpenLeadNames([string[]]$CommandLines) {
  $names = foreach ($c in $CommandLines) { if ($c -match '-n lead-(\S+)') { $Matches[1] } }
  @($names | Select-Object -Unique)
}

# A session started from inside Claude Code inherits these and then never
# registers for cross-session messaging, so clear them before calling wt.
function Clear-ClaudeSessionEnv {
  Get-ChildItem Env: | Where-Object { $_.Name -like 'CLAUDE*' } |
    ForEach-Object { Remove-Item ("Env:" + $_.Name) }
}

# --- Side-effecting helpers shared by launch.ps1 and open-pane.ps1 ---

function Get-ClaudeTrustedPaths {
  Get-TrustedPaths (Get-Content -Raw -Path (Join-Path $env:USERPROFILE '.claude.json'))
}

# Only claude.exe rows: a Windows Terminal process keeps its original command
# line after panes close, so it would report leads that are gone.
function Get-ClaudeCommandLines {
  @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | ForEach-Object { $_.CommandLine } | Where-Object { $_ })
}

function Test-ManagerRunning {
  [bool](Get-ClaudeCommandLines | Where-Object { $_ -match '-n (cto|manager)(\s|$)' })
}

# Renders state\prompts\lead-<Name>.md and makes sure tasks\<Name>.md exists.
# Returns the lead descriptor the layout functions take.
function Write-LeadPrompt($DeckRoot, $Project) {
  $promptDir = Join-Path $DeckRoot 'state\prompts'
  $taskDir = Join-Path $DeckRoot 'tasks'
  New-Item -ItemType Directory -Force -Path $promptDir, $taskDir | Out-Null
  $taskFile = Join-Path $taskDir "$($Project.name).md"
  if (-not (Test-Path $taskFile)) { Set-Content -Path $taskFile -Value "# $($Project.name) tasks" -Encoding UTF8 }
  $template = Get-Content -Raw -Path (Join-Path $DeckRoot 'lead-prompt.md')
  $promptFile = Join-Path $promptDir "lead-$($Project.name).md"
  New-LeadPrompt -Template $template -Project $Project.name -TaskFile $taskFile -Test $Project.test |
    Set-Content -Path $promptFile -Encoding UTF8
  @{ Name = $Project.name; Path = $Project.path; PromptFile = $promptFile }
}

Export-ModuleMember -Function Get-DeckConfig, Test-ProjectTrusted, Get-LeadPaneArgs, Get-WindowArgs, Get-AddPaneArgs, New-LeadPrompt, Get-OpenLeadNames, Clear-ClaudeSessionEnv, Get-TrustedPaths, Get-ClaudeTrustedPaths, Get-ClaudeCommandLines, Test-ManagerRunning, Write-LeadPrompt
