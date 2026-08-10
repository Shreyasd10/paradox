<#
.SYNOPSIS
  Paradox - pi with batteries (Windows installer).

  Installs skills (junctions), agents (copies), rules (APPEND_SYSTEM.md),
  templates (junction), themes, settings merge, and pi extensions
  (npm + vendored packages under packages/) for pi on Windows.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Scope global -Verify

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [ValidateSet("global", "project")]
  [string]$Scope = "global",
  [string]$ProjectDir = (Get-Location).Path,
  [switch]$DryRun,
  [switch]$Verify,
  [switch]$Uninstall,
  [switch]$NoExtensions,
  [switch]$NoLeanCtx,
  [switch]$WithAgentmemory,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManifestTool = Join-Path $RootDir "scripts\install_manifest.py"
$Namespace = "paradox-"
$ManifestName = ".paradox-install-manifest.json"
$RulesDir = Join-Path $RootDir "rules"

function Die([string]$Message) {
  Write-Error $Message
  exit 1
}

if ($Help) {
  Get-Content $MyInvocation.MyCommand.Path -TotalCount 14 | Select-Object -Skip 1
  exit 0
}

if ($DryRun -and $Verify) { Die "--dry-run and --verify cannot be combined" }

# --- path resolution ---------------------------------------------------------

$homeRoot = if ($Scope -eq "global") { $HOME } else { $ProjectDir }
$runtimeHome = Join-Path $homeRoot ".pi"
$skillsRoot = Join-Path $runtimeHome "agent\skills"
$agentsRoot = Join-Path $runtimeHome "agent\agents"
$templatesRoot = Join-Path $runtimeHome "templates"
$appendSystem = Join-Path $runtimeHome "agent\APPEND_SYSTEM.md"
$themesDst = Join-Path $runtimeHome "agent\themes"
$settingsDst = Join-Path $runtimeHome "agent\settings.json"
$manifestPath = Join-Path $runtimeHome $ManifestName

$skillDirs = @()
Get-ChildItem -Path (Join-Path $RootDir "skills") -Directory | Sort-Object Name | ForEach-Object {
  if (Test-Path (Join-Path $_.FullName "SKILL.md")) { $skillDirs += $_.FullName }
}
if ($skillDirs.Count -eq 0) { Die "no canonical skills discovered" }

$agentFiles = @()
Get-ChildItem -Path (Join-Path $RootDir "agents") -Filter *.md -File | Sort-Object Name | ForEach-Object {
  if ($_.Name -ne "README.md") { $agentFiles += $_.FullName }
}

$piAppendBegin = "<!-- BEGIN paradox managed prompt -->"
$piAppendEnd = "<!-- END paradox managed prompt -->"
$ruleOrder = @("playbook.md")

function Write-HostPlan {
  Write-Host "Plan: $(if ($Uninstall) { 'uninstall' } else { 'install' }) paradox for pi ($Scope)"
  Write-Host "Runtime home: $runtimeHome"
  Write-Host "Skills: $skillsRoot"
  Write-Host "Templates: $templatesRoot"
  Write-Host "Agents: $agentsRoot"
  Write-Host "Ownership manifest: $manifestPath"
}

function Build-AppendSystem([string]$Dst) {
  $managed = Get-Content -Raw -Path $Dst -ErrorAction SilentlyContinue
  if (-not $managed) { $managed = "" }
  $pattern = "(?s)^\s*" + [regex]::Escape($piAppendBegin) + ".*?" + [regex]::Escape($piAppendEnd) + "\s*$"
  $kept = [regex]::Replace($managed, $pattern, "")
  $kept = $kept.TrimEnd("`r", "`n") 

  if ($Uninstall) {
    $new = $kept.Trim()
    if ($new.Length -eq 0) {
      if ($managed.Length -gt 0) {
        Remove-Item -Force -Path $Dst -ErrorAction SilentlyContinue
        Write-Host "  removed $Dst"
      }
    } else {
      Set-Content -Path $Dst -Value $kept -Encoding UTF8
      Write-Host "  removed paradox prompt from $Dst"
    }
    return
  }

  $sb = New-Object System.Text.StringBuilder
  if ($kept.Trim().Length -gt 0) {
    [void]$sb.Append($kept.TrimEnd("`r", "`n"))
    [void]$sb.AppendLine()
    [void]$sb.AppendLine()
  }
  [void]$sb.AppendLine($piAppendBegin)
  [void]$sb.AppendLine("# Source: $RulesDir")
  foreach ($rule in $ruleOrder) {
    $src = Join-Path $RulesDir $rule
    if (-not (Test-Path $src)) { Write-Warning "missing $src (skipping)"; continue }
    [void]$sb.Append((Get-Content -Raw -Path $src))
    [void]$sb.AppendLine()
  }
  [void]$sb.AppendLine($piAppendEnd)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dst) | Out-Null
  Set-Content -Path $Dst -Value $sb.ToString() -Encoding UTF8
  Write-Host "  updated $Dst from $($ruleOrder.Count) rule file(s)"
}

