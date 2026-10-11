# Wireboard C + Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Реализовать утверждённый визуальный стиль C и сохраняемые комментарии, которые Codex/Claude обрабатывают по команде пользователя.

**Architecture:** Каноническая доска v2 объединяет схему и обсуждение, все записи проходят через revision-checked atomic apply. Rust рассчитывает геометрию привязок и текст, браузер показывает комментарии отдельным слоем и сохраняет черновики. CLI читает согласованный контекст и изменяет схему вместе с ответом.

**Tech Stack:** Rust/serde/axum/clap/resvg, TypeScript/Vite/SVG, Golos Text, Playwright, Docker Compose/just.

**Spec:** [2026-10-09-visual-c-comments-design.md](../specs/2026-10-09-visual-c-comments-design.md).

## Global Constraints

- Выполнение в текущем чате; пользователь явно поручил составить план и сразу реализовать его. Дополнительная остановка для проверки плана отменена этой инструкцией.
- Git отсутствует и остаётся под управлением пользователя; не создаём repository/worktree, не коммитим. Вместо Git checkpoints сохраняем исходный архив и ledger `.superpowers/sdd/2026-10-09-visual-c-comments/progress.md`.
- Формат v1 читается без переписывания, первая успешная запись — v2. Старые text/colors/geometry/IDs/revision сохраняются.
- 500 веток, 100 сообщений/ветка, 10000 сообщений/доска, 4000 символов/сообщение, 100 операций/пакет, 32 MiB JSON; MAX_SAFE_ID для счётчиков.
- Статусы `open`, `awaiting_review`, `resolved`; агент не закрывает ветки. Ручной запуск из Codex/Claude; глобальные настройки агента не меняются.
- Обсуждение не входит в elements и SVG/PNG/презентацию; входит в JSON и Undo. Дублирование не копирует ветки.
- Authentication/Origin/Host/atomic persistence/SSE сохраняются. Пользовательские данные перед обновлением работающего сервиса копируются; тесты используют отдельные data-dir/volume.
- CSS соответствует выбранному C; шрифт Golos Text с реальными весами 400/600, единые SVG icons. Новая карточка 240×160, body 16, title body+8 до 96.

## Review Focus

1. Потерянный HTTP-ответ после успешной записи не должен приводить к слепому повтору сообщения: task 5 browser conflict/draft test.
2. Удаление связи через удаление конца оставляет orphaned discussion и корректный последний якорь: task 1 model test.
3. Undo с последующим созданием ветки/сообщения не переиспользует номера: task 2 store test.
4. Старая доска с заполненными полями, кириллицей и пользовательскими цветами не преобразуется эвристически: task 2 migration test.
5. Новое сообщение пользователя во время работы агента отменяет stale atomic update+reply: task 3 API test.

## File Structure

- `src/comments.rs`: типы комментариев, transitions/validation, anchor resolution/context.
- `src/model.rs`: v2 fields/operations, pure transactional dispatch and time context, strict legacy loading.
- `src/store.rs`: load/migration, server clock, history counters, import normalization.
- `src/api.rs`, `src/cli.rs`: GET comments and CLI filter, existing apply unchanged structurally.
- `src/render.rs`: shared text layout, title/body, weight/ellipsis and fit dimensions.
- `frontend/src/comments.ts`: threads/filter/drafts/pins and anchor mode.
- `frontend/src/text-editor.ts`: inline object drafts and conflict handling.
- `frontend/src/icons.ts`: reusable SVG icons.
- Existing frontend modules: transport/types/editor orchestration, camera/preview callbacks, layout/panels.
- `tests/comments.rs`, `tests/comments_store.rs`, `tests/comments_api.rs`, render tests, `e2e/comments.spec.ts`: behavioral coverage.
- `docs/agents/wireboard-comments.md`, project skill, README/DESIGN: usage and migration notes.

### Task 1: Pure model v2 and comment anchors

**Files:** create `src/comments.rs`, `tests/comments.rs`; modify `src/model.rs`, `src/lib.rs`.
**Interfaces:** produce `Board::apply_with_context(revision, operations, now: &str) -> Result<Board, AppError>`, comment enums/structs, `comments::anchor_position(board, anchor) -> Result<(f64,f64), AppError>`, `Board::comments_context(status, thread) -> Result<Value,AppError>`.

- [x] Write failing tests using JSON operations: create rectangle+comment; atomically update+reply; human reopen/resolve; agent forbidden resolve; orphan block/connector; connector/frame movement; duplicate does not copy threads; validation limits and invalid anchors; safe counter exhaustion.
- [x] Run `cargo test --locked --test comments` and observe failure for missing comments operations.
- [x] Implement specified fields, statuses, snapshots, deterministic anchors and pure timestamp context. Validate complete candidate, preserve last anchor before deletion.
- [x] Run `cargo test --locked --test comments --test model`; expected all pass; checkpoint ledger.

### Task 2: Persistence, strict migration and history

