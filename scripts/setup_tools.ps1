# Downloads the reconstruction tools into ./tools (git-ignored). Windows x64.
#   COLMAP (CUDA build)  - camera poses + sparse model   https://github.com/colmap/colmap
#   Brush                - Gaussian-splat training, WebGPU (no CUDA toolkit needed)
#                                                         https://github.com/ArthurBrussee/brush
#   ffmpeg               - video -> frames (via winget if missing)
$ErrorActionPreference = 'Stop'
$tools = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools'
New-Item -ItemType Directory -Force $tools | Out-Null

function Get-Zip($name, $url, $dest) {
    if (Test-Path $dest) { Write-Host "$name already present"; return }
    $zip = Join-Path $tools "$name.zip"
    Write-Host "Downloading $name ..."
    Invoke-WebRequest $url -OutFile $zip
    Expand-Archive $zip -DestinationPath $dest
    Remove-Item $zip
}

Get-Zip 'colmap' 'https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-cuda.zip' (Join-Path $tools 'colmap')
Get-Zip 'brush'  'https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip' (Join-Path $tools 'brush')

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    Write-Host 'ffmpeg installed - open a new terminal so PATH updates.'
}

py -3.12 -m pip install opencv-python-headless numpy
Write-Host 'Done.'