# --- manifest ----------------------------------------------------------------

function Load-Manifest {
  if (-not (Test-Path $manifestPath)) { return $null }
  return Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
}

function Save-Manifest($Entries) {
  $data = [ordered]@{
    product = "paradox"
    runtime = "pi"
    scope = $Scope
    repository_root = $RootDir
    destination_root = $runtimeHome
    entries = $Entries
  }
  $json = $data | ConvertTo-Json -Depth 10
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $manifestPath) | Out-Null
  Set-Content -Path $manifestPath -Value $json -Encoding UTF8
}

# --- link helpers ------------------------------------------------------------

function New-ParadoxJunction([string]$Name, [string]$Source, [string]$Target) {
  $source = [System.IO.Path]::GetFullPath($Source)
  $target = [System.IO.Path]::GetFullPath($Target)
  Write-Host "  junction $Target -> $Source"
  if (Test-Path $Target) { Die "refusing to replace unowned entry: $Target" }
  return @{ kind = "junction"; name = $Name; source = $Source; target = $Target }
}

function Copy-ParadoxFile([string]$Name, [string]$Source, [string]$Target) {
  $source = [System.IO.Path]::GetFullPath($Source)
  $target = [System.IO.Path]::GetFullPath($Target)
  Write-Host "  copy $Target <- $Source"
  if (Test-Path $Target) { Die "refusing to replace unowned entry: $Target" }
  return @{ kind = "copy"; name = $Name; source = $Source; target = $Target }
}

# --- extras ------------------------------------------------------------------

function Get-PiCommand {
  return Get-Command pi -ErrorAction SilentlyContinue
}

function Invoke-VendoredInstall([string]$Name) {
  $pkgDir = Join-Path $RootDir "packages\$Name"
  if (-not (Test-Path (Join-Path $pkgDir "package.json"))) {
    Write-Warning "missing $pkgDir"
    return
  }
  if ($Uninstall) {
    $piCmd = Get-PiCommand
    if ($piCmd) {
      & $piCmd.Source remove $pkgDir 2>$null
      if ($LASTEXITCODE -ne 0) { Write-Warning "pi remove $pkgDir failed or was not installed" }
    }
    return
  }
  if (-not $DryRun) {
    if (Test-Path (Join-Path $pkgDir "package-lock.json")) {
      $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
      if ($npmCmd) {
        Write-Host "  npm ci --omit=dev in $pkgDir..."
        Push-Location $pkgDir
        try {
          & $npmCmd.Source ci --omit=dev --legacy-peer-deps --no-audit --no-fund
          if ($LASTEXITCODE -ne 0) { Write-Warning "npm ci failed for $pkgDir" }
        } finally { Pop-Location }
      } else {
        Write-Warning "npm not found; skipping npm ci for $pkgDir"
      }
    }
    $piCmd = Get-PiCommand
    if (-not $piCmd) {
      Write-Warning "pi not found; cannot install $Name"
      return
    }
    & $piCmd.Source install $pkgDir
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "pi install $pkgDir failed"
      return
    }
    Write-Host "  installed $Name via pi install"
  }
}

