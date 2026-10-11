set minimum-version := '1.58.0'
set quiet
library_default := if os() == 'windows' { env_var('LOCALAPPDATA') / 'Wireboard' } else if os() == 'macos' { env_var('HOME') / 'Library/Application Support/Wireboard' } else { (if env_var_or_default('XDG_DATA_HOME', '') =~ '^/' { env_var('XDG_DATA_HOME') } else { env_var('HOME') / '.local/share' }) / 'wireboard' }
export WIREBOARD_DATA_DIR := env_var_or_default('WIREBOARD_DATA_DIR', library_default)
export WIREBOARD_UID := if os() == 'windows' { '10001' } else { shell('id -u') }
export WIREBOARD_GID := if os() == 'windows' { '10001' } else { shell('id -g') }
[windows]
set shell := ['powershell.exe', '-NoProfile', '-Command']
[unix]
set shell := ['sh', '-eu', '-c']

# Show available commands.
default:
    just --list

# Build and start Wireboard; wait for the health check.
up: prepare-library
    docker compose up --build --detach --wait --wait-timeout 120

[private]
[windows]
prepare-library:
    New-Item -ItemType Directory -Path $env:WIREBOARD_DATA_DIR -Force | Out-Null

[private]
[unix]
prepare-library:
    mkdir -p -- "$WIREBOARD_DATA_DIR"

# Build the image without starting the server.
build:
    docker compose build

# Open the local library in this computer's default browser.
[windows]
[script('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')]
open:
    & ./scripts/docker-open.ps1
    exit $LASTEXITCODE

[unix]
[script('sh', '-eu')]
open:
    exec sh ./scripts/docker-open.sh

# Stop the server and keep all boards in the local library folder.
down:
    docker compose down

# Follow server logs (Ctrl+C stops following).
logs:
    docker compose logs --follow --tail 100

# Show service status and localhost port.
ps:
    docker compose ps

# Restart and wait until the server is ready again.
restart:
    docker compose restart
    docker compose up --detach --wait --wait-timeout 120

# Run CLI commands inside the container, preserving argument boundaries.
[windows]
[script('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')]
[positional-arguments]
[no-exit-message]
cli +arguments:
    . ./scripts/docker-native.ps1
    Invoke-WireboardDocker -DockerArguments (@('compose', 'exec', '-T', 'wireboard', 'wireboard', '--data-dir', '/data') + $args)
    exit $LASTEXITCODE

[unix]
[script('sh', '-eu')]
[positional-arguments]
[no-exit-message]
cli +arguments:
    exec docker compose exec -T wireboard wireboard --data-dir /data "$@"

# Copy a host input file to the writable volume (for example /data/operations.json).
[windows]
[script('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')]
[positional-arguments]
upload source destination:
    . ./scripts/docker-native.ps1
    Invoke-WireboardDocker -DockerArguments @('compose', 'cp', $args[0], ('wireboard:' + $args[1]))
    exit $LASTEXITCODE

[unix]
[script('sh', '-eu')]
[positional-arguments]
upload source destination:
    exec docker compose cp "$1" "wireboard:$2"

# Copy a rendered/exported file from the container to this computer.
[windows]
[script('powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')]
[positional-arguments]
download source destination:
    . ./scripts/docker-native.ps1
    Invoke-WireboardDocker -DockerArguments @('compose', 'cp', ('wireboard:' + $args[0]), $args[1])
    exit $LASTEXITCODE

[unix]
[script('sh', '-eu')]
[positional-arguments]
download source destination:
    exec docker compose cp "wireboard:$1" "$2"