**Files:** create `tests/comments_store.rs`; modify `src/store.rs`, model load helpers.
**Interfaces:** consumes v2 Board and apply_with_context; produces `Board::from_json(bytes: &[u8]) -> Result<Board,AppError>` and store migration/clock, monotonic three counters.

- [x] Write tests: old v1 bytes unchanged on open; first apply saves v2 and preserves fields; restart discussion; import normalization; comment Undo/Redo and IDs; write error/uncertain outcome retain existing protections.
- [x] Run `cargo test --locked --test comments_store`; expected migration/history tests fail before implementation.
- [x] Implement legacy validation before conversion, strict v2 reader, store timestamp context and history/import behavior. Use a small maintained UTC date dependency if needed; do not hand-roll calendar arithmetic.
- [x] Run comments_store/store/uncertain_write tests; expected all pass; checkpoint ledger.

### Task 3: Agent read API and CLI

**Files:** create `tests/comments_api.rs`; modify `src/api.rs`, `src/cli.rs`, CLI integration tests.
**Interfaces:** consume comments_context; GET `/api/boards/{id}/comments?status=open&thread=1`; CLI `comments BOARD --status open|awaiting_review|resolved|all [--thread N]`; produce consistent JSON context under store lock.

- [x] Add failing HTTP tests for authorization/filter/context, missing thread and concurrent stale update+reply. Extend CLI integration to create/read/reply with one batch and export.
- [x] Run focused tests; expected missing endpoint/CLI failure.
- [x] Add strict filters, route and subcommand. Preserve common apply transaction and SSE. Reject bad status or thread values.
- [x] Run API/CLI/container/comments suites; expected all pass; checkpoint ledger.

### Task 4: Shared title/body typography and renderer

**Files:** modify `src/render.rs`, render tests; package static font weights if variable font cannot provide native 600.
**Interfaces:** consumes title/fontWeight; produces consistent SVG/PNG and layout metadata for frontend fit-height/overflow.

- [x] Write tests asserting escaped title and body, font weight, ellipsis and fitted text dimensions, comments excluded, long Cyrillic and extreme dimensions.
- [x] Run renderer tests; expected old renderer lacks title/metadata/weight.
- [x] Implement one wrapping/layout path, bounded title rows and computed fit height, 20px padding/20 radius/soft frames. Preserve old data and safe exports.
- [x] Run render/model tests; inspect real PNG with Cyrillic 400/600; checkpoint ledger.

### Task 5: Frontend C, comments and inline text drafts

**Files:** create icons/comments/text-editor modules and `e2e/comments.spec.ts`; modify frontend types/api/editor/canvas/interaction/panels/index/style and existing E2E selectors where UI intentionally changed.
**Interfaces:** comments controller gets snapshot/apply/focus callbacks; pins are independent screen-space overlay; inline draft survives external changes. No frontend-owned status logic beyond showing server results.

- [x] Write browser tests first: comment block/connector/point, CLI-like API reply and SSE, accept/reopen, draft after conflict and switching boards, inline title/text, fit height, desktop/mobile access and exports excluding pins.
- [x] Run Chromium focused tests against real server; expected missing C controls.
- [x] Implement TypeScript mirror and controller modules. Add C tool, anchor placement, live pin movement and orphan/reanchor handling; retain mouse/keyboard editing. Implement C layout, SVG icons, swatches, slide thumbnails and focus/drafts. New message failures require explicit retry.
- [x] Run typecheck/build and focused browser tests. Verify 375/768/1280/1440, keyboard focus, 200% zoom, palettes/contrast and actual screenshot. Run Chromium/Firefox/WebKit suites; checkpoint ledger.

### Task 6: Documentation, review and live activation

**Files:** create neutral agent guide and verification report; update skill/README/DESIGN; modify smoke scripts to cover comments if needed.
**Interfaces:** consume completed API/CLI, both native and Compose; produce reproducible examples, built resources and updated running application.

- [x] Write guide with exact command/file examples, review lifecycle and conflict handling; update migration/backup instructions and explain manual agent launch.
- [x] Run frontend typecheck/build, cargo fmt check/tests/clippy, release build, all browser tests; expected clean. Run release native smoke and isolated Docker smoke covering comments and restart persistence.
- [x] Request fresh Rust and TypeScript review plus whole-change review per Superpowers executing-plans. Fix important findings with reproducing tests; ledger decisions and evidence.
- [x] Save backup of user Compose boards without exposing runtime token. Rebuild/restart normal Compose service preserving its volume, verify health and comments command on live server; open real editor for user.
- [x] Report implemented outcome, tests, live status and any genuine unverified integration (real Claude conversation vs protocol simulation). Retain ledger/checkpoints because no Git history exists.

## Plan Self-Review

All 13 spec sections map to tasks above; typography and comments share version2 model and one atomic transport. Interfaces agree on threadId/message IDs/status names/author enums. Global user authorization selects inline continuous execution and overrides the normal additional plan approval gate. No commits or destructive workspace cleanup are applicable without Git.
