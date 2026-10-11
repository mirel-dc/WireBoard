$ErrorActionPreference = 'Stop'
$result = & docker compose exec -T wireboard wireboard --data-dir /data open --print-url
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$url = ($result -join "`n").Trim()
if ($url -cnotmatch '^http://127\.0\.0\.1(?::[0-9]+)?/$') {
    throw 'Wireboard returned an invalid local URL.'
}
try {
    Start-Process -FilePath $url
} catch {
    Write-Error 'Cannot open the default browser. Configure it and run just open again.'
    exit 1
}
Write-Host ('Wireboard opened at ' + $url)
exit 0
