<#
.SYNOPSIS
  One-command Paradox installer for Windows (no manual clone).

  Interactive:
    irm https://raw.githubusercontent.com/Shreyasd10/paradox/main/get-paradox.ps1 | iex

  From a local checkout (or with flags):
    powershell -ExecutionPolicy Bypass -File .\get-paradox.ps1 -NoExtensions

  Env overrides: PARADOX_REPO, PARADOX_REF, PARADOX_HOME, PARADOX_SOURCE_DIR
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$NoExtensions,
  [switch]$NoLeanCtx,
  [switch]$WithAgentmemory,
  [switch]$NoVerify,
  [switch]$SkipFetch,
  [string]$Repo = "",
  [string]$Ref = ""
)

$ErrorActionPreference = "Stop"

if ($Repo -eq "") { $Repo = if ($env:PARADOX_REPO) { $env:PARADOX_REPO } else { "Shreyasd10/paradox" } }
if ($Ref -eq "") { $Ref = if ($env:PARADOX_REF) { $env:PARADOX_REF } else { "main" } }
if ($env:PARADOX_HOME) {
  $paradoxHome = $env:PARADOX_HOME
} else {
  $paradoxHome = Join-Path $HOME ".local\share\paradox"
}
$sourceOverride = $env:PARADOX_SOURCE_DIR

function Die([string]$Message) {
  Write-Error $Message
  exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-Root {
  if ($sourceOverride) {
    if (-not (Test-Path (Join-Path $sourceOverride "install.ps1"))) {
      Die "PARADOX_SOURCE_DIR missing install.ps1: $sourceOverride"
    }
    return [System.IO.Path]::GetFullPath($sourceOverride)
  }
  if ($SkipFetch) {
    if ($scriptDir -and (Test-Path (Join-Path $scriptDir "install.ps1"))) {
      return [System.IO.Path]::GetFullPath($scriptDir)
    }
    $current = Join-Path $paradoxHome "current"
    if (-not (Test-Path (Join-Path $current "install.ps1"))) {
      Die "--SkipFetch but no package at $current"
    }
    return [System.IO.Path]::GetFullPath($current)
  }
  if ($scriptDir -and (Test-Path (Join-Path $scriptDir "install.ps1"))) {
    return [System.IO.Path]::GetFullPath($scriptDir)
  }
  return Fetch-Package
}

# GitHub archives omit submodule content; fetch each submodule's default
# branch archive and unpack it at its path. Git clones pin the exact commit
# via `git submodule` instead.
function Expand-Submodules {
  param([string]$Root)
  $gitmodules = Join-Path $Root ".gitmodules"
  if (-not (Test-Path $gitmodules)) { return }
  $subPath = $null
  foreach ($line in Get-Content $gitmodules) {
    if ($line -match '^\s*path\s*=\s*(.+)$') {
      $subPath = $Matches[1].Trim()
    } elseif ($line -match '^\s*url\s*=\s*(.+)$') {
      if (-not $subPath) { continue }
      $subUrl = $Matches[1].Trim()
      $repo = $subUrl -replace '^https://github.com/', '' -replace '\.git$', ''
      $subDir = Join-Path $Root $subPath
      $archive = Join-Path $env:TEMP ("submodule-" + [guid]::NewGuid().ToString("N") + ".zip")
      $fetched = $false
      foreach ($branch in @("main", "master")) {
        try {
          Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/archive/refs/heads/$branch.zip" -OutFile $archive -ErrorAction Stop
          $fetched = $true
          break
        } catch { }
      }
      if (-not $fetched) {
        Write-Warning "could not fetch submodule $subPath"
      } else {
        $extract = Join-Path $env:TEMP ("submodule-" + [guid]::NewGuid().ToString("N"))
        Expand-Archive -Path $archive -DestinationPath $extract -Force
        $subRoot = Get-ChildItem -Path $extract -Directory | Select-Object -First 1
        if ($subRoot) {
          New-Item -ItemType Directory -Force -Path $subDir | Out-Null
          Copy-Item -Path (Join-Path $subRoot.FullName "*") -Destination $subDir -Recurse -Force
          Write-Host "  submodule $subPath ($repo@$branch)"
        } else {
          Write-Warning "submodule $subPath archive empty"
        }
        Remove-Item -Recurse -Force -Path $extract -ErrorAction SilentlyContinue
        Remove-Item -Force -Path $archive -ErrorAction SilentlyContinue
      }
      $subPath = $null
    }
  }
}

function Fetch-Package {
  $current = Join-Path $paradoxHome "current"
  $tmp = Join-Path $env:TEMP ("paradox-fetch-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $archive = Join-Path $tmp "src.zip"
  $branchUrl = "https://github.com/$Repo/archive/refs/heads/$Ref.zip"
  $tagUrl = "https://github.com/$Repo/archive/refs/tags/$Ref.zip"

  Write-Host "Downloading $Repo@$Ref ..."
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $branchUrl -OutFile $archive -ErrorAction Stop
  } catch {
    Invoke-WebRequest -UseBasicParsing -Uri $tagUrl -OutFile $archive -ErrorAction Stop
  }

  $extract = Join-Path $tmp "extract"
  Expand-Archive -Path $archive -DestinationPath $extract -Force
  $root = Get-ChildItem -Path $extract -Directory | Where-Object {
    Test-Path (Join-Path $_.FullName "install.ps1")
  } | Select-Object -First 1
  if (-not $root) { Die "downloaded archive missing install.ps1" }

  if (Test-Path $current) { Remove-Item -Recurse -Force -Path $current }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $current) | Out-Null
  Move-Item -Path $root.FullName -Destination $current
  Expand-Submodules -Root $current
  Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
  Write-Host "Package ready at $current"
  return [System.IO.Path]::GetFullPath($current)
}

Write-Host "Paradox installer"

$root = Resolve-Root
$installScript = Join-Path $root "install.ps1"

Write-Host ""
Write-Host "--- Plan ------------------------------------------"
Write-Host "Package:  $root"
Write-Host "Runtime:  pi"
Write-Host "Extras:   $(if ($NoExtensions) { 'none' } elseif ($NoLeanCtx) { 'no-lean-ctx' } else { 'all' })"
Write-Host "agentmemory: $(if ($WithAgentmemory) { 'yes' } else { 'no' })"
Write-Host "Dry run:  $(if ($DryRun) { 'yes' } else { 'no' })"
Write-Host "--------------------------------------------------"

$installArgs = @("-Scope", "global")
if ($DryRun) { $installArgs += "-DryRun" }
if ($NoExtensions) { $installArgs += "-NoExtensions" }
if ($NoLeanCtx) { $installArgs += "-NoLeanCtx" }
if ($WithAgentmemory) { $installArgs += "-WithAgentmemory" }
if (-not $DryRun -and -not $NoVerify) { $installArgs += "-Verify" }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript @installArgs
exit $LASTEXITCODE
