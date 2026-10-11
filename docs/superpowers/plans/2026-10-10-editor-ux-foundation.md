# Wireboard Editor UX Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Реализовать первую очередь согласованной UX-спеки: предсказуемые жесты, свободные фреймы с явной принадлежностью, отзывчивое сохранение и собственные Undo/Redo с сохранением независимых правок агента.

**Architecture:** Board v3 хранит дерево принадлежности; сервер вычисляет изменения свойств и сохраняет доску, журнал и квитанции в одном атомарном документе. Браузер отделяет подтверждённое состояние от очереди команд и текущего жеста, сохраняя локальный предпросмотр до подтверждения. История отменяет условные изменения свойств конкретного участника, а не заменяет доску старым снимком.

**Tech Stack:** Rust edition 2024 / MSRV 1.88, axum, serde, atomic-write-file, ttf-parser, resvg; существующие TypeScript 5.9, Vite 7.3, Playwright 1.58. Одна новая зависимость: `sha2 = "0.10"` для устойчивого отпечатка команды; никаких новых UI-фреймворков.

**Spec:** [Согласованная UX-спека](../specs/2026-10-10-editor-ux-design.md), [основание — аудит](../specs/2026-10-10-ux-audit-and-brainstorm.md).

Статус: задачи 1–8 завершены; проверки, обзор и активация выполнены. Доказательства: `docs/superpowers/verification/2026-10-10-editor-ux.md`. Все команды выполняются из `F:\SOFT\Wireboard` в PowerShell; для npm используется `npm.cmd`.

## Global Constraints

- «Фреймы имеют свободные ширину и высоту. 16:9 доступно отдельным пресетом “Слайд”».
- «Resize меняет только границы фрейма. Размеры и принадлежность дочерних объектов сохраняются».
- «Ctrl+Z отменяет действия пользователя, сохраняя независимые правки Codex/Claude».
- При намеренном drop меняются координаты и принадлежность одной атомарной командой; resize принадлежность не меняет.
- «Старые документы читаются без потери ID, координат, текста, цветов и обсуждений»; миграция через сервер с резервной копией.
- «История изменений и квитанции команд должны сохраняться атомарно вместе с состоянием доски»; переносимый экспорт содержит только Board.
- «Прежние JSON-операции CLI остаются допустимыми»; комментарии обрабатываются только по поручению и по существующему atomic apply / submitForReview.
- Ввод в input/textarea/contenteditable, включая IME, сохраняет собственные сочетания; нет слепого повтора конфликтующей операции на новой revision.
- Существующие ограничения остаются: 2000 элементов; размеры 20…10000; координаты ±100000; Board JSON ≤32 MiB; PNG ≤8192 по стороне и ≤16000000 пикселей.
- В проекте намеренно нет Git: не создавать репозиторий, ветки, worktree или коммиты. Контрольные точки — сохранённые файлы, проверки и отчёт.
- Сохранять компактные цветные блоки и читаемые подписи текущего визуального направления. Не заменять пользовательские доски новой демонстрацией.
- Здесь только первая очередь. Новые copy/paste, выравнивание, создание протягиванием, редактирование стрелок, перемещение клавишами и новая модель wheel/pinch — отдельный последующий план.

## Review Focus

1. Совпадающие/вложенные рамки и явный `parentFrameId:null`: детерминированная миграция без циклов; отсутствие поля не означает отсоединение. Тесты задачи 1.
2. Агент меняет положение и возвращает прежнее значение либо добавляет связь/комментарий к созданному пользователем блоку: Undo не считает это нетронутым состоянием. Тесты задачи 2.
3. Ответ потерян после записи, затем рестарт или очистка старых шагов Undo: тот же ID не выполняется повторно; незавершённая запись не даёт половины состояния. Тесты задачи 3.
4. Два быстрых жеста, ранний Undo, поздний SSE и повтор ответа: очередь не теряет действия и старый ответ не заменяет более новую картинку. Тесты задачи 5.
5. Указатель вышел за холст, потерян capture, открыт текстовый черновик, RU/IME или масштаб 200%: предсказуемая отмена/завершение, доступные ручки, обычный ввод текста. Тесты задач 6 и 8.

---

## Файлы и ответственность

