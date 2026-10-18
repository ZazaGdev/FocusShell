Import-Module (Join-Path $PSScriptRoot '..\src\FocusShell.psm1') -Force

Describe 'Get-DeckConfig' {
  It 'reads projects and lastSelected' {
    $empty = Join-Path $TestDrive 'empty'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    $p = Join-Path $TestDrive 'p.json'
    $json = @{ scanRoots = @($empty); maxWarn = 4; lastSelected = @('A'); projects = @(@{ name = 'A'; path = 'D:\a'; test = '' }) } | ConvertTo-Json -Depth 4
    Set-Content -Path $p -Value $json
    $c = Get-DeckConfig -Path $p
    $c.projects.Count | Should Be 1
    $c.lastSelected[0] | Should Be 'A'
  }
  It 'lists every folder under scanRoots, named by folder, keeping settings by path' {
    $root = Join-Path $TestDrive 'S'
    'Budgetly','BudgetlyV2','alpha','deck' | ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $root $_) | Out-Null }
    $cfgPath = Join-Path $root 'deck\p.json'
    $json = @{ scanRoots = @($root); lastSelected = @(); projects = @(@{ name = 'Budgetly'; path = (Join-Path $root 'BudgetlyV2'); test = 'npm test' }) } | ConvertTo-Json -Depth 4
    Set-Content -Path $cfgPath -Value $json
    $c = Get-DeckConfig -Path $cfgPath
    # The deck's own folder is a project too, so FocusShell can be worked on from FocusShell.
    ($c.projects | ForEach-Object { $_.name }) -join ',' | Should Be 'alpha,Budgetly,BudgetlyV2,deck'
    ($c.projects | Where-Object { $_.name -eq 'BudgetlyV2' }).test | Should Be 'npm test'
  }
  It 'reads the real projects.json' {
    $c = Get-DeckConfig -Path (Join-Path $PSScriptRoot '..\projects.json')
    $c.projects.Count -gt 0 | Should Be $true
  }
}

Describe 'Get-TrustedPaths and Test-ProjectTrusted' {
  $json = '{"projects":{"g:/SideProjects/A":{"hasTrustDialogAccepted":true},"G:/SideProjects/A":{"x":1},"G:/SideProjects/B":{}}}'
  It 'parses keys that differ only by case' {
    $t = Get-TrustedPaths $json
    ($t -join ',') | Should Be 'g:/SideProjects/A'
  }
  It 'matches backslash paths case-insensitively' {
    $t = Get-TrustedPaths $json
    Test-ProjectTrusted -Path 'G:\SideProjects\A' -TrustedPaths $t | Should Be $true
    Test-ProjectTrusted -Path 'G:\SideProjects\B' -TrustedPaths $t | Should Be $false
    Test-ProjectTrusted -Path 'G:\SideProjects\C' -TrustedPaths $t | Should Be $false
  }
  It 'reads the real ~/.claude.json' {
    (Get-ClaudeTrustedPaths).Count -gt 0 | Should Be $true
  }
}

Describe 'Get-LeadPaneArgs' {
  It 'builds a lead pane with fixed name and prompt file' {
    $a = Get-LeadPaneArgs -Name 'A' -Path 'D:\a' -PromptFile 'D:\t\lead-A.md'
    $a | Should Be '--title "lead-A" -d "D:\a" cmd /k claude -n lead-A --permission-mode auto --append-system-prompt-file "D:\t\lead-A.md"'
  }
}

Describe 'Get-WindowArgs' {
  $leads = @(
    @{Name = 'A'; Path = 'D:\a'; PromptFile = 'D:\t\A.md'},
    @{Name = 'B'; Path = 'D:\b'; PromptFile = 'D:\t\B.md'},
    @{Name = 'C'; Path = 'D:\c'; PromptFile = 'D:\t\C.md'})
  It 'one lead: tab then the CTO below, no extra splits' {
    $s = Get-WindowArgs -Leads @($leads[0]) -DeckRoot 'D:\deck'
    $s | Should Match '^-w focusshell new-tab --title "lead-A"'
    $s | Should Match 'split-pane -H -s 0\.3 --title "cto" -d "D:\\deck" cmd /k claude -n cto --permission-mode auto$'
    $s | Should Not Match 'move-focus'
  }
  It 'three leads: equal widths across the top' {
    $s = Get-WindowArgs -Leads $leads -DeckRoot 'D:\deck'
    $s | Should Match 'move-focus up ; split-pane -V -s 0\.667 --title "lead-B"'
    $s | Should Match 'split-pane -V -s 0\.5 --title "lead-C"'
  }
  It 'five leads: sizes 0.8, 0.75, 0.667, 0.5' {
    $five = @('A','B','C','D','E') | ForEach-Object { @{Name = $_; Path = "D:\$_"; PromptFile = "D:\t\$_.md"} }
    $s = Get-WindowArgs -Leads $five -DeckRoot 'D:\deck'
    $sizes = [regex]::Matches($s, 'split-pane -V -s ([\d.]+)') | ForEach-Object { $_.Groups[1].Value }
    ($sizes -join ',') | Should Be '0.8,0.75,0.667,0.5'
  }
}

Describe 'Get-AddPaneArgs' {
  It 'focuses the given pane and splits it' {
    Get-AddPaneArgs -Lead @{Name = 'D'; Path = 'D:\d'; PromptFile = 'D:\t\D.md'} -TargetPane 3 |
      Should Match '^-w focusshell focus-pane -t 3 ; split-pane -V -s 0\.5 --title "lead-D"'
  }
}

Describe 'New-LeadPrompt' {
  It 'fills tokens' {
    New-LeadPrompt -Template 'I am {{PROJECT}}, file {{TASKFILE}}, test {{TEST}}' -Project 'A' -TaskFile 'D:\deck\tasks\A.md' -Test 'npm test' |
      Should Be 'I am A, file D:\deck\tasks\A.md, test npm test'
  }
  It 'falls back when no test command' {
    New-LeadPrompt -Template '{{TEST}}' -Project 'A' -TaskFile 'x' -Test '' | Should Match 'usual test command'
  }
}

Describe 'Get-OpenLeadNames' {
  It 'parses unique lead names from command lines' {
    $lines = @('cmd /k claude.cmd -n lead-A --permission-mode auto', 'claude.exe -n lead-A --x', 'node cli.js -n lead-B --x', 'claude -n manager', 'other')
    (Get-OpenLeadNames -CommandLines $lines) -join ',' | Should Be 'A,B'
  }
}
