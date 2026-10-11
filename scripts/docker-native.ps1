# Windows PowerShell 5.1 drops empty native arguments and embedded quotes.
# Serialize each argument using the Windows C runtime quoting rules instead.
function ConvertTo-WireboardNativeArgument {
    param([AllowEmptyString()][string]$Value)
    $escaped = [regex]::Replace($Value, '(\\*)("|$)', {
        param($match)
        $slashes = $match.Groups[1].Value
        if ($match.Groups[2].Value -eq '"') { return $slashes + $slashes + '\"' }
        return $slashes + $slashes
    })
    return '"' + $escaped + '"'
}

function Invoke-WireboardDocker {
    param([string[]]$DockerArguments, [switch]$CaptureOutput)
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = (Get-Command docker.exe -ErrorAction Stop).Source
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $start.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $quoted = foreach ($argument in $DockerArguments) { ConvertTo-WireboardNativeArgument -Value $argument }
    $start.Arguments = $quoted -join ' '
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $global:LASTEXITCODE = $process.ExitCode
        [Console]::Error.Write($stderr.GetAwaiter().GetResult())
        $output = $stdout.GetAwaiter().GetResult()
        if ($CaptureOutput) { return $output }
        [Console]::Out.Write($output)
    } finally {
        $process.Dispose()
    }
}