| Файлы | Ответственность |
|---|---|
| `src/model.rs`, `src/geometry.rs` | Board v3, nullable patch родителя, миграция, проверка дерева, состав переноса и drop target |
| Новый `src/history.rs` | Типы команд, изменения полей, stamps, условная отмена/повтор и границы истории |
| Новый `src/document.rs`, `src/store.rs`, `src/platform.rs` | Формат хранения, backup миграции, атомарный commit доски/истории/квитанции |
| `src/api.rs`, `src/cli.rs`, `src/lib.rs`, `Cargo.toml`, `Cargo.lock` | Совместимый транспорт, источники действий, idempotency, edit-state и состояния истории |
| Новые `frontend/src/commands.ts`, `frontend/src/keyboard.ts` | Очередь, projected board, восстановление/конфликт, физические клавиши и focus guards |
| `frontend/src/types.ts`, `api.ts`, `editor.ts`, `interaction.ts`, `canvas.ts`, `panels.ts`, `style.css` | Сборка редактора, автомат жестов, ручки, выделение, свойства и статус сохранения |
| Новый `src/layout.rs`, новый `frontend/src/preview.ts`, `src/render.rs` | Геометрия/текст предпросмотра и экспорта, метрики того же Golos Text |
| Новые `tests/frame_membership.rs`, `history.rs`, `document.rs`, `commands_api.rs`, `layout.rs`; существующие Rust-тесты | Проверки модели, обратных изменений, persistence и контрактов |
| Новые `e2e/editor-ux.spec.ts`, `command-queue.spec.ts`; существующие E2E | Реальные жесты, клавиатура, медленная сеть, потеря ответа, доступность и регрессии |
| `README.md`, `docs/agents/wireboard-comments.md`, `skills/wireboard/SKILL.md`, `scripts/smoke.mjs`, `scripts/docker-smoke.mjs` | Инструкции запуска/агентов, smoke и проверка обновления |

## Общие интерфейсы и решения

- `Element.parent_frame_id: Option<u64>` → JSON `parentFrameId:number|null`; у connector — всегда null, его геометрия следует концам. Координаты всех элементов остаются абсолютными.
- В patch различать missing / null / ID через `Option<Option<u64>>` с отдельным deserializer, возвращающим `Some(None)` для явного null и default `None` для missing.
- `Actor { id:String, source:Source }`, `Source = User | Codex | Claude | Legacy`. Browser UUID сохраняется под `wireboard:actorId`; legacy-запросы не попадают в собственную историю пользователя. Это атрибуция локальной истории, не новая система авторизации.
- `FieldKey { entity:EntityKey, field:String }`; `EntityKey = Board | Element(u64) | Comment(u64)`; `FieldStamp = String` (ID изменения), исходное состояние — `"baseline"`. Stamps не входят в экспорт Board.
- `FieldDelta { key, before:Option<Value>, after:Option<Value>, before_stamp:FieldStamp, after_stamp:FieldStamp }`; `Option<Value>::None` означает отсутствие сущности/поля, JSON null остаётся `Some(Value::Null)`.
- `CommandMeta { id:String, actor:Actor, label:String }`; `FieldGuard { key:FieldKey, value:Option<Value>, stamp:FieldStamp }`; `CommandRequest { revision:u64, operations:Vec<Operation>, command:Option<CommandMeta>, guards:Option<Vec<FieldGuard>> }`. JSON source — lowercase; command ID — UUID, actor ID — непустая строка ≤128 символов, label — непустая строка ≤256 символов; Legacy назначает сервер, не клиент.
- `JournalEntry { command:CommandMeta, deltas:Vec<FieldDelta> }`; запись дельт включает все последствия операции, а не только явно указанные поля: удалённые связи, отвязку детей и изменения обсуждений.
- `CommandReceipt { id:String, fingerprint:String, committed_revision:u64 }`; отпечаток SHA-256 от канонического request, включая actor, revision и guards. Повторяется исходный request, не пересобранный вариант.
- `StoredDocument { storage_version:u32, board:Board, history:HistoryState, receipts:BTreeMap<String,CommandReceipt>, stamps:BTreeMap<FieldKey,FieldStamp> }`: storage version 1, Board version 3. Для JSON карты сложных FieldKey сериализуются как список записей, а не как object keys.
- `HistorySummary { undo:Option<HistoryAction>, redo:Option<HistoryAction> }`; `HistoryAction { command_id:String, label:String }`; `HistoryState` хранит последовательность журнала и отдельные undo/redo-стеки участников. Новая команда очищает redo только своего участника.
- `HistoryCommand { revision:u64, direction:HistoryDirection, target_command_id:String, command:CommandMeta }`; undo/redo также имеют ID и квитанцию. Каждый реально выполненный commit повышает revision на 1; повтор и no-op её не повышают.
- Undo проверяет значение **и stamp**. После отмены восстанавливает before stamp, после redo — after stamp; это позволяет отменить несколько собственных шагов, сохраняя защиту от чужой правки и возврата к старому значению.
- Журнал: максимум 100 доступных шагов на участника и 128 MiB суммарно; квитанции не удалять вместе с журналом. Общий файл ≤192 MiB, квитанции ≤16 MiB; при достижении лимита отклонить новую команду до записи с понятной ошибкой, не забывать старые ID. Проверять эти лимиты независимо от лимита Board 32 MiB.
- Конфликт — типизированный `CommandConflict { command_id, elements:Vec<u64>, fields:Vec<FieldKey>, reason:String }`, без утечки runtime/token. Нельзя частично отменить жест.

