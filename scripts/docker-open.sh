#!/bin/sh
set -eu
url=$(docker compose exec -T wireboard wireboard --data-dir /data open --print-url)
origin=${url%/}
case "$origin" in
    http://127.0.0.1) ;;
    http://127.0.0.1:*)
        port=${origin#http://127.0.0.1:}
        case "$port" in
            ''|*[!0-9]*) printf '%s\n' 'Invalid browser port.' >&2; exit 1 ;;
        esac
        [ "$port" -gt 0 ] && [ "$port" -le 65535 ] || { printf '%s\n' 'Invalid browser port.' >&2; exit 1; }
        ;;
    *) printf '%s\n' 'Wireboard returned an invalid browser origin.' >&2; exit 1 ;;
esac
case "$(uname -s)" in
    Darwin) opener=open ;;
    *)
        if command -v xdg-open >/dev/null 2>&1; then
            opener=xdg-open
        else
            printf '%s\n' 'Install xdg-open and configure a default browser, then run just open again.' >&2
            exit 1
        fi
        ;;
esac
# Openers may include the complete URL in an error message.
if "$opener" "$url" >/dev/null 2>&1; then
    printf '%s\n' "Wireboard opened at $origin"
else
    printf '%s\n' 'Cannot open the default browser. Configure it and run just open again.' >&2
    exit 1
fi
