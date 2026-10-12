# Wireboard

A local diagram and slide editor with a Rust server, a browser-based SVG canvas, and a CLI for Codex. It includes a bundled font and autosave. The UI is currently in Russian; button names below are English translations. Running a packaged binary does not require Node.js, Vite, or an internet connection.

## Getting started

The main way to run Wireboard from source is with Docker Compose and [just](https://just.systems/man/en/): Docker Desktop on Windows/macOS or Docker Engine with Compose on Linux, plus just 1.58 or later. Docker must use Linux containers. You do not need Rust or Node.js on the host for this setup.

```sh
cd /path/to/Wireboard
just up
just open
```

In PowerShell, use `cd F:\SOFT\Wireboard` for this checkout. The first `just up` downloads images and builds the application; later runs use the cache. It waits for the server to become ready. `just open` opens your default browser. You can also open `http://localhost:9843/` directly or bookmark a board at `/b/<slug>`: login and one-time links are not required. The application listens only on `127.0.0.1:9843`. On Linux, opening the browser requires `xdg-open` and a configured default browser. On macOS, the container builds for Docker's architecture, including Apple Silicon.

Use `just ps` to check status, `just logs` to read logs, `just restart` to restart, and `just down` to stop. Boards live in a regular directory on your computer, which `down` preserves. `just` selects the same directory as the native binary: `%LOCALAPPDATA%\Wireboard` on Windows, `~/Library/Application Support/Wireboard` on macOS, and `$XDG_DATA_HOME/wireboard` (or `~/.local/share/wireboard`) on Linux. Set `WIREBOARD_DATA_DIR` to use another absolute path for either setup. On Linux, `just` also runs the container with your user's UID/GID. When using `docker compose` directly, set `WIREBOARD_DATA_DIR` and, on Linux, `WIREBOARD_UID`/`WIREBOARD_GID` in `.env` or your environment. The container starts again when Docker restarts unless you have stopped it. To change the port, copy `.env.example` to `.env`, set `WIREBOARD_PORT`, then run `just up` and `just open`. For example, port 9844 can coexist with a native server. The runtime uses a dedicated non-root user, and the frontend is embedded in the Rust binary. The build uses a [multi-stage Dockerfile](https://docs.docker.com/build/building/multi-stage/).

Docker and native builds share a local library when they use the same directory. Stop the current server before switching between them. When migrating from an older Docker volume, preserve complete documents as described below. To move between separate libraries, export and import JSON as a new board.

`just` reads `.env`, including `WIREBOARD_DATA_DIR`; an existing environment variable takes precedence. On Windows, `just up` checks that Docker can read a temporary marker in the selected host directory before starting the server. If this check fails, the library is preserved and startup stops. Choose an absolute folder Docker can access, for example `WIREBOARD_DATA_DIR=F:/SOFT/Wireboard-library`, and preserve the complete library when moving it: board documents, `links.json`, `backups`, and `requests`. Do not copy active runtime or lock files. Verify configuration with `node scripts/docker-config-test.mjs` during development.

### Running without Docker

On Windows, open `dist/windows-x86_64/launch.cmd` or run `./launch.cmd` from the project root. On macOS/Linux, run `chmod +x launch.sh wireboard`, then `./launch.sh` from the unpacked bundle. The server runs in the terminal and opens your default browser. Ctrl+C stops the server; closing the browser tab does not. If the server is already running, open another session with `wireboard open` (`wireboard.exe open` on Windows).

For a custom port or data directory, use `./launch.cmd --port 9844 --data-dir "D:\My Boards"` or `./launch.sh --port 9844 --data-dir "$HOME/My Boards"`. Use the same `--data-dir` with the CLI; it reads the port from the protected runtime file. Only one server can serve a directory at a time. The application does not install a startup service.

The editor opens at a regular local URL without an account, tokens in links, or browser cookies. Links and page reloads work without Host, Origin, or Fetch Metadata restrictions, and local API writes need no Origin header. The CLI uses the private runtime file in its data directory to distinguish the intended server from another server on the same port. Docker publishes the port only on loopback. Do not publish the runtime file.

On macOS, an unsigned local binary may need explicit approval in System Settings > Privacy & Security. The application is neither signed nor notarized. Build macOS binaries on the corresponding Mac; this bundle does not yet include verified Mac builds.

## Editor

Visual style C uses pastel cards with separate titles and descriptions, compact tools, and a local board/slide library on the left. Search filters titles. The selected board appears at `/b/<slug>`, which opens that board in any browser. The root URL shows the library without selecting an arbitrary board; a link to a missing board displays an explicit message. A contextual toolbar appears when you select an object; 'Properties' opens precise settings. Double-click opens an editor beside the object: Enter inserts a line, Ctrl/Cmd+Enter saves, and Escape cancels. Long text is truncated with an ellipsis; 'Fit height' reveals the description without changing the source text. Legacy `/?board=<id>` links remain compatible and redirect to the readable URL.

Following the October 10 refinement, new cards measure 220 by 112 board units, with 16 units of padding, slightly rounded corners, and centered text. Blue, yellow, mint, and lilac presets represent different roles. Connector labels use the configured font size and sit in available space near the route, taking slide boundaries into account. The starter diagram uses 200 by 96 blocks with wider gaps for labels. Existing boards are not recolored automatically; the starter diagram in the current project was restyled separately, with a backup and Undo support.

Press C or click 'Comment' to attach a discussion to a block, arrow, or canvas point. A compact popover opens beside the click and focuses the input immediately; Ctrl/Cmd+Enter sends the message. The popover closes automatically after a comment or reply is confirmed saved; failed or unconfirmed sends keep the draft and retry action available. Clicking a marker opens the thread and focuses the reply field. Drag the popover header to move the window without moving the marker or changing its anchor. Its position stays during live updates and resets when opening a discussion again. With the heading focused, arrow keys move the window by 10 pixels; Shift reduces the step to 1 pixel. Opening and closing the popover preserves the canvas position and zoom; 'Show on diagram' navigates to its anchor. 'Comments' opens the full list below the button: open threads and threads awaiting review appear by default, with resolved threads available through a filter. Resolved threads have no markers on the canvas, even when opened from the list. 'Hide markers on diagram' hides all remaining markers without changing discussions and remembers the preference in this browser; use 'Show markers on diagram' to restore them. Escape or a click outside the popover closes it while preserving the draft. Comments are saved with the board and follow their objects; after an object is deleted, they retain its last snapshot. Reply drafts stay in the current tab when switching boards. The agent acts when you ask it to 'review open comments'; see the [Codex/Claude instructions](docs/agents/wireboard-comments.md).

The editor supports blocks, text, labeled arrows, frames of any size, and raster images. Use a selection rectangle, Shift to select multiple objects, movement, eight resize handles, duplication, alignment, and colors in the properties panel. Double-click or Enter edits text. Moving a frame also moves its assigned descendants; duplication includes internal arrows. The '16:9 slide' preset is available in frame properties.

V selects, H activates the hand tool, R creates a block, T creates text, L connects two selected blocks, and F creates a frame. With R/T/F, drag to choose a size or click for the default; hold Shift during creation for a square. Space+drag pans the canvas. The mouse wheel and two-finger scrolling pan; Ctrl/Cmd+wheel or pinch zooms around the pointer. Shift+vertical wheel scrolls horizontally. Arrow keys move the selection by 1 board unit, or 10 with Shift. Ctrl/Cmd+A selects all, Ctrl/Cmd+C copies, Ctrl/Cmd+V pastes, Ctrl/Cmd+D duplicates, Delete removes, Ctrl/Cmd+Z undoes, and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes. Use Ctrl on Windows/Linux and Cmd on macOS. Physical key shortcuts work with both Russian and English keyboard layouts. Input fields keep their usual shortcuts. In presentation mode, arrow keys navigate and Escape exits.

Paste an image from the clipboard or choose a file (PNG/JPEG/WebP). JSON export/import transfers the entire board with embedded images. SVG and PNG export either the board or a selected slide. SVG files cannot be imported as images. CLI changes appear in the browser through SSE. If affected properties conflict, the action stays as a draft: you can inspect the changes and discard the unsaved action. Text drafts remain until you explicitly decide what to do with them.

## Codex and the CLI

The project's `AGENTS.md` and `CLAUDE.md` direct agents to the shared comment instructions; global settings are not changed. The project skill lives at `skills/wireboard/SKILL.md`. It is ready to use but is not installed globally. You can ask Codex to read it directly from the project.

With Compose, run commands from the project root through `just cli`. CLI input/output paths are **inside the container**; `upload` and `download` transfer files between the container and your computer:

```sh
just cli boards
just cli create --title "User and agent"
# Read BOARD_ID and revision from the create/inspect response.
just upload examples/agent-slide.json /data/operations.json
just cli apply BOARD_ID --revision 0 --file /data/operations.json
just cli render BOARD_ID --frame 1 --output /data/slide.png
just download /data/slide.png ./slide.png
just cli export BOARD_ID --output /data/board.json
just download /data/board.json ./board.json
```

Use the writable `/data` volume for `upload/download`: operation and export files there also survive `down`. Do not use the names `runtime.json`, `.lock`, or the `boards` directory for file transfers. `/tmp` is a tmpfs; [Docker cp has restrictions on copying these resources](https://docs.docker.com/reference/cli/docker/container/cp/#corner-cases). These commands work in PowerShell and POSIX shells; quote arguments containing spaces. `just open` keeps the private link only in the helper process's memory; do not publish the output of `open --print-url`.

PowerShell example with the server already running:

```powershell
$wireboard = 'F:\SOFT\Wireboard\dist\windows-x86_64\wireboard.exe'
& $wireboard boards
$board = (& $wireboard create --title 'User and agent' | ConvertFrom-Json)
& $wireboard inspect $board.id
& $wireboard apply $board.id --revision $board.revision --file 'F:\SOFT\Wireboard\examples\agent-slide.json'
& $wireboard render $board.id --frame 1 --output "$PWD\slide.png"
& $wireboard export $board.id --output "$PWD\board.json"
```

POSIX shell example:

```sh
./wireboard boards
./wireboard create --title 'User and agent'
# Read id/revision from the create or inspect response.
./wireboard inspect BOARD_ID
./wireboard apply BOARD_ID --revision 0 --file examples/agent-slide.json
./wireboard render BOARD_ID --frame 1 --output "$PWD/slide.png"
./wireboard export BOARD_ID --output "$PWD/board.json"
```

The CLI prints JSON. Errors are JSON on stderr with a nonzero exit code. `apply` accepts an operation array from a UTF-8 file, or stdin with `--file -`. The example using IDs 1 through 4 is suitable only for a new, empty board; use the board's `nextId` for an existing board. A stale revision returns a conflict without an automatic retry.

## Data and limits

The current board JSON format is version 3. Version 2 introduced object `title`/`fontWeight` fields and discussions with separate counters; version 3 adds explicit frame membership, described below. Legacy v1 documents can be read without being rewritten; the first successful edit saves the current format. Existing object text, colors, dimensions, and IDs are preserved without guessing titles. Export/import supports legacy v1/v2 documents, and export uses the current format. Before upgrading, save a JSON export or a backup of `boards/`; an older v1 binary cannot read the newer format. SVG/PNG exports, presentations, and thumbnails do not include discussions. Limits: 500 threads, 100 messages per thread, 10,000 messages per board, and 4,000 characters per message.

Data directories: `%LOCALAPPDATA%\Wireboard` on Windows; `~/Library/Application Support/Wireboard` on macOS; an absolute `$XDG_DATA_HOME/wireboard` on Linux, otherwise `~/.local/share/wireboard`. Boards live in `boards/*.json`, written through a temporary file and atomic replacement. Windows ACLs protect the runtime token; Unix permissions are 0600. The demo is created only in a new, empty directory. Corrupt data causes a startup error and is not overwritten.

Limits: 2,000 objects, 100 operations per transaction, 32 MiB of JSON, 8 MiB of source image bytes, and 16 million pixels after decoding. Coordinates range from -100,000 to 100,000; dimensions from 20 to 10,000; text is limited to 10,000 characters; zoom ranges from 10% to 400%. Undo/Redo stores up to 100 actions per actor and a 128 MiB journal per board, surviving restarts. The '16:9 slide' PNG preset is 1920 by 1080; a custom frame keeps its proportions. Whole-board PNG export is limited to 8192 pixels per side and 16 million pixels; use SVG for larger boards. Two render jobs can run concurrently; a busy renderer returns an explicit error.

If the result of a file replacement cannot be determined, the server blocks further reads and changes until it restarts, preventing memory and disk state from diverging. Drafts of unfinished actions stay in the current tab; finish or cancel them before closing it.

## Development and builds

Building requires Rust stable and Node.js 22.12 or later for the frontend. Windows requires MSVC Build Tools; Linux/macOS require a system C toolchain. Lockfiles are included.

```sh
npm ci
npm run typecheck
npm run build
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
cargo build --release --locked
npx playwright install
npm test
```

In PowerShell, use `npm.cmd`/`npx.cmd`. Build the frontend before Rust: production assets are embedded in the release binary. `.cargo/config.toml` enables the static C runtime on Windows. Build the Linux bundle with `rustup target add x86_64-unknown-linux-musl` and `cargo build --release --locked --target x86_64-unknown-linux-musl`. See the [Rust Reference](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes) for CRT configuration. The packaged application does not need the `frontend/dist` directory at runtime. `npm run release` performs both builds. `node scripts/package.mjs windows-x86_64 target/release/wireboard.exe` creates a local bundle; on Unix, provide your platform and `target/release/wireboard`.

For macOS, build manually on a Mac or use the GitHub Actions workflow at `.github/workflows/build.yml`, which covers Apple Silicon and Intel alongside Windows/Linux. Run the workflow manually from GitHub Actions.

`just build` builds the production Docker image, including Rust tests and frontend typechecking. To check a live Compose server during development, run `node scripts/docker-smoke.mjs` after building the image and running `npx playwright install chromium`. The check creates two separate Compose projects/volumes on ports 19849/19850. It checks simultaneous sessions in one browser, the CLI, export, and persistence after stopping, without stopping your application service. Override the test ports with `WIREBOARD_SMOKE_PORT` / `WIREBOARD_SMOKE_PEER_PORT`. This check requires Node.js only on the development machine.

## Platform verification

Docker/Compose was checked on Windows Docker Desktop with a Linux amd64 image: build, 30 Rust tests, editor, CLI, export, two browser sessions on different ports, and persistence after `down/up`. The local report is `work/docker/verification.md`. POSIX recipes were checked in WSL; an actual Docker arm64 build and opening the application on a Mac have not yet been checked separately.

| Platform | Checked locally |
| --- | --- |
| Windows x86_64 | Rust 1.96/MSVC, model/API/CLI, Chromium/Firefox/WebKit; release smoke test documented in `work/verification.md` |
| Linux x86_64 | Ubuntu 26.04.1 in WSL, Rust 1.99.0; bundle statically built for musl; tests and release smoke test documented in `work/verification.md`; native Linux GUI not checked separately |
| macOS arm64 / Intel | `cargo check` passed for aarch64-apple-darwin and x86_64-apple-darwin; linking and actual execution on a Mac remain unverified |

Minimum OS versions are not specified; verification covers the environments above. The Linux bundle is statically built with musl and does not depend on a specific glibc/libgcc version. Automatically opening the browser requires a system browser and an available Linux opener, such as `xdg-open`. The Linux workflow builds the same target on Ubuntu 22.04. Having a workflow does not establish that its build has passed.

Design documents: `DESIGN.md` and `docs/superpowers/plans/2026-10-06-wireboard.md`. Independent review results and decisions are recorded locally in `work/verification.md` and `work/progress.md`; `work/` is excluded from Git. Golos Text is distributed under the SIL Open Font License; see `frontend/public/fonts/OFL.txt`.

## Editor gestures and history

The F tool creates a frame of any size. Eight handles resize its bounds; side handles change one axis, and Shift preserves the proportions from the start of the gesture. Children do not scale and remain assigned to the frame even outside its new bounds. Properties include independent width/height, a '16:9 slide' preset (960 by 540), fitting to contents with 24 units of padding, and a separate action to delete the frame and its contents. Ordinary frame deletion preserves its children.

Drag in empty space inside a frame to select blocks. Drag its title or border to move the frame and all its children. Shift toggles selection. Moving a block highlights the target frame; releasing the pointer updates its coordinates and membership in one action. Escape cancels the active gesture. Space+drag pans the canvas while preserving the text draft; in an input field, Space remains a normal character.

Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl+Y use physical keys in both Russian and English keyboard layouts. Input fields retain ordinary text undo. History belongs to the current browser profile and survives restarts: up to 100 actions per actor and a 128 MiB journal per board. Independent agent text changes survive when you undo your own movement. Another client changing the same property, even if it restores an earlier value, causes a conflict. History from before this migration is not restored.

You can keep moving objects and queue Undo while a save is in progress. If a response is lost, 'Retry save' checks the receipt first. The retry preserves the original ID and request, so the action does not run twice. Discarding an action remains unavailable until its uncertain outcome has been checked.

Copying a selection includes descendants of selected frames and connectors between copied objects. External connectors, comments, and history stay on the source board. Pasting assigns new IDs and preserves nesting; one Undo reverses the whole paste. Each paste on the source board is offset by 24 units; the first paste on another board appears at the center of the visible area. Root objects receive frame membership based on their centers on the destination board. A copy can contain at most 50 objects, including connectors; exceeding this limit or using invalid clipboard data returns an error without a partial paste. Plain clipboard text creates a text object, and an image creates an image object. Clipboard events in input/textarea/select/contenteditable elements retain native behavior.

Holding arrow keys, repeated key events, and simultaneous arrow keys form one history step until the last key is released. Changing the action or selection, or losing focus, ends the sequence; Escape cancels movement that has not yet been sent. The step size does not depend on zoom, and a frame and its children are not moved twice. Ctrl/Cmd+Z during a sequence ends it and immediately undoes it. R/T/F creation is saved when the pointer is released; Escape, canceled pointer capture, and loss of focus leave no object behind. The preview shows dimensions in board units.

A single selected connector shows circular handles at its start and end. Drag a handle onto a block, text object, or image: highlighting shows the target and nearest attachment side. Frames and connectors are not targets, and a block cannot connect to itself. Dropping in empty space or on an invalid target preserves the original connection. Escape, loss of focus/capture, or switching tools cancels the gesture. Successfully moving an endpoint and its attachment side creates one Undo/Redo action; undo preserves agent text changes. Changed geometry, a deleted target, or another actor changing the endpoints causes a conflict instead of applying a stale attachment.

Canvas scrolling works on both axes. Ctrl/Cmd+wheel and pinch change zoom from 10% to 400%. The position under the pointer stays fixed except at camera coordinate limits. Navigation does not change the board or history and keeps text drafts and comments with the canvas; wheel input is ignored during a captured gesture. Panels scroll normally. Hardware pinch still needs checking on the specific touchpad; browser pinch events have been tested automatically.

## Agent commands and retry protection

Legacy operation arrays remain compatible, but without a command ID they have no protection against duplicate execution and do not appear in the browser's own Undo history. For new commands, supply all three flags:

```sh
just cli apply BOARD_ID --revision REV --file /data/operations.json --command-id UUID --actor-id codex-session --author codex
just cli command BOARD_ID UUID
```

For Claude, use `--author claude` and a separate `--actor-id`. For your own CLI history, use `--author user`, then `history BOARD_ID --revision REV --direction undo --target-command-id PREVIOUS_UUID --command-id NEW_UUID --actor-id SAME_ACTOR`. Each new action gets a new UUID; retrying a lost request uses the same UUIDs, revision, author, and file. The CLI saves the original request in `data-dir/requests` before sending it. Receipts remain available after restarts and pruning old Undo steps. A diagram export contains only the Board, without the journal, receipts, or runtime secrets.

Board v3 stores `parentFrameId`. An `update` with `parentFrameId:null` releases a block from its frame; omitting the field preserves membership. Moving a frame follows explicit membership relationships. Legacy diagrams receive membership once during migration, and their original bytes are saved in `backups/ux-v3`. To return to an older server, use its binary and a copy of the data directory from before the migration.

## Migrating from a Docker volume to a local library

Before the first `just up` with the new version, stop the old container, back up its `/data` with `docker cp`, then copy `boards`, `backups`, and `requests` into your chosen local directory. Preserve complete document files: they contain the board, comments, and history. Do not copy `runtime.json` or `.lock`, and do not overwrite different documents with the same ID. After starting, compare the board list and revisions. The old `wireboard_wireboard-data` volume remains a backup source; the new version does not delete it. One server serves one library; Docker and native builds are alternative ways to run it.

The `.library-lock` lock protects a shared library from two servers, including Windows and Docker together. A normal shutdown releases it. After a crash, first confirm that all servers using the library have stopped, then remove only `.library-lock` (the `owner` file and empty directory). Do not edit board files or `runtime.json` manually. The age of a lock is not proof that its server has stopped.

Boards have stable, readable URLs, such as `/b/inter-rao`. Cyrillic titles are transliterated; duplicate titles receive `-2`, `-3`, and so on. Renaming a board does not change its URL. Legacy `/?board=<id>` links open the same board and redirect to its slug. Internal UUIDs and board filenames remain unchanged. The `links.json` index stores mappings and reserves URLs of deleted boards; copy it with the library. It does not change board documents and must not be edited manually. The `boards` CLI command returns a `slug`; other commands still accept an `id`.
