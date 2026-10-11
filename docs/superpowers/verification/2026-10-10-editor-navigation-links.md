# Navigation and connector ends — verification, 2026-10-10

Implementation follows [design](../specs/2026-10-10-editor-navigation-links-design.md) and [plan](../plans/2026-10-10-editor-navigation-links.md), executed inline with Superpowers. Final source checks, packages, activation and live preservation proof completed; the host browser opening is queued as described below.

## Delivered behavior

- Wheel/two-finger scrolling pans in both axes; Shift maps vertical scroll to horizontal. Ctrl/Cmd+wheel and browser pinch wheel events zoom about the cursor. Delta modes normalize to CSS pixels; zoom is 10–400%, translation bounded to ±1e7. Navigation never writes board history. Captured pointer gestures, presentation and modal dialogs ignore wheel navigation. Text drafts follow the camera without losing text.
- A selected connection exposes both ends with 24 CSS px hit areas and 8 px marks at any camera zoom. Drag previews the route, caption and destination; nearest actual side midpoint supplies the port. Rectangle, text and image targets are allowed; self links, frames and empty drops cancel. Escape, lost capture, window blur, tool change, focus leaving the canvas and history cancel the gesture.
- Endpoint plus port commit atomically on release as one own Undo action. Independent agent text merges and remains through Undo/Redo. Captured endpoint/geometry dependencies reject changed geometry, ordinary ABA writes, endpoint changes and deleted nodes. Delayed ACK and lost-response receipts keep queued gestures distinct.

## Fresh checks

| Check | Result | Evidence |
|---|---|---|
| Frontend typecheck/build | passed | final JS `/assets/index-BCR9ZqUw.js` |
| Rust suite | 82 passed | `.superpowers/sdd/2026-10-10-editor-navigation-links/rust-tests-final.log` |
| New navigation/endpoint file before review fixes | 51 passed, three engines | `actions-green-final.log` |
| Review regression RED then GREEN | 3 failures then 9 passed | `review-red.log`, `review-green.log` |
| Full browser suite after fixes | 267 passed, 3 existing skips, 270 collected; 17.0 min | `full-browser-final.log` |
| Windows release/package/browser/CLI/API/restart | passed | `windows-smoke-final.log`; `work/release-smoke-win32-1791645663376` |
| Static Linux package/API/restart | passed; ELF x86_64 has no PT_INTERP | `linux-build-final.log`, `linux-smoke-final.log`; `work/navigation-links-native-linux-smoke/release-smoke-linux.json` |
| Compose isolated browser smoke | passed; two private ports, volumes retained | `work/docker-smoke-1791646378062/verification.json` |
| Normal 9843 activation and preservation | passed; one original board unchanged, proof board removed | `work/normal-navigation-links-1791646726708/verification.json`; `activation-verification.json`, `final-runtime.json` in ledger |

## Review and decisions

One fresh read-only whole-change review; no re-review. Focus-away cancellation was Important. Actual midpoint selection was regraded from Minor to Important because wide short blocks could snap hundreds of units away. Both findings reproduced RED and passed in all engines after the sole fix pass. Full suite follows the fixes. Review: `.superpowers/sdd/2026-10-10-editor-navigation-links/final-review.md`.

Deferred Minor: outside two overlapping bodies, an invalid opposite-end halo can suppress a valid halo beneath it. Enter the intended body or its exposed halo.

All execution rulings and their costs are recorded in `.superpowers/sdd/2026-10-10-editor-navigation-links/progress.md`. Boundaries: physical device pinch/OS settings and new gestures at actual browser zoom are unverified; existing actual Chromium 200% editor zoom smoke and all-engine camera zoom tests are separate evidence. History intentionally restores original stamps on Undo, so exact geometry restoration differs from two ordinary ABA writes. Existing hand-pan/fit/reveal extremes and exhaustive device/layout assessment are outside this phase. No Git/PR/CI verdict; baseline and ledger retained.

## Runtime recovery and rollback

Docker Desktop was unavailable independently of Wireboard and crashed on inaccessible stale sockets. Checked same-parent directory renames preserved the one-socket directories at:

- `C:/Users/mirel/AppData/Local/docker-secrets-engine.wireboard-recovery-20261010-1791645723`
- `C:/Users/mirel/AppData/Local/Docker/run.wireboard-recovery-20261010-1791645860`

Crashed Desktop processes were restarted hidden. Container volumes were untouched. Engine recovered and the existing 9843 service became healthy.

Old image retained as `wireboard:pre-navigation-links-20261010`: `sha256:ce5cfee804dcbb0db52de6ac23a6c6bd0c04a5de6e4f263449601b68bcd79c6d`.

Stopped-data snapshot: `work/navigation-links-backup-20261010-1791646695472/data`. Active healthy image: `sha256:c10b8b7fa384e47182c0c5362ed0dfaf6b6c8e320335d662aea933f72c6578fb`. Fresh original catalog and complete inspections match exactly before/after activation and again after final Docker recovery. Live proof: `work/normal-navigation-links-1791646726708/verification.json`, screenshot `endpoint-preview.png`; served asset `/assets/index-BCR9ZqUw.js`. Proof helper deletes only its uniquely identified owned board; failure cleanup is best-effort and cannot be presumed. No user comment processing or direct board-store JSON edits were performed. No schema migration, Git initialization, branch, commit or publication.

The three skips are preexisting: real browser zoom smoke in Firefox/WebKit and Windows WebKit OS clipboard integration. No new test is skipped. Native macOS, actual Safari/device pinch and Docker arm64 were not executed.

A later Docker shutdown interrupted the final browser refresh. Runtime directories were also preserved at `C:/Users/mirel/AppData/Local/docker-secrets-engine.wireboard-recovery-20261010-final-1791647033` and `C:/Users/mirel/AppData/Local/Docker/run.wireboard-recovery-20261010-final-1791647033`; Desktop restarted hidden. The exact new image is healthy again and all original inspections/catalog matched after recovery (`final-runtime.json`). No factory reset, volume deletion or global setting change.

Browser delivery: `open_in_codex` returned `status: queued` for this task, so an authorized fresh editor opening will appear when the task is shown. Existing inspected tabs still contained the older bundle/expired session; they were not falsely counted as visibly refreshed. The new served bundle and browser behavior were verified independently by the normal 9843 live proof.

Final binary SHA-256:

- Windows: `0d72066451b1eadaca2cac192b896c904b77c6260f961ec99e792c16c954db55`
- Linux static: `d64bf70f9d235bbe4e21fd7e8325cf4305ce09af1106445cd37e9a71140363e7`

Source, bundle, package and documentation hashes: `.superpowers/sdd/2026-10-10-editor-navigation-links/final-hashes.json`. Baseline and ledger retained because this workspace has no Git.