### Task 1: Board v3, явные фреймы и совместимая миграция

**Files:** Modify `src/model.rs`, `src/geometry.rs`, `frontend/src/types.ts`; Create/Test `tests/frame_membership.rs`; Modify/Test `tests/model.rs`.

**Interfaces:** Consumes `Board::from_json(&[u8]) -> Result<Board,AppError>` и существующие Operation. Produces `geometry::frame_members(&Board,u64)->Vec<u64>` (все потомки), `geometry::drop_target(&Board,u64,f64,f64)->Option<u64>`, `geometry::fit_frame(&Board,u64,f64)->Result<(f64,f64,f64,f64),AppError>`; padding команды fit = 24.

- [x] Написать `free_frame_resize_keeps_children_and_origin`, `moving_nested_selection_moves_each_id_once`, `migration_equal_frames_is_stable`, `parent_patch_null_is_distinct_from_missing`, `delete_frame_releases_direct_children`. Для рамки (0,0,960,540) с ребёнком x=700 resize до (600,300): `assert_eq!(child.x,700.0)`; `assert_eq!(child.parent_frame_id,Some(frame_id))`; следующий move (40,20): `assert_eq!(child.x,740.0)`. Null отсоединяет, missing сохраняет; повторный read v3 не переопределяет родителя; ID/текст/comments/counters прежние.
- [x] Выполнить RED: `cargo test --test frame_membership` — новые утверждения падают или новые поля ещё не компилируются; зафиксировать исходную причину.
- [x] Реализовать v3, deserializer patch и дерево. Для v1/v2 назначать родителя один раз по полному геометрическому включению: минимальная площадь, затем ID; рамки обходить в стабильном порядке, исключая self/descendant. Частично входящие объекты самостоятельные. Drop использует центр, включённую границу, максимальную глубину, затем минимальную площадь и ID; исключает перемещаемый фрейм и его потомков.
- [x] Реализовать состав move как множество потомков, а delete рамки — освобождение прямых детей. Для duplicate переназначать внутренние parent IDs копиям; внешнего родителя сохранять. Не удалять содержимое при обычном delete. Fit пустого фрейма — no-op; непустого — bounding box явно принадлежащих нефреймовых объектов и дочерних рамок с padding 24.
- [x] Выполнить GREEN: `cargo test --test frame_membership --test model` и `npm.cmd run typecheck` — PASS. Сохранить контрольную точку и кратко проверить, что геометрическая принадлежность больше не пересчитывается после resize.

### Task 2: Условная собственная история свойств

**Files:** Create `src/history.rs`; Modify `src/lib.rs`; Create/Test `tests/history.rs`; Modify/Test `tests/comments.rs`.

**Interfaces:** Consumes Board v3. Produces `history::record(before:&Board,after:&Board,meta:&CommandMeta,stamps:&FieldStamps)->JournalEntry`, `history::inverse(board:&Board,entry:&JournalEntry,stamps:&FieldStamps,direction:HistoryDirection)->Result<(Board,FieldStamps),CommandConflict>`, `HistoryState::summary(&Actor)->HistorySummary`; `FieldStamps = BTreeMap<FieldKey,FieldStamp>`.

- [x] Написать `undo_move_preserves_agent_text`, `undo_conflicts_after_agent_move_and_aba`, `undo_create_guards_foreign_dependencies`, `undo_delete_and_duplicate_are_atomic`, `own_redo_survives_unrelated_agent_command`. После user move + agent text: `assert_eq!((undone.element(id).unwrap().x,undone.element(id).unwrap().text.as_str()),(old_x,"agent text"))`. После agent x→другое→исходное: `assert!(inverse.is_err())`; агентская связь или обсуждение после create дают конфликт, не удаляются.
- [x] Выполнить RED: `cargo test --test history` — FAIL из-за отсутствующей модели истории/неверной отмены, а не из-за окружения.
- [x] Реализовать вычисление дельт и stamps, включая изменения комментариев, counter floors и зависимости. Проверять весь inverse до модификации Board; creation/deletion используют guard существования и guard набора входящих зависимостей. ID и nextId/nextCommentId/nextMessageId никогда не откатываются назад и не используются повторно.
- [x] Реализовать отдельные стеки участников, метки действий и pruning по общим лимитам. Вытесненная история недоступна для Undo, но не снимает защиту квитанций. Обычный пользовательский no-op не добавляет шаг; агентский пакет остаётся одной записью. Изменение source не переписывает author уже существующих сообщений.
- [x] Выполнить GREEN: `cargo test --test history --test comments` — PASS. Проверить отдельно порядок двух собственных Undo/Redo и отказ всей команды при конфликте одного поля.

