# Installs the reconstruction tools. Windows x64, NVIDIA GPU. Safe to re-run: finished steps are skipped,
# half-finished downloads/extractions are redone, and any failing step stops the script with an error.
#   COLMAP 4.2.1 (CUDA build) -> tools\colmap         camera poses + sparse model   https://github.com/colmap/colmap
#   Brush 0.3.0               -> tools\brush          Gaussian-splat training (WebGPU, no CUDA toolkit)
#   splat-transform 3.10.3    -> tools\splat-transform  .ply -> .sog/.spz for the web (needs Node.js >= 22)
#   ffmpeg, Node.js           -> winget, if missing
#   Python venv               -> .venv (opencv-python-headless, numpy)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest many times slower on PS 5.1
$root = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Force $tools | Out-Null

# Native commands do not trip $ErrorActionPreference, so check their exit codes explicitly.
function Invoke-Checked([string]$what, [scriptblock]$cmd) {
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

function Update-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# Download + extract into a temp folder, then rename into place; a '.complete' marker means it finished.
# A folder without the marker is from an interrupted run and is deleted and redone.
function Get-Zip([string]$name, [string]$url, [string]$sha256 = '') {
    $dest = Join-Path $tools $name
    $marker = Join-Path $dest '.complete'
    if (Test-Path $marker) { Write-Host "$name already installed"; return }
    if (Test-Path $dest) { Write-Host "$name is incomplete from an earlier run; reinstalling"; Remove-Item -Recurse -Force $dest }
    $zip = Join-Path $tools "$name.zip.partial"
    $tmp = Join-Path $tools "$name.extracting"
    Remove-Item -Recurse -Force $zip, $tmp -ErrorAction SilentlyContinue
    Write-Host "Downloading $name ..."
    Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
    if ($sha256) {
        $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
        if ($got -ne $sha256) { Remove-Item $zip; throw "$name download is corrupt (sha256 $got, expected $sha256). Re-run." }
    }
    Expand-Archive $zip -DestinationPath $tmp
    Move-Item $tmp $dest
    Remove-Item $zip
    New-Item -ItemType File $marker | Out-Null
    Write-Host "$name installed"
}

Get-Zip 'colmap' 'https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-cuda.zip'
Get-Zip 'brush' 'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip' `
    'b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6'

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Invoke-Checked 'winget install ffmpeg' { winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements }
    Update-Path
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'ffmpeg installed but not on PATH yet: open a new terminal and re-run this script.' }
}

function Get-NodeMajor {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return 0 }
    return [int]((& node --version).TrimStart('v').Split('.')[0])
}
if ((Get-NodeMajor) -lt 22) {
    Invoke-Checked 'winget install Node.js' { winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements }
    Update-Path
    if ((Get-NodeMajor) -lt 22) { throw 'Node.js >= 22 is needed: open a new terminal and re-run this script.' }
}

$st = Join-Path $tools 'splat-transform'
if (-not (Test-Path (Join-Path $st '.complete'))) {
    Remove-Item -Recurse -Force $st -ErrorAction SilentlyContinue
    Invoke-Checked 'npm install splat-transform' { npm install --prefix $st --no-audit --no-fund '@playcanvas/splat-transform@3.10.3' }
    New-Item -ItemType File (Join-Path $st '.complete') | Out-Null
}

# Python: a project venv, so nothing is installed globally. Prefer 3.12 (what the pipeline was tested on).
$venvPy = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    $py = $null
    foreach ($v in '-3.12', '-3.13', '-3.11') {
        try { & py $v -c 'import sys' *> $null } catch { continue }   # no py launcher, or that version missing
        if ($LASTEXITCODE -eq 0) { $py = $v; break }
    }
    if (-not $py) { throw 'Python 3.11-3.13 not found. Install it: winget install Python.Python.3.12, then re-run.' }
    Invoke-Checked 'create .venv' { py $py -m venv (Join-Path $root '.venv') }
}
Invoke-Checked 'pip install' { & $venvPy -m pip install --disable-pip-version-check opencv-python-headless numpy }

Write-Host ''
Write-Host 'Done. Check everything with:'
Write-Host '  .venv\Scripts\python pipeline\run_pipeline.py --doctor'
