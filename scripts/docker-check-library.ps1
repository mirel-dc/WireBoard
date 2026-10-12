# A healthy server can still be serving an empty, incorrectly shared directory.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/docker-native.ps1"
$probePath = $null
try {
    if (-not $env:WIREBOARD_DATA_DIR -or -not [System.IO.Path]::IsPathRooted($env:WIREBOARD_DATA_DIR)) {
        throw 'WIREBOARD_DATA_DIR must be an absolute local library path.'
    }
    $libraryRoot = (Resolve-Path -LiteralPath $env:WIREBOARD_DATA_DIR).Path
    $identity = [guid]::NewGuid().ToString('N')
    $probeName = '.wireboard-mount-check-' + $identity
    $probePath = Join-Path $libraryRoot $probeName
    [System.IO.File]::WriteAllText($probePath, $identity)
    $visible = Invoke-WireboardDocker -CaptureOutput -DockerArguments @(
        'compose', 'run', '--rm', '--no-deps', '--entrypoint', 'cat', 'wireboard', ('/data/' + $probeName)
    )
    if ($LASTEXITCODE -ne 0 -or $visible.Trim() -ne $identity) {
        throw "Docker cannot see the Windows library at $libraryRoot. Select a shared folder with WIREBOARD_DATA_DIR in .env. No server was started."
    }
    Write-Output "Verified Docker library: $libraryRoot"
} finally {
    if ($probePath -and (Test-Path -LiteralPath $probePath)) {
        Remove-Item -LiteralPath $probePath
    }
}