### Task 3: Атомарный документ, backup и защита повторов

**Files:** Create `src/document.rs`; Modify `src/store.rs`, `src/lib.rs`, `Cargo.toml`, `Cargo.lock`; Create/Test `tests/document.rs`; Modify/Test `tests/store.rs`, `tests/uncertain_write.rs`, `tests/platform.rs`.

**Interfaces:** Consumes JournalEntry / HistoryState / FieldStamps из задачи 2 и существующий `Persistence::write(&Path,&[u8])->Result<(),CommitError>`. Produces `Store::execute(&mut self,id:&str,request:&CommandRequest)->Result<CommandOutcome,AppError>`, `Store::execute_history(&mut self,id:&str,request:&HistoryCommand)->Result<CommandOutcome,AppError>`, `Store::history_summary(&self,id:&str,actor:&Actor)->Result<HistorySummary,AppError>`, `Store::receipt(&self,id:&str,command_id:&str)->Result<Option<CommandReceipt>,AppError>`; `CommandOutcome { board:Board, committed:bool }`.

- [x] Написать `migration_backup_is_original_bytes`, `replay_after_restart_and_history_pruning_is_noop`, `same_id_different_payload_is_rejected`, `commit_error_never_splits_board_journal_receipt`, `history_limits_do_not_expire_receipts`. Повтор create/move после reopen: `assert_eq!(after.revision,first.revision)` и `assert_eq!(after.elements.len(),first.elements.len())`; чужой payload с тем же ID отклонён; backup byte-for-byte совпадает с исходным v1/v2.
- [x] Выполнить RED: `cargo test --test document --test uncertain_write` — новые тесты FAIL; существующий uncertain-write остаётся исходной проверкой поведения.
- [x] Реализовать чтение старого Board и нового envelope в `src/document.rs`. Под lock сервера сохранить неизменяемый backup `backups/ux-v3/<board-id>.json` **до** первого replacement; существующий backup не перезаписывать. Ошибка backup останавливает миграцию этой доски; читаемая версия и данные остаются прежними. Миграция сохраняет revision, добавляет пустую новую историю.
- [x] Реализовать commit одним `Persistence.write` для всего envelope; хранить его в существующем `boards/<id>.json`. Внешние get/inspect/export возвращают только Board. `Store::apply` остаётся legacy-обёрткой execute; legacy-операциям сервер назначает внутренний UUID для stamps, они не входят в пользовательский Undo и не получают защиту повтора запроса без command ID.
- [x] Проверять квитанцию **до** проверки revision: совпавший ID/отпечаток возвращает текущую доску без записи/SSE; несовпавший отклоняется. Неизвестный stale request принимается только с полным набором успешных guards на поля и зависимости операции; legacy/no guards сохраняет строгий revision conflict. Неполные guards отклонять, а не считать безопасными.
- [x] Сохранить fail-closed при CommitError::Uncertain до reopen; CommitError::Unchanged не меняет память. Квитанцию history/no-op тоже фиксировать атомарно, но no-op не создаёт шаг и не повышает revision. Экспорт/import не переносит историю, receipts, actor или runtime; import создаёт новый локальный документ.
- [x] Выполнить GREEN: `cargo test --test document --test store --test uncertain_write --test platform` — PASS. При прерывании миграции допускается либо целый старый Board с backup, либо целый новый envelope, без промежуточного формата.

### Task 4: API/CLI и источник действия

**Files:** Modify `src/api.rs`, `src/cli.rs`, `src/history.rs`, `frontend/src/api.ts`, `frontend/src/types.ts`; Create/Test `tests/commands_api.rs`; Modify/Test `tests/api.rs`, `tests/cli.rs`, `tests/comments_api.rs`.

