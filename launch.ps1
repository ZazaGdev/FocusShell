# FocusShell launcher: pick projects, then open (or top up) the FocusShell window.
param([switch]$NoDialog)  # use last selection without asking (for testing)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Import-Module (Join-Path $root 'src\FocusShell.psm1') -Force
Add-Type -AssemblyName System.Windows.Forms

$cfgPath = Join-Path $root 'projects.json'
$cfg = Get-DeckConfig $cfgPath
$trusted = Get-ClaudeTrustedPaths

function Show-Message([string]$Text, [string]$Buttons = 'OK') {
  [System.Windows.Forms.MessageBox]::Show($Text, 'FocusShell', $Buttons)
}

function Show-Checklist {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'FocusShell: which projects today?'
  $form.Width = 380; $form.Height = 460
  $form.StartPosition = 'CenterScreen'; $form.TopMost = $true
  $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false

  $list = New-Object System.Windows.Forms.CheckedListBox
  $list.CheckOnClick = $true
  $list.Left = 12; $list.Top = 12; $list.Width = 340; $list.Height = 340
  foreach ($p in $cfg.projects) {
    $label = $p.name
    if (-not (Test-ProjectTrusted -Path $p.path -TrustedPaths $trusted)) { $label += '  (open once by hand first)' }
    $i = $list.Items.Add($label)
    if ($cfg.lastSelected -contains $p.name) { $list.SetItemChecked($i, $true) }
  }

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Open'; $ok.Left = 196; $ok.Top = 370; $ok.DialogResult = 'OK'
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancel'; $cancel.Left = 277; $cancel.Top = 370; $cancel.DialogResult = 'Cancel'
  $form.Controls.AddRange(@($list, $ok, $cancel))
  $form.AcceptButton = $ok; $form.CancelButton = $cancel

  if ($form.ShowDialog() -ne 'OK') { return $null }
  @($list.CheckedIndices | ForEach-Object { $cfg.projects[$_] })
}

$picked = if ($NoDialog) { @($cfg.projects | Where-Object { $cfg.lastSelected -contains $_.name }) } else { Show-Checklist }
if ($null -eq $picked) { exit 0 }
if ($picked.Count -eq 0) { Show-Message 'No projects ticked.' | Out-Null; exit 0 }

if ($picked.Count -gt $cfg.maxWarn) {
  $answer = Show-Message "$($picked.Count) projects share one subscription allowance and your review time. Open them all?" 'YesNo'
  if ($answer -ne 'Yes') { exit 0 }
}

$untrusted = @($picked | Where-Object { -not (Test-ProjectTrusted -Path $_.path -TrustedPaths $trusted) })
if ($untrusted.Count) {
  Show-Message ("Skipping, not trusted in Claude Code yet: " + (($untrusted | ForEach-Object { $_.name }) -join ', ') +
    ". Open each once by hand and accept the trust prompt.") | Out-Null
  $picked = @($picked | Where-Object { $untrusted -notcontains $_ })
  if ($picked.Count -eq 0) { exit 0 }
}

$cfg.lastSelected = @($picked | ForEach-Object { $_.name })
$cfg | ConvertTo-Json -Depth 5 | Set-Content -Path $cfgPath -Encoding UTF8

if (Test-ManagerRunning) {
  # Window already open: add only the missing leads, one at a time.
  foreach ($p in $picked) {
    & (Join-Path $root 'open-pane.ps1') -Project $p.name | Out-Null
    Start-Sleep -Milliseconds 800
  }
  exit 0
}

$leads = @($picked | ForEach-Object { Write-LeadPrompt -DeckRoot $root -Project $_ })
Clear-ClaudeSessionEnv
Start-Process wt -ArgumentList (Get-WindowArgs -Leads $leads -DeckRoot (Join-Path $root 'manager'))