function Install-PiExtensions {
  $npmExtensions = @(
    "npm:@gotgenes/pi-permission-system",
    "npm:@juicesharp/rpiv-todo",
    "npm:@juicesharp/rpiv-ask-user-question",
    "npm:pi-x-ide",
    "npm:pi-lean-ctx",
    "npm:@narumitw/pi-usage",
    "npm:@mrclrchtr/supi-context",
    "npm:@juicesharp/rpiv-advisor"
  )
  $vendored = @("pi-task", "pi-grok-style-tools", "pi-workflows")

  if ($Uninstall) {
    $piCmd = Get-PiCommand
    if ($piCmd) {
      Write-Host "  removing third-party pi extensions via pi..."
      foreach ($ext in $npmExtensions) {
        & $piCmd.Source remove $ext 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warning "pi remove $ext failed or was not installed" }
      }
    }
    foreach ($name in $vendored) { Invoke-VendoredInstall $name }
    return
  }

  if ($DryRun) { return }

  $piCmd = Get-PiCommand
  if (-not $piCmd) {
    Write-Warning "pi not found in PATH; skipping pi extension install"
    Write-Warning "install pi first: npm install -g --ignore-scripts @earendil-works/pi-coding-agent (or: bun install -g @earendil-works/pi-coding-agent)"
    return
  }
  Write-Host "  installing $($npmExtensions.Count) pi extensions via pi..."
  foreach ($ext in $npmExtensions) {
    & $piCmd.Source install $ext
    if ($LASTEXITCODE -eq 0) { Write-Host "  installed $ext" } else { Write-Warning "pi install $ext failed" }
  }
  foreach ($name in $vendored) { Invoke-VendoredInstall $name }
}

function Deploy-PiConfig {
  if ($Uninstall) {
    Write-Host "  (pi themes/settings left in place on uninstall)"
    return
  }
  $themesSrc = Join-Path $RootDir "pi-config\themes"
  if (Test-Path $themesSrc) {
    Get-ChildItem -Path $themesSrc -Filter *.json -File | ForEach-Object {
      if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path $themesDst | Out-Null
        Copy-Item -Path $_.FullName -Destination (Join-Path $themesDst $_.Name) -Force
      }
      Write-Host "  installed theme $($_.Name)"
    }
  }

  $settingsPartial = Join-Path $RootDir "pi-config\settings.partial.json"
  if (-not (Test-Path $settingsPartial)) { return }
  if ($DryRun) { return }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsDst) | Out-Null
  $partial = Get-Content -Raw -Path $settingsPartial | ConvertFrom-Json
  if (-not (Test-Path $settingsDst)) {
    $partial | ConvertTo-Json -Depth 50 | Set-Content -Path $settingsDst -Encoding UTF8
    Write-Host "  installed settings.json from settings.partial.json"
  } else {
    $current = Get-Content -Raw -Path $settingsDst | ConvertFrom-Json
    $merged = Merge-Settings $current $partial
    $merged | ConvertTo-Json -Depth 50 | Set-Content -Path $settingsDst -Encoding UTF8
    Write-Host "  merged settings.partial.json into settings.json"
  }
}

function Merge-Settings($Current, $Partial) {
  # deep-merge: Partial wins on scalars/arrays, recurses into objects
  if ($null -eq $Current -or $Current -isnot [System.Management.Automation.PSCustomObject]) { return $Partial }
  if ($null -eq $Partial) { return $Current }
  $out = $Current.PSObject.Copy()
  foreach ($prop in $Partial.PSObject.Properties) {
    $pval = $prop.Value
    if ($null -eq $pval) { continue }
    $cval = $Current.PSObject.Properties[$prop.Name].Value
    if ($cval -is [System.Management.Automation.PSCustomObject] -and $pval -is [System.Management.Automation.PSCustomObject]) {
      $out.PSObject.Properties[$prop.Name].Value = Merge-Settings $cval $pval
    } elseif ($out.PSObject.Properties[$prop.Name]) {
      $out.PSObject.Properties[$prop.Name].Value = $pval
    } else {
      $out | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $pval
    }
  }
  return $out
}