**Interfaces:** Consumes Store::execute / execute_history / summary / receipt. Produces `GET /api/boards/{id}/edit-state?actorId=<uuid>&commandId=<optional-in-flight-id>` → `EditState { board:Board, stamps:Vec<FieldStampEntry>, history:HistorySummary, receipt:Option<CommandReceipt> }`; `FieldStampEntry { key:FieldKey, stamp:FieldStamp }`; `GET /api/boards/{id}/commands/{commandId}` → CommandReceipt либо 404. Board/stamps/history/receipt читаются под одним lock. Существующий POST apply принимает расширенный CommandRequest и по-прежнему возвращает Board; POST history принимает HistoryCommand и возвращает Board. Frontend: `api.editState(id:string,actorId:string,commandId?:string):Promise<EditState>`, `api.apply(id:string,request:CommandRequest):Promise<Board>`, `api.history(id:string,request:HistoryCommand):Promise<Board>`; Rust Option соответствует TS null.

- [x] Написать `legacy_apply_stays_compatible`, `guarded_stale_move_merges_text_but_not_position`, `history_is_actor_scoped`, `duplicate_command_emits_one_change`, `agent_comment_batch_is_one_commit`. У legacy CLI прежний JSON работает; agent text + guarded stale move даёт оба изменения; agent position даёт 409 с описанием конфликтующих полей. Повтор ID: `assert_eq!(changed_events,1)`; Undo с actor другого профиля/источником agent запрещён.
- [x] Выполнить RED: `cargo test --test commands_api --test cli` — новые контракты FAIL/404.
- [x] Встроить transport в старые маршруты и формат AppError, SSE отправлять только при `outcome.committed`. Старый history без идентификации участника вернуть с понятным actor-required сообщением; не оставлять путь глобального восстановления снимка. Не менять существующие auth/origin/body-limit проверки.
- [x] Добавить CLI apply опции `--command-id`, `--actor-id`, `--author user|codex|claude`; без них legacy-режим. При наличии command-id требовать source и actor-id, сохранять исходный request для повтора; CLI не превращает stale revision в новую автоматически. Добавить CLI `history <board> --revision N --direction undo|redo --target-command-id ID --command-id ID --actor-id ID --author user` и `command <board> <command-id>` для проверки квитанции.
- [x] Выполнить GREEN: `cargo test --test commands_api --test api --test cli --test comments_api` и `npm.cmd run typecheck` — PASS. В новом edit-state нет токенов; portable export не раскрывает новые приватные поля.

### Task 5: Очередь команд, ранний Undo и конфликты

**Files:** Create `frontend/src/commands.ts`, `frontend/src/keyboard.ts`; Modify `frontend/src/editor.ts`, `api.ts`, `types.ts`, `panels.ts`; Create/Test `e2e/command-queue.spec.ts`.

**Interfaces:** Consumes api.editState/apply/history. Produces `CommandQueue.enqueue(intent:EditIntent):void`, `CommandQueue.history(direction:'undo'|'redo'):void`, `CommandQueue.projected():Board`, `CommandQueue.accept(state:EditState):void`, `CommandQueue.retry():void`, `CommandQueue.discard():void`; `EditIntent { label:string, operations:Operation[], guards:FieldGuard[] }`. `CommandQueue` constructor получает actor, confirmed EditState, API adapter и onChange; `keyboard.command(event:KeyboardEvent):EditorShortcut|null`, `EditorShortcut = 'undo'|'redo'|Tool`.

- [x] Написать `early_undo_waits_for_delayed_move`, `second_drag_is_not_dropped`, `lost_response_retries_same_payload`, `late_snapshot_does_not_erase_projection`, `own_sse_before_ack_does_not_double_move`, `agent_text_merges_but_position_blocks_queue`. Задержать apply на 800 ms; сделать move+Undo до ответа: итоговая позиция исходная, сохранения идут последовательно, шаг не пропал. Два drag до первого ответа дают сумму переносов. После lost response bytes/ID/revision повторного request прежние; число commits = 1. Own SSE до ACK: видимое x = old_x+dx, а не old_x+2*dx.
- [x] Выполнить RED: `npm.cmd exec playwright test e2e/command-queue.spec.ts --project=chromium` — assertion FAIL на busy-drop/сбросе preview.
- [x] Реализовать слои confirmed → pending intents → active gesture. У очереди состояния idle/saving/uncertain/conflict; один in-flight request. Не менять уже отправленный request. Для следующего intent guards строить относительно подтверждённого предшественника; локальные изменения предполагают его command stamps. Старые snapshot/revision игнорировать; свежие независимые правки накладывать под pending projection. SSE refresh запрашивает edit-state с текущим in-flight ID; receipt в том же snapshot означает, что этот intent уже включён в Board и второй раз поверх него не проецируется. Поздний ACK предыдущего ID не завершает новую команду.
- [x] Обычный create/duplicate получает реальные ID после ACK; до него показывать статус создания, не выдавать временный ID за серверный. Последующие действия над существующими объектами продолжать принимать. Undo — intent в той же очереди с конкретным target ID, включая только что поставленное в очередь действие; серверные Undo/Redo тоже idempotent.
- [x] При uncertain дать «Повторить сохранение» и проверку квитанции, при конфликте — «Посмотреть изменения»/«Отменить несохранённое действие». До выяснения uncertain не разрешать отбросить команду как несохранённую: сначала проверить commit и загрузить edit-state. Удаление конфликтного intent пересчитывает dependent intents, не отправляя устаревшие guards.
- [x] Связать статус сохранения и HistorySummary с кнопками, по `event.code` поддержать KeyZ/KeyY и существующие буквы инструментов; Ctrl/Cmd и Shift сохраняются. Не перехватывать input/textarea/select/contenteditable, composition и модальные поля. Убрать busy-отбрасывание команд, сохранив защиту от недопустимых режимов.
- [x] Выполнить GREEN: `npm.cmd run typecheck`; `npm.cmd exec playwright test e2e/command-queue.spec.ts --project=chromium` — PASS. Подписку SSE и загрузку SVG синхронизировать с текущей revision без сброса projection или фокуса свойств.

