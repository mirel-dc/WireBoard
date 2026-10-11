# UX actions — verification, 2026-10-10

Implemented the [spec](../specs/2026-10-10-editor-ux-actions-design.md) and [plan](../plans/2026-10-10-editor-ux-actions.md) inline with Superpowers. The current normal service at http://127.0.0.1:9843 serves `/assets/index-Bm93kZ9P.js`; the existing in-app browser tab was refreshed and its script URL and new keyboard hint were checked.

## Delivered behavior

- Ctrl/Cmd+C/V copies selected objects, frame descendants and internal connections, remapping IDs, parents and endpoints. External connections, comments and history are excluded. Each insertion is atomic and undoable. Same-board offset is 24 units; first cross-board paste centers in the viewport. Maximum 50 objects including connections. Ordinary clipboard text creates text; Windows CRLF/lone CR is normalized to LF. Text fields retain native clipboard behavior.
- Arrows move by 1 board unit; Shift moves by 10. Repeats and overlapping held arrows form one history entry until the last release. Frame descendants move once. Escape cancels a pending series; action/focus changes finish it. Own Undo preserves independent agent text and reports geometry conflicts.
- R/T/F creates by dragging with a transient size preview, reverse-direction bounds and Shift square. Click retains default size. Creation commits on release; Escape, lost pointer capture and blur leave no object. Pending creations allocate distinct guarded IDs; late acknowledgements do not replace newer selection.

## Final verification

All commands were run after the review fix and final frontend build:

| Check | Result | Evidence |
|---|---|---|
| `npm.cmd run typecheck`, `npm.cmd run build` | passed | final bundle listed above |
| `cargo test --locked` | 82 passed | `.superpowers/sdd/2026-10-10-editor-ux-actions/rust-tests-final.log` |
| `npm.cmd test` | 207 passed, 3 skipped, 210 collected; 5.6 min | `full-browser-final.log` in the same ledger folder |
| Windows release + packaged browser/CLI/API/restart smoke | passed | `work/release-smoke-win32-1791630867011`, `windows-smoke-final.log` |
| Linux x86_64 musl static binary + packaged CLI/API/restart smoke | passed; ELF has no PT_INTERP | `work/ux-actions-native-linux-smoke/release-smoke-linux.json` |
| Compose image + isolated two-port browser smoke | passed | `work/docker-smoke-1791630870214/verification.json` |
| Live normal 9843 UX proof | passed | `work/normal-ux-actions-1791631184535/verification.json` |

Browser coverage includes native OS copy/paste in Chromium and Firefox, nested-frame clipboard, malformed/cyclic/dangling payloads, two pastes before ACK, cross-board paste, lost response/replay, stale frame dependencies, grouped arrows, early Undo, concurrent agent text/geometry, reverse creation, cancellation and queued drag creation.

Three skips: preexisting real browser 200% zoom cases in Firefox/WebKit, plus the native OS clipboard case in Windows Playwright WebKit. A generic copy handler without Wireboard also writes empty OS clipboard text there. All event-payload clipboard cases and the multiline regression pass in WebKit. Native Safari system clipboard is unverified. Native macOS and Docker arm64 were not executed.

## Review

One fresh read-only whole-change reviewer compared the baseline, spec, plan and ledger. One Important finding: plain multiline paste forwarded CRLF/lone CR rejected by server text validation. It was fixed in one RED→GREEN pass with persisted multiline text plus Undo tested in all three engines; the full suite was then rerun. No Critical findings, no deferred Minor findings. See `.superpowers/sdd/2026-10-10-editor-ux-actions/final-review.md`.

## Activation and preservation

Running image: `sha256:ce5cfee804dcbb0db52de6ac23a6c6bd0c04a5de6e4f263449601b68bcd79c6d`, healthy.

Rollback image retained as `wireboard:pre-ux-actions-20261010`: `sha256:d7f35c16d1fb75c0c12b5a8f8c69a2fb20e9672f5456ce90e3c5c2e297310345`.

Stopped-data snapshot: `work/ux-actions-backup-20261010-1791630941299/data`. Fresh catalog and full board inspections match exactly before and after activation. This phase does not change board v3 or migrate stored boards. Previous rollback artifacts are retained too.

Live proof used one owned temporary board: grouped arrows → Undo/Redo → real Ctrl+C/V → reverse drag with preview → agent text update → own Undo retaining that text. Only the owned temporary board was deleted. Original catalog and full inspections matched again afterward. Screenshot: `work/normal-ux-actions-1791631184535/creation-preview.png`.

Packaged binary SHA-256:

- `dist/windows-x86_64/wireboard.exe`: `e7387cb25e086dca049653cdc6866fc375c75ba928752e395848af6475e8e934`
- `dist/linux-x86_64/wireboard`: `db2755ac663aac329e6a2cbb533e9ec1fe4d0092811dc9faca8306f2cca72091`

Final source/bundle/package hashes: `.superpowers/sdd/2026-10-10-editor-ux-actions/final-hashes.json`. This repository has no Git; no Git initialization, branch, commit or publication was performed. Baseline and ledger are retained for manual comparison and rollback.

## Execution rulings

1. Retain saved baseline and ledger instead of Git commits/worktree cleanup, preserving the user's no-initialization boundary. Cost: manual source rollback requires baseline comparison.
2. Skip only Windows WebKit real OS clipboard integration after reproducing generic clipboard writes failing outside Wireboard; retain all payload tests. Cost: native Safari clipboard remains unverified; Chromium/Firefox OS integration is proven.
3. Accept the final review's native Safari coverage boundary. Cost: a separate live Safari check is needed to establish that platform's system clipboard behavior.

Wheel/pinch changes and connector endpoint editing are outside this phase.