function Deploy-ExtensionConfigs {
  $specs = @(
    @{ Name = "pi-permission-system"; Src = Join-Path $RootDir "pi-config\extensions\pi-permission-system\config.json" },
    @{ Name = "subagent"; Src = Join-Path $RootDir "pi-config\extensions\subagent\config.json" }
  )
  foreach ($spec in $specs) {
    $dst = Join-Path $runtimeHome "agent\extensions\$($spec.Name)\config.json"
    if ($Uninstall) {
      if ((Test-Path $dst) -and (Test-Path $spec.Src)) {
        $same = (Get-FileHash $dst -Algorithm SHA256).Hash -eq (Get-FileHash $spec.Src -Algorithm SHA256).Hash
        if ($same) {
          Remove-Item -Force -Path $dst
          Write-Host "  removed $($spec.Name) config (unchanged)"
        }
      }
      continue
    }
    if (-not (Test-Path $spec.Src)) { Write-Warning "missing $($spec.Src)"; continue }
    if (Test-Path $dst) {
      $same = (Get-FileHash $dst -Algorithm SHA256).Hash -eq (Get-FileHash $spec.Src -Algorithm SHA256).Hash
      if (-not $same) { Write-Warning "$($spec.Name) config exists and differs; leaving it untouched" }
      continue
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -Path $spec.Src -Destination $dst
    Write-Host "  installed $($spec.Name) config"
  }
}

function Deploy-AgentmemoryExtension {
  $src = Join-Path $RootDir "packages\agentmemory"
  $dst = Join-Path $runtimeHome "agent\extensions\agentmemory"
  $settingsDst = Join-Path $runtimeHome "agent\settings.json"
  if ($Uninstall) {
    if ((Test-Path $dst) -and (Test-Path (Join-Path $src "index.ts"))) {
      $sameIndex = (Get-FileHash (Join-Path $dst "index.ts") -Algorithm SHA256).Hash -eq (Get-FileHash (Join-Path $src "index.ts") -Algorithm SHA256).Hash
      $sameSec = (Get-FileHash (Join-Path $dst "security.ts") -Algorithm SHA256).Hash -eq (Get-FileHash (Join-Path $src "security.ts") -Algorithm SHA256).Hash
      if ($sameIndex -and $sameSec) {
        Remove-Item -Recurse -Force -Path $dst
        Write-Host "  removed agentmemory extension (unchanged)"
      } else {
        Write-Warning "leaving modified agentmemory extension in place"
      }
    }
    if (Test-Path $settingsDst) {
      $j = Get-Content -Raw -Path $settingsDst | ConvertFrom-Json
      if ($j.extensions) {
        $j.extensions = @($j.extensions | Where-Object { $_ -ne "~/.pi/agent/extensions/agentmemory" })
        $j | ConvertTo-Json -Depth 50 | Set-Content -Path $settingsDst -Encoding UTF8
      }
    }
    return
  }
  if (-not (Test-Path (Join-Path $src "index.ts"))) { Write-Warning "missing $src"; return }
  if (-not (Test-Path $dst)) {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $src "index.ts") -Destination $dst
    Copy-Item -Path (Join-Path $src "security.ts") -Destination $dst
    Write-Host "  installed agentmemory extension"
  } else {
    Write-Host "  agentmemory extension already present; leaving it"
  }
  if (Test-Path $settingsDst) {
    $j = Get-Content -Raw -Path $settingsDst | ConvertFrom-Json
    if (-not $j.extensions) { $j | Add-Member -NotePropertyName extensions -NotePropertyValue @() }
    if (@($j.extensions) -notcontains "~/.pi/agent/extensions/agentmemory") {
      $j.extensions = @($j.extensions) + @("~/.pi/agent/extensions/agentmemory")
      $j | ConvertTo-Json -Depth 50 | Set-Content -Path $settingsDst -Encoding UTF8
      Write-Host "  settings.extensions += ~/.pi/agent/extensions/agentmemory"
    }
  }
}