### Task 6: Автомат жестов и восемь ручек

**Files:** Modify `frontend/src/interaction.ts`, `canvas.ts`, `panels.ts`, `style.css`, `editor.ts`; Create/Test `e2e/editor-ux.spec.ts`; Modify/Test `tests/frame_membership.rs`.

**Interfaces:** Consumes CommandQueue, frame-membership контракт задачи 1. Produces `resizeBounds(start:Bounds,handle:ResizeHandle,dx:number,dy:number,keepAspect:boolean):Bounds`, `ResizeHandle = 'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'`, `Bounds {x:number,y:number,width:number,height:number}`; `dropTarget(board:Board,id:number,center:Point):number|null`, `Point {x:number,y:number}`; `CanvasView.project(board:Board):void`, `CanvasView.highlightDrop(frameId:number|null):void`.

- [x] Написать `edge_resize_changes_one_axis`, `north_west_preserves_opposite_corner`, `shift_keeps_start_ratio`, `cancel_and_offcanvas_release`, `marquee_inside_frame_and_shift_selection`, `nested_drop_preview_equals_commit`, `frame_moves_outside_children_once`, `resize_handle_click_is_noop`. Для (100,100,200,100), w-handle dx=20 → `(x,width,height)=(120,180,100)`; n-handle dy=20 → `(y,height,width)=(120,80,200)`; no-op → revision прежняя, history прежняя. Escape/cancel → исходная позиция, 0 requests.
- [x] Выполнить RED: `npm.cmd exec playwright test e2e/editor-ux.spec.ts --project=chromium` — FAIL на независимом resize/пустом месте рамки.
- [x] Реализовать idle/pan/marquee/move/resize с исходным состоянием жеста, pointer capture с pointerdown и обработкой pointerup/pointercancel/lostpointercapture/window blur. Завершение идемпотентно: один жест не завершается дважды; intentional release capture после drop не отменяет уже queued intent.
- [x] Восьми ручкам дать hit area минимум 24×24 CSS px независимо от масштаба; сторона меняет одну ось, угол две, Shift сохраняет пропорции старта. Clamp 20…10000, противоположная сторона неподвижна. Frame fill не перехватывает marquee; перенос доступен за заголовок/границу, блоки выбираются поверх рамки. Shift+click переключает объект; drag выбранного объекта двигает всё выделение, потомки дедуплицируются.
- [x] На drop использовать тот же dropTarget, что при highlight; собственный selection/subtree исключить из целей. Reparent только самостоятельно переносимых корней выделения, дети перемещаемого фрейма сохраняют связи. Отправлять move+parent patches вместе; resize отправляет только bounds. До ACK project не сбрасывать; Escape активного жеста сохраняет прежние pending commands.
- [x] В свойствах сделать независимые width/height, «Слайд 16:9» = 960×540, «Подогнать под содержимое» с padding 24. Обычное delete рамки освобождает детей; отдельное действие «Удалить фрейм с содержимым» явно удаляет выбранный subtree одним intent. Поддержать Space+drag вне поля ввода при сохранении и при открытом текстовом черновике, не закрывая его.
- [x] Выполнить GREEN: `npm.cmd run typecheck`; `cargo test --test frame_membership`; `npm.cmd exec playwright test e2e/editor-ux.spec.ts --project=chromium` — PASS. Зафиксировать короткую запись жестов/скриншоты для просмотра.

### Task 7: Полный локальный предпросмотр и свободный экспорт

