# Editor UX Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. User requested inline planning and immediate implementation.

**Goal:** Native-feeling copy/paste, arrow movement, and drag creation with reliable own Undo.

**Architecture:** Clipboard snapshots become existing atomic create/update batches. Interaction owns transient gesture/keyboard previews. CommandQueue remains the sole write path, with sequential allocation stamps and acknowledged creation selection.

**Tech Stack:** Vanilla TypeScript/SVG, Rust/axum, Playwright, Docker Compose.

**Spec:** docs/superpowers/specs/2026-10-10-editor-ux-actions-design.md

## Global Constraints

- Keep board v3 and existing atomic apply/auth/history/receipt contracts; no new dependencies.
- Arrow step 1, Shift step 10; clipboard offset 24; paste maximum 50 objects; drag bounds 20–10000.
- Text and modal focus retain native clipboard/arrows/Undo; preserve real user data and comments.
- No Git initialization, branch, commit or publish. Save baseline and progress ledger for this plan.
- User explicitly requests immediate execution; no additional approval handoff.

## Review Focus

1. Concurrent allocation and delayed acknowledgements must not reuse IDs or hijack subsequent selection.
2. Malformed clipboard payload, cycles and dangling endpoints must never partially insert or execute anything.
3. Rapid action changes, overlapping held arrows and blur must finish exactly one coherent series.
4. Reverse/zero-distance creation, zoom and cancellation must preserve exact world geometry.
5. Agent writes during arrow series and lost paste acknowledgement must preserve independent edits and never duplicate a commit.

### Task 1: Clipboard and creation allocation

**Files:** create frontend/src/clipboard.ts; modify frontend/src/commands.ts, frontend/src/editor.ts; test e2e/ux-actions.spec.ts.

**Interfaces:** consumes Board, Element, Operation, EditState, CommandQueue.enqueue/makeGuards; produces copySelection(board,ids): ClipboardSnapshot|null, parseClipboard(text): ClipboardSnapshot|null, pasteSelection(snapshot,board,offset): {operations:Operation[],ids:number[]}, Editor.createObjects(operations,ids,base,label).

- [x] Write tests: copied frame includes nested children and only internal connector; paste remaps IDs/parents/endpoints, does not copy comments; Undo/Redo restores whole cluster; two queued pastes allocate distinct IDs; native text clipboard remains native; plain text creates text; malformed typed snapshot is rejected atomically; late ACK does not replace newer selection.
- [x] Run `npm.cmd exec -- playwright test e2e/ux-actions.spec.ts --project=chromium --grep clipboard`; Expected: assertions fail because clipboard is absent.
- [x] Implement strict versioned clipboard payload with 50-object limit, safe scalar/schema checks and parent/connector integrity; capture snapshot via copy and paste events. Build create/update batches with explicit IDs and parent remapping. Account for nextId stamps in queued projections; acknowledged selection uses generation token, including recovery callback after lost response.
- [x] Run typecheck, build, targeted Chromium file. Expected: clipboard cases pass.
- [x] Save task result and changed file hashes in this plan's ledger.

### Task 2: Grouped arrow movement

**Files:** modify frontend/src/interaction.ts, frontend/src/editor.ts; test e2e/ux-actions.spec.ts.

**Interfaces:** produces Interaction.active, nudgeKey(event):boolean, releaseNudge(code):void, finishNudge(cancel?:boolean):void. Consumes captured EditState and existing members/dropTarget/apply guards.

- [x] Write tests: repeated right + Shift down gives x103/y110 after keyup, one Undo/Redo; held two arrows finish on last release; frame+selected child move once; native input arrows do not move board; Escape cancels; action change/blur commits; agent text survives Undo, agent position conflict appears.
- [x] Run targeted Chromium arrow tests; Expected: no board movement.
- [x] Implement one captured base and cumulative preview per series; commit move + root reparent atomically, integrate all action/focus/refresh boundaries without dropping pending operations.
- [x] Run typecheck/build and targeted Chromium tests. Expected: all arrow cases pass.
- [x] Record result in ledger.

### Task 3: Drag creation

**Files:** modify frontend/src/interaction.ts, frontend/src/canvas.ts, frontend/src/editor.ts, frontend/index.html; test e2e/ux-actions.spec.ts.

**Interfaces:** produces CanvasView.previewCreate(bounds,kind), clear creation preview via clearPreview; consumes Editor creation callback and captured EditState. Create gesture captures pointer and world start/end.

- [x] Write tests: reverse drag gives positive width/height and exact normalized position; all R/T/F kinds and Shift square; click uses exact defaults; cancel/blur creates nothing; two creations queued before ACK stay distinct; late acknowledgement respects changed selection.
- [x] Run targeted Chromium creation tests; Expected: creation happens prematurely on pointerdown and wrong bounds.
- [x] Replace click creation with captured gesture, screen threshold 3 px; normalize bounds, clamp size, draw temporary SVG outline + dimensions; commit once on release, select acknowledged IDs with generation token, return to select tool. Include accessible tool hints.
- [x] Run typecheck/build and full ux-actions file in all three browsers. Expected: all functional cases pass.
- [x] Record result in ledger.

### Task 4: Verify, review, document, activate

**Files:** README.md; docs/superpowers/verification/2026-10-10-editor-ux-actions.md; this plan and ledger; deploy artifacts.

**Interfaces:** consumes all prior deliverables; produces verified current Compose UI and preserved original board, packaged Windows and static musl Linux artifacts.

- [x] Run `cargo test`, `npm.cmd test` after typecheck/build. Result: 82 Rust passed; 207 browser passed, 3 skipped (two preexisting zoom cases plus Windows WebKit OS clipboard, documented in verification report).
- [x] One fresh whole-change reviewer per executing-plans, with baseline, spec, plan, ledger and Review Focus. Fix Important/Critical findings once with RED→GREEN and full suite; ledger deferred minors/rulings.
- [x] Document shortcuts, clipboard limits and gesture semantics. Build Windows release, static musl Linux package, Compose image. Run packaged CLI/API smoke and Docker isolated smoke. Expected: exit0 with completed verification artifacts.
- [x] Save new rollback image and stopped `/data` snapshot; activate normal 9843 Compose, verify image/health, original board/catalog unchanged, perform disposable-board live proof and delete only that proof board.
- [x] Write verification report, mark steps completed, open refreshed browser UI with private grant. Expected: original user board preserved; current served bundle includes all three functions.
