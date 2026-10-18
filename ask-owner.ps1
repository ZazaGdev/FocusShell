# Asks the owner to approve words a lead needs typed into its own pane (#228).
# The CTO runs this after putting the question to the owner in full. FocusShell shows a card
# with the exact words and the lead; only the owner's click types them. This script never
# types anything. With -Wait it waits up to that many seconds and prints the answer:
# "typed", "declined", "expired", "not typed: ..." or "refused: ...".
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [Parameter(Mandatory = $true)][string]$Words,
  [string]$Why = '',
  [int]$Task = 0,
  [switch]$Second,
  [int]$Wait = 0
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pidFile = Join-Path $root 'state/app.pid'
$appPid = if (Test-Path $pidFile) { (Get-Content -Raw $pidFile).Trim() } else { '' }
if (-not $appPid -or -not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) {
  Write-Output 'Failed: the FocusShell app is not running, so there is no card to show. Ask the owner to type the words in the lead''s pane.'
  exit 1
}
if ($Words -match '[\r\n]') { Write-Output 'Failed: the words must be one line.'; exit 1 }

$req = Join-Path $root 'state/requests'
New-Item -ItemType Directory -Force -Path $req | Out-Null
$id = [guid]::NewGuid().ToString('N').Substring(0, 12)
$created = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = [ordered]@{ project = $Project; task = $Task; words = $Words; why = $Why; second = [bool]$Second; created = $created } | ConvertTo-Json -Compress
# Written whole, then renamed, so the app never reads half a request.
$tmp = Join-Path $req "words-$id.tmp"
[System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding $false))
Move-Item -Force $tmp (Join-Path $req "words-$id.req")
$lead = if ($Second) { "lead-$Project-2" } else { "lead-$Project" }
Write-Output "Asked: a card for $lead shows the words; nothing is typed until the owner clicks. Request $id."

if ($Wait -gt 0) {
  $out = Join-Path $req "words-$id.out"
  for ($i = 0; $i -lt $Wait * 5; $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-Path $out) { $answer = (Get-Content -Raw $out).Trim(); Remove-Item -Force -ErrorAction SilentlyContinue $out; Write-Output "Answer: $answer"; exit 0 }
  }
  Write-Output "No answer yet after $Wait seconds; the card stays until the owner clicks or a day passes."
}