function Deploy-LeanCtxUserConfig {
  if ($Uninstall) { return }
  $src = Join-Path $RootDir "pi-config\lean-ctx\config.toml"
  if (-not (Test-Path $src)) { Write-Warning "missing $src"; return }
  $dst = Join-Path $HOME ".config\lean-ctx\config.toml"
  if (Test-Path $dst) {
    Write-Host "  lean-ctx user config exists; leaving it ($dst)"
    return
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  Copy-Item -Path $src -Destination $dst
  Write-Host "  installed lean-ctx user config (allowlist/paths)"
}

function Configure-PiLeanCtx {
  $leanCtxConfig = Join-Path $runtimeHome "agent\extensions\pi-lean-ctx\config.json"
  $leanCtxMarker = Join-Path $runtimeHome "agent\extensions\pi-lean-ctx\.paradox-managed"
  if ($Uninstall) {
    if (Test-Path $leanCtxMarker) {
      Remove-Item -Force -Path $leanCtxMarker, $leanCtxConfig -ErrorAction SilentlyContinue
      Write-Host "  removed owned pi-lean-ctx config"
    } elseif (Test-Path $leanCtxConfig) {
      try {
        $j = Get-Content -Raw -Path $leanCtxConfig | ConvertFrom-Json
        if ($j.managedBy -eq "paradox") {
          Remove-Item -Force -Path $leanCtxConfig
          Write-Host "  removed owned pi-lean-ctx config"
        } else {
          Write-Host "  leaving foreign/malformed pi-lean-ctx config untouched"
        }
      } catch {
        Write-Host "  leaving foreign/malformed pi-lean-ctx config untouched"
      }
    }
    return
  }
  if ($NoLeanCtx -or $DryRun) {
    if ($NoLeanCtx) { Write-Host "  LeanCTX routing skipped (--no-lean-ctx)" }
    return
  }
  $leanCmd = Get-Command lean-ctx -ErrorAction SilentlyContinue
  if (-not $leanCmd) {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCmd) {
      Write-Host "  installing lean-ctx-bin..."
      & $npmCmd.Source install -g "lean-ctx-bin@^3.9.3" 2>$null
    } else {
      Write-Warning "npm not found; cannot install lean-ctx-bin"
    }
    $leanCmd = Get-Command lean-ctx -ErrorAction SilentlyContinue
  }
  if (-not $leanCmd) {
    Write-Warning "lean-ctx binary unavailable; skip configure"
    return
  }
  if (Test-Path $leanCtxConfig) {
    try {
      $j = Get-Content -Raw -Path $leanCtxConfig | ConvertFrom-Json
      if ($j.managedBy -and $j.managedBy -ne "paradox") {
        Write-Warning "pi-lean-ctx config owned by another product; leaving untouched"
        return
      }
    } catch { }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $leanCtxConfig) | Out-Null
  # init first: it can rewrite the pi config; our managedBy write must come last.
  & $leanCmd.Source init --agent pi 2>$null
  $vendoredPath = Join-Path $RootDir "pi-config\lean-ctx\config.json"
  $vendoredEnv = @{}
  if (Test-Path $vendoredPath) {
    try { $vendoredEnv = (Get-Content -Raw -Path $vendoredPath | ConvertFrom-Json).env } catch { }
  }
  $env = @{}
  foreach ($k in $vendoredEnv.PSObject.Properties) { $env[$k.Name] = $k.Value }
  if (Test-Path $leanCtxConfig) {
    try {
      $j = Get-Content -Raw -Path $leanCtxConfig | ConvertFrom-Json
      if ($j.env) { foreach ($k in $j.env.PSObject.Properties) { $env[$k.Name] = $k.Value } }
    } catch { }
  }
  $config = [ordered]@{
    mode = "replace"
    managedBy = "paradox"
    binary = $leanCmd.Source
    env = $env
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content -Path $leanCtxConfig -Encoding UTF8
  Write-Host "  configured pi-lean-ctx ($leanCtxConfig)"
  New-Item -ItemType File -Force -Path $leanCtxMarker | Out-Null
}

function Connect-Agentmemory {
  if ($Uninstall) {
    Write-Host "  uninstall leaves the agentmemory CLI and memory DB in place"
    Write-Host "  tip: agentmemory disconnect pi"
    return
  }
  if (-not $WithAgentmemory) { return }
  $amCmd = Get-Command agentmemory -ErrorAction SilentlyContinue
  if (-not $amCmd) {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmCmd) { Write-Warning "npm not found; cannot install agentmemory"; return }
    Write-Host "  installing @agentmemory/agentmemory..."
    & $npmCmd.Source install -g "@agentmemory/agentmemory@^0.9.27" 2>$null
    $amCmd = Get-Command agentmemory -ErrorAction SilentlyContinue
  }
  if (-not $amCmd) { Write-Warning "agentmemory CLI unavailable; skip connect"; return }
  if ($Scope -ne "global") { Write-Host "  project scope: run manually: agentmemory connect pi"; return }
  & $amCmd.Source connect pi --force
  if ($LASTEXITCODE -eq 0) { Write-Host "  agentmemory connect pi -> ok" }
  else { Write-Warning "agentmemory connect pi failed (keep the service at http://localhost:3111/mcp running)" }
}

