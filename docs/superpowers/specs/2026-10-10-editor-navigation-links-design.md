# Editor navigation and connector ends

The user requests the next UX phase with a Superpowers plan and immediate inline implementation. Purpose: navigate a diagram smoothly with mouse/trackpad and change existing connections directly on the canvas, retaining reliable own Undo and agent concurrency. This affects shared gesture, camera and command interfaces, so use the architectural design/plan path. The explicit immediate-execution instruction overrides additional approval handoffs.

## Chosen behavior

Confirmed by the user: ordinary wheel/two-finger scroll pans both axes; Ctrl/Cmd+wheel and trackpad pinch (browser ctrl-wheel events) zoom around the pointer. Shift+vertical wheel pans horizontally unless the browser already supplies horizontal delta. Normalize deltaMode pixel/line/page with line=16 CSS px and page=canvas dimensions; cap each normalized delta to ±2000. Zoom factor is exp(-clamped(deltaY,±1000)*.002), range 10–400%. Camera translation is limited to ±1e7 CSS px; clamping takes precedence over exact cursor anchoring at these extremes; no heuristic attempts to distinguish mouse from trackpad. Camera changes do not write board/history; inline text draft and comment pins follow camera. Ignore canvas wheel during pointer gestures, dialogs and presentation; finish held-arrow series before camera changes. Panels retain native scrolling.

Alternatives considered: always zoom (poor two-axis trackpad navigation); heuristic device detection (unstable browser/device classifications); deterministic modifier mapping (chosen, explicit and testable). Real physical trackpad behavior needs hardware validation; automated browser events prove the event contract.

For one selected connector, show two 24 CSS px hit areas with 8 CSS px circular marks at its actual route ends. Drag either end to a rectangle, text or image; frames/connectors and the opposite end's object are invalid. Candidate resolution uses captured board geometry, pointer coordinates and frontmost canvas stacking, not event.target under pointer capture. Visible block bodies have priority over another block's halo; within body/halo classes choose the frontmost captured scene order. The nearest side midpoint is the explicit new port; ties left/right/top/bottom. Highlight candidate outline and side port. Inside a block chooses its nearest side; a halo of 12 CSS px allows dropping directly on its border.

During drag show the route/caption preview with the active end following the pointer in empty space or snapping to the candidate's side. Capture EditState once at pointerdown. Release on a valid changed target/port submits one atomic update of that endpoint and port. Click without movement >3 CSS px is a no-op. Same target/same port is a no-op. Empty/invalid drop, Escape, pointercancel, lost capture, blur or tool change cancel without persistent changes. No dangling endpoint can be saved; server continues validating the full board. Undo/Redo restores only own endpoint changes, preserving independent agent text.

Guard all four connector endpoint fields plus kind/x/y/width/height of old endpoint objects and the new candidate. Concurrent endpoint changes, deletion, geometry changes or ABA geometry changes must block stale gesture commits. Independent text is excluded from guards and merges. Queued gestures use projected IDs/fields/stamps, immutable requests and existing receipts; no new server/schema/dependency.

## Components

- `navigation.ts`: pure normalized wheel intent.
- `CanvasView.pan`, existing anchored `zoom`; connector preview and stable end handles.
- `anchors.ts`: captured candidate/port resolution and detached preview route using existing orthogonal route.
- `Interaction`: captured endpoint gesture and wheel boundaries.
- `makeGuards`: endpoint dependency fields; existing CommandQueue remains sole write path.

## Verification and preservation

TDD for wheel mapping/units/anchor/clamps/gesture/text boundaries and both connector ends, explicit ports, invalid drops, cancellation, zoom-sized handles, own Undo/Redo, delayed ACKs/lost response and agent text/geometry/endpoint/deletion conflicts. Full Rust and three-browser suites; one fresh whole-change review and one RED→GREEN fix pass if required. Rebuild packages/Compose; backup old image and stopped data, activate 9843, prove on an owned disposable board, compare all original board inspections/catalog unchanged, refresh the user's tab. No Git initialization, branch, commit, publication or actual comment processing.