**Files:** Create `src/layout.rs`, `frontend/src/preview.ts`, `tests/fixtures/ux-layout.json`; Modify `src/render.rs`, `src/api.rs`, `src/lib.rs`, `frontend/src/api.ts`, `types.ts`, `canvas.ts`; Create/Test `tests/layout.rs`; Modify/Test `tests/render.rs`, `e2e/editor-ux.spec.ts`.

**Interfaces:** Consumes projected Board и существующие connector_points. Produces `layout::font_metrics()->FontMetrics`, `layout::scene(board:&Board)->Result<SceneLayout,AppError>` и frontend `projectScene(board:Board,metrics:FontMetrics):SceneLayout`. `FontMetrics { regular:BTreeMap<String,f64>, semibold:BTreeMap<String,f64>, fallback:f64 }` — ширина символа / unitsPerEm, fallback=0.5; frontend maps — Record<string,number>. `SceneLayout { elements:Vec<ElementLayout>, connectors:Vec<ConnectorLayout> }`, `ElementLayout { id:u64, bounds:Bounds, title:Vec<TextRow>, body:Vec<TextRow> }`, `ConnectorLayout { id:u64, points:Vec<Point>, caption_bounds:Bounds, caption:Vec<TextRow> }`, `TextRow { text:String,x:f64,y:f64,size:f64,weight:u16 }`. `GET /api/layout-metrics` возвращает метрики того же bundled font под прежней auth; браузер загружает один раз.

- [x] Написать `live_resize_wrap_matches_committed_svg`, `live_caption_follows_link_and_avoids_cards`, `preview_keeps_frame_children_size`, `free_frame_png_preserves_ratio`. В браузере во время resize DOM shape.width равен projected width; массив строк до pointerup равен массиву после ACK и строкам server SVG. Положение caption не остаётся старым; фон/текст не перекрывают карточку. Фрейм 600×300 → PNG 1920×960; preset 960×540 → 1920×1080.
- [x] Выполнить RED: `cargo test --test layout --test render`; `npm.cmd exec playwright test e2e/editor-ux.spec.ts --project=chromium --grep 'preview|wrap|caption'` — новые утверждения FAIL на текущем частичном DOM preview.
- [x] Выделить существующий layout из renderer; SVG и PNG используют его. Получить glyph advances через существующий ttf-parser для шрифтов 400/600, кешировать; обрабатывать Unicode по code points. Перенести те же правила wrap/truncate, центрирования и caption placement в preview.ts, проверяя общими JSON fixtures `tests/fixtures/ux-layout.json`; не добавлять сетевой запрос на каждый pointermove. Файлы fixture читаются Rust- и browser-тестами.
- [x] Canvas обновляет фактическую геометрию, строки текста, пути, фон и подписи на каждом кадре через requestAnimationFrame; overlays строятся поверх того же Board. Дождаться загрузки Golos Text; отключить kerning/лигатуры одинаково в SVG и preview. Общие fixture фиксируют те же строки и координаты с допуском ≤1 единица доски для float-вычислений; сохранение не меняет перенос строк.
- [x] Свободный frame export сохраняет пропорции и прежние PNG limits, crop ограничен frame bounds; содержимое снаружи сохраняется в Board и полном экспорте. Не вводить скрытое масштабирование дочерних блоков.
- [x] Выполнить GREEN: `cargo test --test layout --test render`; `npm.cmd run typecheck`; `npm.cmd exec playwright test e2e/editor-ux.spec.ts --project=chromium` — PASS. Проверить светлые цветные блоки и читаемые подписи на сохранённом PNG и в активном жесте.

### Task 8: Проверка всей цепочки, инструкции и выпуск

**Files:** Modify/Test `e2e/editor-ux.spec.ts`, `e2e/command-queue.spec.ts`, `e2e/comments.spec.ts`, `tests/regressions.rs`, `tests/container.rs`, `scripts/smoke.mjs`, `scripts/docker-smoke.mjs`; Modify `README.md`, `docs/agents/wireboard-comments.md`, `skills/wireboard/SKILL.md`; Create `docs/superpowers/verification/2026-10-10-editor-ux.md`.

**Interfaces:** Consumes все контракты задач 1–7. Produces проверенный native/Docker выпуск, инструкции и evidence с фактическими версиями, командами, результатами и ограничениями платформ.