# --- uninstall ---------------------------------------------------------------

if ($Uninstall) {
  Write-HostPlan
  $manifest = Load-Manifest
  if (-not $manifest) { Die "no owned installation manifest found at $manifestPath" }
  if ($DryRun) {
    Write-Host "Dry run: owned entries would be checked and removed; no files changed."
    exit 0
  }
  foreach ($entry in $manifest.entries) {
    $target = [System.IO.Path]::GetFullPath($entry.target)
    if (Test-Path $target) {
      if ($entry.kind -eq "junction") {
        $item = Get-Item $target -Force
        if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
          Die "refusing to remove non-junction entry: $target"
        }
      }
      Remove-Item -Force -Path $target
      Write-Host "  removed $target"
    }
  }
  if ($Scope -eq "global") {
    Build-AppendSystem $appendSystem
    Install-PiExtensions
    Deploy-ExtensionConfigs
    Deploy-AgentmemoryExtension
    Configure-PiLeanCtx
    Deploy-LeanCtxUserConfig
    Connect-Agentmemory
  }
  Remove-Item -Force -Path $manifestPath
  Write-Host "Removed paradox installation ($($manifest.entries.Count) entries)."
  exit 0
}

# --- plan --------------------------------------------------------------------

Write-HostPlan

$entries = @()
foreach ($skillDir in $skillDirs) {
  $name = Split-Path -Leaf $skillDir
  $entries += New-ParadoxJunction $name $skillDir (Join-Path $skillsRoot "$Namespace$name")
}
foreach ($agentFile in $agentFiles) {
  $name = Split-Path -Leaf $agentFile
  $entries += Copy-ParadoxFile "agent:$name" $agentFile (Join-Path $agentsRoot $name)
}
$entries += New-ParadoxJunction "templates" (Join-Path $RootDir "templates") $templatesRoot

if ($DryRun) {
  Write-Host "Dry run: no files changed."
  if ($Scope -eq "global" -and -not $NoExtensions) {
    Write-Host "Dry run would also install Pi extras (extensions / pi-task / lean-ctx / themes)."
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $runtimeHome, $skillsRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $templatesRoot) | Out-Null

$createdTargets = @()
try {
  foreach ($entry in $entries) {
    if ($entry.kind -eq "junction") {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $entry.target) | Out-Null
      New-Item -ItemType Junction -Path $entry.target -Target $entry.source | Out-Null
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $entry.target) | Out-Null
      Copy-Item -Path $entry.source -Destination $entry.target
    }
    $createdTargets += $entry.target
  }
} catch {
  foreach ($target in $createdTargets) {
    if (Test-Path $target) { Remove-Item -Force -Path $target -ErrorAction SilentlyContinue }
  }
  throw
}

Save-Manifest $entries

if ($Scope -eq "global") {
  Build-AppendSystem $appendSystem
  if (-not $NoExtensions) { Install-PiExtensions }
  Deploy-ExtensionConfigs
  Deploy-AgentmemoryExtension
  Configure-PiLeanCtx
  Deploy-LeanCtxUserConfig
}
Connect-Agentmemory

if ($Verify) {
  foreach ($entry in $entries) {
    if (-not (Test-Path $entry.target)) { Die "verify failed: missing $($entry.target)" }
  }
  if (Test-Path (Join-Path $runtimeHome $ManifestName)) {
    Write-Host "Verified paradox installation for pi ($($skillDirs.Count) skills, $($agentFiles.Count) agents, templates)."
  }
}
