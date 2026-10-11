# Editor Navigation and Connector Ends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement inline task-by-task. Steps use checkbox syntax. User explicitly requested immediate execution.

**Goal:** Smooth deterministic mouse/trackpad navigation and direct endpoint rewiring with own Undo.

**Architecture:** Camera-only wheel intents use existing CanvasView. A captured connector-end gesture previews a valid snapped or transient detached route; atomic endpoint updates use CommandQueue and geometry dependencies.

**Tech Stack:** TypeScript/SVG, Rust/axum, Playwright, Docker Compose.

**Spec:** docs/superpowers/specs/2026-10-10-editor-navigation-links-design.md

## Global Constraints

- Scroll pans; Ctrl/Cmd or pinch zooms at pointer; Shift vertical pans horizontally; no device detection.
- line=16 CSS px, page=canvas dimensions, delta cap ±2000, zoom exp(-deltaY*.002) with exponent delta ±1000; zoom .1–4, camera translation ±1e7.
- Handles hit 24 CSS px, mark 8; endpoint threshold 3 CSS px, candidate halo 12 CSS px. Target kinds rectangle/text/image; no self link or dangling end.
- Retain board v3, server contracts/dependencies, receipts/history; no new dependencies.
- Preserve all user boards and text drafts; no Git initialization/branch/publish and no unrequested comment processing.

## Review Focus

1. Wheel deltas/units at browser zoom and extreme or nonfinite values must not corrupt the camera or alter board history.
2. Wheel or tool/focus changes during pointer capture must not commit unexpected geometry or lose the endpoint preview.
3. Overlapping shapes, side halos and frames must choose a visible valid candidate without self links.
4. Agent endpoint changes/geometry ABA/deletion during a captured gesture must conflict, while text merges and own Undo preserves it.
5. Two rewires before ACK and lost responses must maintain endpoint stamps, no dropped/double actions or stale selection.

### Task 1: Wheel and trackpad navigation

**Files:** create frontend/src/navigation.ts; modify canvas.ts, interaction.ts, editor.ts, index.html; tests e2e/navigation-links.spec.ts.

**Interfaces:** produces `wheelIntent(event:Pick<WheelEvent,'deltaX'|'deltaY'|'deltaMode'|'ctrlKey'|'metaKey'|'shiftKey'>, viewport:{width:number;height:number}):{type:'pan';dx:number;dy:number}|{type:'zoom';factor:number}|null`, `CanvasView.pan(dx:number,dy:number):void`; consumes view.camera/worldPoint/zoom/onCamera and Interaction.active/finishNudge.

- [x] Write tests `navigation scroll pans two axes without revision`, `navigation modifier zoom anchors and clamps`, `navigation line page Shift and zero invalid deltas`, `navigation draft follows camera and wheel during capture is ignored` with exact spec values.
- [x] Run `npm.cmd exec -- playwright test e2e/navigation-links.spec.ts --project=chromium --grep navigation`; Expected: pan mapping/unit assertions fail before implementation.
- [x] Implement normalized pure intent, bounded pan, inert/dialog/gesture guards, nudge finish and anchored zoom; update hints.
- [x] Run typecheck/build and targeted navigation tests in all three engines. Expected: pass, revision and own history unchanged.
- [x] Record task completion/hashes in ledger (saved baseline replaces Git).

### Task 2: Connector ends

**Files:** modify anchors.ts, canvas.ts, interaction.ts, commands.ts; tests same file.

**Interfaces:** produces `connectorTarget(board:Board,link:Element,end:'from'|'to',point:Point,zoom:number):{id:number;port:Port}|null`, `connectorPreviewPoints(board:Board,link:Element,end:'from'|'to',point:Point,target:{id:number;port:Port}|null):Point[]`; `CanvasView.previewConnector(board:Board,id:number,end:'from'|'to',point:Point,target:...):void`, cleared by clearPreview. Interaction consumes editState once and sends update(endpoint+port) with captured base. makeGuards adds all endpoint/geometry fields only for endpoint updates.

- [x] Write tests for both ends/ports+preview before commit and one Undo/Redo; 24px handles at low/high zoom; empty/self/frame/click cancellation; Escape/blur/lost capture/tool change; text merges and own Undo; agent geometry/ABA/endpoint/deletion conflicts; delayed ACK two rewires and lost response.
- [x] Run targeted Chromium `--grep connector`; Expected: missing end handles.
- [x] Implement captured geometric candidate resolution (frontmost nonconnector canvas order), route preview/caption translation, handles and highlight; cancel on boundaries and commit changed endpoint+port once. Guard old/new geometry and four endpoint fields. Preserve existing move/resize/create and L tool.
- [x] Run typecheck/build and entire new file in all three engines. Expected: all cases pass with no skipped new tests.
- [x] Record task completion in ledger.

### Task 3: Review, full verification and activation

**Files:** README.md; verification/2026-10-10-editor-navigation-links.md; plan and ledger; packaged artifacts.

**Interfaces:** consumes deliverables above; produces current healthy 9843 service and original-board preservation proof.

- [x] Run typecheck/build, `cargo test --locked`, `npm.cmd test`; Expected: green with only existing 3 platform skips.
- [x] Dispatch one fresh whole-change reviewer per executing-plans using saved baseline/spec/plan/ledger and Review Focus; fix Important/Critical in one RED→GREEN pass, rerun full suite; ledger rulings/deferred minors.
- [x] Document shortcuts/target and cancellation semantics; rebuild Windows release, static musl Linux and Compose. Run packaged native/API/browser and isolated Docker smoke; Expected: exit0 with evidence artifacts.
- [x] Tag old image, save stopped-data snapshot; activate normal service; disposable-board scroll/zoom/endpoint/Undo plus agent-text proof; delete only owned proof board, compare all original inspections/catalog exactly.
- [x] Refresh user browser, write report/hashes, mark plan complete, retain baseline/ledger instead of Git cleanup.

Execution completed inline. Browser refresh was requested through the host; `open_in_codex` returned queued because this task was not shown. The normal 9843 proof verified the new bundle and behavior; visible old tabs were not counted as refreshed. See the verification report for this delivery boundary and final Docker recovery.