- [x] Добавить `ru_shortcuts_and_text_native_undo`, `handles_at_200_percent_and_mobile_width`, `space_pan_preserves_draft`, `persisted_user_history_after_server_restart`, `legacy_board_migration_keeps_comments`. RU событие использует `code:KeyZ,key:я`; стрелка инструмента также по code. Input/textarea/contenteditable/IME не запускают board Undo; viewport 390px и настоящий browser zoom 200% сохраняют hit areas/доступ к Undo. Рестарт после lost ACK + повтор дают ровно один commit; комментарий агента остаётся awaiting_review до решения пользователя.
- [x] Выполнить targeted RED до недостающих изменений: `npm.cmd exec playwright test e2e/editor-ux.spec.ts --project=chromium --grep 'RU|mobile|200|draft'`; `cargo test --test regressions`. Не объявлять RED, если нужный сценарий уже проходит: сохранить его как дополнительное подтверждение.
- [x] Закрыть выявленные интеграционные ошибки и обновить README/agent skill: где открыть приложение, free frame vs preset, рамка vs содержимое, own Undo, CLI flags, повтор с прежним ID, проверка receipt и ручной процесс comments. Ни токенов, ни прямого редактирования store JSON; Compose файлы передавать через `/data`.
- [x] Выполнить `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd test` — все PASS. Browser suite включает Chromium/Firefox/WebKit; новые сценарии проверяются во всех проектах, исключения фиксируются по причине и не скрываются.
- [x] Выполнить `node scripts/smoke.mjs` для native Windows и `node scripts/docker-smoke.mjs` для изолированного Linux-amd64 Docker. Обновить packages через существующий `scripts/package.mjs`, предварительно прочитав его параметры. Не выдавать Windows WebKit за native macOS; Docker arm64 и native macOS сообщить как непроверенные, если фактического запуска не было.
- [x] До замены обычного сервиса сохранить snapshot текущего data-dir при остановленном сервисе и версии binary/image; исходные IDs, список досок и comments сверить после миграции. Пройти create→drag→edge resize→early Undo→agent text→Undo→restart→export на отдельной тестовой доске. Возврат на старую версию использует её binary + snapshot до миграции; новый envelope старому серверу не подсовывать. Пользовательскую доску не превращать в тестовый полигон.
- [x] Зафиксировать evidence и выполнить финальную code review согласно выбранному способу исполнения. Исправить подтверждённые замечания, повторить затронутые проверки; только затем сообщить готовность с ссылкой запуска и границами проверенных платформ.

## Покрытие приёмки и порядок

Зависимости: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Эти части связаны общими контрактами; отдельный план на каждый слой затруднит проверку поведения редактора целиком.

| Критерии UX-спеки | Задачи / доказательство |
|---|---|
| 1 RU/EN Undo/Redo и отмена в поле ввода | 5, 8 / реальные keyboard/focus сценарии |
| 2 ранний Undo и следующий drag во время save | 5 / 800 ms delay и последовательность commits |
| 3 без отскока, Escape/cancel, уход за холст | 5, 6 / pointer capture и projected scene |
| 4 боковые/угловые ручки, origin и Shift | 6 / точные координаты и размеры |
| 5 resize сохраняет детей, следующий move переносит их | 1, 6 / explicit tree и browser scenario |
| 6 reparent, highlight и единая отмена | 1, 2, 6 / same dropTarget и atomic delta |
| 7 marquee внутри фрейма / move за заголовок | 6 / реальные hit targets |
| 8 независимый agent text / конфликт позиции | 2, 4, 5 / stamps, guards и UI состояния |
| 9 lost ACK и повтор после restart | 3, 5, 8 / receipt до revision check |
| 10 durable history / старая схема | 1, 3, 8 / backup, reopen и сохранение содержимого |
| 11 реальный preview, мобильная ширина, zoom | 6, 7, 8 / DOM, SVG и browser evidence |
| 12 comments, atomic apply, CLI, export, runtime | 4, 7, 8 / существующие тесты и smoke |

## Самопроверка плана и передача

- Покрыты все требования первой очереди; следующая очередь явно отделена. Объединение перемещений стрелками относится к следующей очереди вместе с самим перемещением клавишами.
- Интерфейсы названы одинаково во всех задачах; Rust u64/f64 соответствуют TypeScript number в прежних пределах MAX_SAFE_ID. Runtime envelope и portable Board разделены.
- У каждой задачи есть RED/GREEN, конкретные файлы, assertions и контрольная точка; пять Review Focus имеют владельцев и тесты. План задаёт решения и проверки, а не тела реализации.
- Миграция, потеря ACK, неопределённый commit и конфликт имеют отдельные сценарии восстановления. Нет задачи, которая требует править пользовательский JSON вручную или инициализировать Git.
- Рекомендация: native execution в этой сессии — задачи тесно связаны контрактами истории, stamps и очереди. После просмотра плана пользователь выбирает native или subagent-driven; проверка готовности обязательна при обоих вариантах.

Результаты реализации и фактические границы проверки приведены в отчёте verification; неисполненная следующая очередь остаётся за рамками этого плана.




