# Wireboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать локальный редактор схем и слайдов в браузере на Windows, macOS и Linux, с Rust-бэкендом и управлением из Codex через CLI.

**Architecture:** Один бинарник запускает HTTP-сервер, отдаёт встроенный frontend и выполняет CLI-команды. Rust core и store — единственный источник правил редактирования и сохранения. Браузер и CLI используют один API; после сохранения события SSE обновляют открытые вкладки.

**Tech Stack:** Rust (MSVC на Windows, native toolchain на macOS/Linux), serde, axum, tokio, clap, reqwest, resvg/usvg, image (валидация растра), TypeScript, Vite, SVG, Playwright. Конкретные версии зависимостей фиксируются lock-файлами при реализации.

**Spec:** ../../../DESIGN.md (относительно этого файла: `../../../DESIGN.md` ведёт в корень проекта).

## Global Constraints

- Целевые платформы: Windows x86_64, macOS aarch64/x86_64 и Linux x86_64. На текущей Windows-машине ранее проверены Rust/Cargo 1.96.0 и MSVC; готовность других сред ещё не проверена. Без Tauri и без Node.js в runtime.
- Интерфейс на русском; ресурсы и шрифт с кириллицей поставляются локально.
- По умолчанию `127.0.0.1:9843`; корень данных: Windows `%LOCALAPPDATA%\Wireboard`, macOS `~/Library/Application Support/Wireboard`, Linux `$XDG_DATA_HOME/wireboard` (если переменная отсутствует или не абсолютна — `~/.local/share/wireboard`). Доски в `boards`; `--data-dir` задаёт корень для сервера и CLI, тесты используют отдельный корень.
- Общая кодовая база; отдельный бинарник для ОС и архитектуры. JSON доски переносим между ОС, содержит изображения и не содержит локальных путей. Синхронизация между машинами вне первой версии.
- Командные сочетания: Ctrl на Windows/Linux, Cmd на macOS. При недоступном clipboard остаётся выбор файла для изображения.
- Runtime-файл с токеном: 0600 на macOS/Linux, ограниченный ACL на Windows; ошибка установки прав завершает запуск. Если браузер не открывается, сервер работает и выводит URL без токена.
- Минимальные версии ОС и системные зависимости Linux документируются после выбора среды сборки и проверки release-бинарников. Результаты сборки и запуска фиксируются отдельно по целевым платформам.
- До 2000 объектов; до 100 операций в пакете; JSON доски до 32 MiB; изображение до 8 MiB исходных байтов.
- Координаты ±100000 px; размеры от 20 до 10000 px; масштаб от 10% до 400%; текст до 10000 символов.
- Undo/Redo до 100 действий и до 128 MiB истории на доску; история только в памяти.
- Запись на диск предшествует успешному ответу и уведомлению SSE; revision проверяется для всех изменений.
- CLI не переписывает рабочие JSON напрямую и не повторяет изменяющие команды автоматически.
- По запросу пользователя 2026-10-08 проект перенесён в `F:\SOFT\Wireboard`; промежуточные результаты в `work/` внутри проекта. Git создаёт пользователь.

## Review Focus

- Два клиента меняют одну revision: только одна транзакция успешна; второй получает конфликт без потери данных.
- Одновременно выделены фрейм и его ребёнок: каждый объект переносится один раз.
- Файловая запись не удалась: рабочая модель, история и revision остаются прежними.
- Внешнее обновление приходит во время ввода текста: ввод пользователя остаётся доступен, конфликт показан явно.
- Враждебный текст и изображение: нет исполнения HTML/SVG, path traversal, неограниченной памяти или обхода Origin/auth.

## Структура файлов

- `Cargo.toml`, `Cargo.lock`: Rust library и бинарник `wireboard`.
- `src/model.rs`, `src/error.rs`: Board, Element, Operation, AppError, проверки и атомарный apply.
- `src/geometry.rs`: принадлежность фрейму, трасса связей, порядок слайдов.
- `src/store.rs`: загрузка, атомарные записи, блокировка каталога, история.
- `src/platform.rs`: выбор каталога данных, открытие браузера, блокировка, атомарная замена и права runtime-файла с реализациями для целевых ОС.
- `src/render.rs`: SVG, перенос строк, экспорт PNG.
- `src/api.rs`: axum router, auth, origin, лимиты, SSE.
- `src/cli.rs`, `src/main.rs`, `src/lib.rs`: аргументы, runtime discovery, сервер и запросы CLI.
- `frontend/index.html`, `frontend/src/main.ts`: оболочка и связывание модулей.
- `frontend/src/api.ts`, `types.ts`: контракт HTTP и состояние соединения.
- `frontend/src/canvas.ts`, `interaction.ts`: SVG и камера; выделение, drag, resize, соединения.
- `frontend/src/panels.ts`, `editor.ts`, `presentation.ts`, `style.css`: интерфейс и редактирование текста.
- `frontend/public/fonts/`: локальный шрифт и лицензия.
- `tests/model.rs`, `store.rs`, `api.rs`, `render.rs`: Rust-проверки.
- `e2e/editor.spec.ts`, `playwright.config.ts`: проверки полного сценария браузера с Rust-сервером.
- `examples/agent-slide.json`, `skills/wireboard/SKILL.md`, `README.md`, `launch.cmd`, `launch.sh`: запуск и работа Codex на целевых ОС.

## Task 1: Модель и геометрия

**Files:** `src/model.rs`, `src/error.rs`, `src/geometry.rs`, `src/lib.rs`, `tests/model.rs`, `Cargo.toml`.

**Interfaces:**
- `AppError { code: ErrorCode, message: String }`; `ErrorCode`: Validation, Missing, Conflict, Persistence, Unauthorized, Forbidden, Limit. Ошибки сериализуются без внутренних путей и токенов.
- `Board { version: u32, id: String, title: String, revision: u64, next_id: u64, elements: Vec<Element> }`.
- `Element { id: u64, kind: ElementKind, x: f64, y: f64, width: f64, height: f64, text: String, fill: String, stroke: String, font_size: f64, from: Option<u64>, to: Option<u64>, image: Option<String> }`; сериализация camelCase.
- `Operation`: serde tagged union по полю `op`: create, update, move, resize, delete, duplicate, rename.
- `Board::apply(&self, expected_revision: u64, operations: &[Operation]) -> Result<Board, AppError>`: не изменяет исходный объект при ошибке.
- `frame_members(&Board, frame_id: u64) -> Vec<u64>`, `connector_path(&Board, connector_id: u64) -> Result<String, AppError>`, `ordered_frames(&Board) -> Vec<u64>`.

- [x] Написать тест `atomic_batch_rejects_invalid_reference`: корректное создание плюс связь на отсутствующий ID завершаются ошибкой; исходные revision, nextId и elements не изменены.
- [x] Запустить `cargo test --test model`; убедиться, что требуемые операции ещё не реализованы и проверка не проходит.
- [x] Реализовать модель, проверку версии/лимитов/чисел/ID/растровых данных и применение пакета через копию. IDs монотонны, не переиспользуются после Undo.
- [x] Добавить `frame_and_child_move_once`: move([frame, child], 80, 0) сдвигает child ровно на 80. Проверить движение содержимого фрейма и связи после удаления блока.
- [x] Добавить `unsafe_payloads_rejected`: неизвестный kind, NaN/Infinity на внутреннем уровне, отрицательные размеры, SVG data URI, некорректные сигнатуры растра и несогласованный nextId отклоняются.
- [x] `cargo test --test model`: все проверки проходят.

## Task 2: Store, история и восстановление

**Files:** `src/store.rs`, `src/platform.rs`, `tests/store.rs`, `tests/platform.rs`.

**Interfaces:**
- `Store::open(root: &Path) -> Result<Store, AppError>`: владеет блокировкой каталога до Drop.
- `BoardSummary { id: String, title: String, revision: u64, element_count: usize }`; `HistoryDirection`: Undo, Redo, сериализация lowercase.
- `Store::create(title: &str) -> Result<Board, AppError>`; `list() -> Result<Vec<BoardSummary>, AppError>`; `get(id: &str) -> Result<Board, AppError>`.
- `Store::apply(id: &str, revision: u64, operations: &[Operation]) -> Result<Board, AppError>`.
- `Store::history(id: &str, revision: u64, direction: HistoryDirection) -> Result<Board, AppError>`; `delete(id: &str, revision: u64) -> Result<(), AppError>`; `import(board: Board) -> Result<Board, AppError>`.
- Store методы вызываются под общей блокировкой сервиса; содержимое меняется только после успешной записи.
- `platform::default_data_dir() -> Result<PathBuf, AppError>`; `platform::lock_data_dir(root: &Path) -> Result<DataDirLock, AppError>` (блокировка до Drop); `platform::replace_file(temp: &Path, destination: &Path) -> Result<(), AppError>`; `platform::write_private_runtime(path: &Path, bytes: &[u8]) -> Result<(), AppError>`; `platform::open_browser(url: &str) -> Result<(), AppError>`.

- [x] Написать `saved_board_survives_reopen`: create + apply, закрыть Store, открыть снова; содержимое и revision сохранены.
- [x] Запустить `cargo test --test store`; проверить отсутствие требуемой реализации.
- [x] Написать проверки выбора стандартного каталога данных каждой ОС, XDG fallback и явного `--data-dir`. Параметры resolver передаются явно в unit-тесты без изменения окружения процесса.
- [x] Реализовать запись во временный файл и атомарную замену destination через platform, загрузку и проверку существующих файлов. Проверить замену существующего файла и блокировку вторым процессом на каждой целевой ОС. JSON пишется UTF-8 с отступами и завершающим newline.
- [x] Написать `failed_write_keeps_state`: создать препятствие на пути записи; apply возвращает ошибку, get и история не меняются.
- [x] Написать `undo_redo_revision_and_id_monotonic`: Undo отменяет весь пакет, revision возрастает, nextId не уменьшается; Redo восстанавливает пакет.
- [x] Написать `corrupt_file_is_not_overwritten` и `second_store_is_rejected`: повреждённый файл сохранён без изменения, второй владелец каталога не создаётся.
- [x] Реализовать ограниченную историю и отклонение недопустимых ID/путей. Import выдаёт новый board ID, проверяет содержимое и не перезаписывает существующие доски.
- [x] `cargo test --test store`: все проверки проходят.

## Task 3: Render, HTTP API и CLI

**Files:** `src/render.rs`, `src/api.rs`, `src/cli.rs`, `src/main.rs`, `src/platform.rs`, `tests/render.rs`, `tests/api.rs`, `tests/platform.rs`, frontend build configuration.

**Interfaces:**
- `render_svg(board: &Board, frame: Option<u64>) -> Result<String, AppError>`; `render_png(board: &Board, frame: Option<u64>) -> Result<Vec<u8>, AppError>`.
- `ApiState`: Store под mutex, канал событий, auth secret и ожидаемый origin.
- API: `GET/POST /api/boards`, `GET/DELETE /api/boards/{id}`, `POST /api/import`, `POST /api/boards/{id}/apply`, `POST /api/boards/{id}/history`, `GET /api/boards/{id}/render?format=svg|png&frame=ID`, `GET /api/events`.
- `ApplyRequest { revision: u64, operations: Vec<Operation> }`; ответы содержат Board. Ошибки `{ code, message }`: HTTP 400 validation, 401 auth, 403 origin, 404 missing, 409 conflict, 413 limit, 500 persistence.
- CLI: `serve --open --port --data-dir`, `boards`, `create --title`, `inspect BOARD`, `apply BOARD --revision N --file FILE`, `render BOARD --frame ID --output FILE`, `export BOARD --output FILE`.
- Общий CLI `--data-dir` выбирает runtime discovery; `--file -` читает stdin; `render` возвращает метаданные файла, без печати binary/base64.

- [x] Написать `svg_escapes_text_and_clips_frame`: `<script>` остаётся текстом, размер 960×540, соседние объекты обрезаны. Написать `png_is_decodable_with_cyrillic`: PNG декодируется и имеет 1920×1080 для 16:9 слайда.
- [x] Запустить `cargo test --test render`; затем реализовать общий SVG layout, локальный шрифт и resvg.
- [x] Написать `stale_revision_conflicts` и `two_clients_only_one_wins`: реальные HTTP-запросы конкурируют за одну revision, ровно один успешен; данные соответствуют победителю.
- [x] Написать `auth_origin_and_limits`: отсутствие токена/cookie, чужой Origin и слишком большой body отклонены. Клиент CLI без Origin с правильным Bearer разрешён; browser с cookie и правильным Origin разрешён.
- [x] Реализовать routes, SameSite Strict HttpOnly cookie, Host/Origin validation, CSP и frame-ancestors, SSE с heartbeat. При отставании клиента отправляется сигнал reload вместо потери уведомлений.
- [x] Реализовать serve, graceful Ctrl+C, блокировку каталога и runtime discovery. Runtime secret не выводится в stdout; cleanup runtime-файла проверяет владельца процесса.
- [ ] Проверить права runtime-файла на каждой целевой ОС: только текущий пользователь имеет доступ; ошибка установки прав останавливает запуск. `--open` использует platform без shell-интерполяции; тест ошибки открытия браузера подтверждает продолжение работы сервера и вывод URL без токена.
- [x] Реализовать команды CLI через API. Экспорт записывается только после успешного ответа; ошибки HTTP и недоступность сервера дают exit code 1.
- [x] `cargo test`, `cargo clippy -- -D warnings`; CLI smoke с отдельным каталогом проходит.

## Task 4: Редактор в браузере

**Files:** frontend модули, `e2e/editor.spec.ts`, `playwright.config.ts`.

**Interfaces:**
- `api.getBoard(id)`, `api.apply(id, revision, operations)`, `api.history(id, revision, direction)`, `api.subscribe(onChange, onConnection)`.
- `CanvasView.setBoard(board)`, `setSelection(ids)`, `fit(frameId?)`, `worldPoint(clientX, clientY)`; TypeScript Board соответствует JSON API.
- Состояние controller: текущая Board, selection, camera, tool, gesture и текстовый draft. SSE обновление не уничтожает активный draft или gesture.

- [x] До реализации UI написать браузерный сценарий: открыть реальный Rust-сервер, создать два блока и связь, изменить текст, переместить блок, отменить и вернуть действие. Проверить данные через API и отображение через SVG, а не только наличие кнопок.
- [x] Запустить Playwright; сценарий должен не проходить из-за отсутствующего редактора.
- [x] Реализовать светлый SVG-холст с сеткой точек, левую панель досок/слайдов и свойства справа. Локальный шрифт; контраст, accessible names и видимый keyboard focus.
- [x] Реализовать инструменты V/H/R/T/L/F, pan/zoom, drag, resize, multiselect, рамку выделения, duplicate/delete, выравнивание, цвета, редактирование текста и подписи стрелки.
- [ ] Добавить проверки Undo/Redo и duplicate с Ctrl на Windows/Linux и Cmd на macOS; проверить подсказки и сохранение стандартных сочетаний при вводе текста. Проверить импорт изображения через файл при недоступности clipboard.
- [x] Добавить `remote_edit_preserves_text_draft`: начать ввод, отправить изменение CLI/API, сохранить draft; интерфейс сообщает конфликт и предлагает повторить после чтения свежей revision.
- [x] Реализовать создание/переименование/удаление досок, импорт JSON и изображений, экспорт, состояние save/connection. При потере сервера никакой статус не сообщает об успешном сохранении.
- [x] Реализовать презентацию выбранного слайда и навигацию; соседние слайды обрезаны, панели скрыты, Escape выходит.
- [x] Добавить сценарии CLI→SSE без reload, вставки изображения, Unicode, JSON import/export, презентации и восстановления после перезапуска. Проверить отсутствие browser console errors.
- [ ] Frontend build/typecheck (`npm.cmd` на Windows, `npm` на macOS/Linux) и основной сценарий Playwright в Chromium/Firefox/WebKit проходят. Проверить screenshot обычного окна и презентации; clipboard и клавиши проверить также в системном браузере каждой ОС.

## Task 5: Доставка, интеграция с Codex и ревью

**Files:** `README.md`, `launch.cmd`, `launch.sh`, `examples/agent-slide.json`, `skills/wireboard/SKILL.md`, `.gitignore`.

- [x] Добавить демонстрационную доску только для действительно пустого нового каталога; повреждённые существующие данные не считаются пустым каталогом.
- [ ] Встроить production frontend и шрифт в Rust бинарник. Собрать frontend перед `cargo build --release`; подготовить отдельные сборки Windows x86_64, macOS aarch64/x86_64 и Linux x86_64. Указать минимальные версии ОС и системные зависимости Linux по проверенным средам; отсутствие среды для платформы явно указать как непроверенную поддержку.
- [x] Создать launch.cmd для Windows и launch.sh для macOS/Linux: запуск поставляемого рядом бинарника с `serve --open`, независимо от текущего рабочего каталога и пробелов в пути. Остановка сервера — Ctrl+C в терминале. Запуск не устанавливает автозагрузку; README объясняет разрешение на исполнение и штатное открытие локального бинарника в macOS.
- [x] Создать skill с CLI workflow: boards → inspect → apply с revision → render → визуальная проверка. При 409 повторно inspect; не повторять write вслепую. Текст JSON передавать файлом/stdin.
- [x] В README описать запуск, сборку, горячие клавиши Ctrl/Cmd, data-dir, пределы, историю и примеры команд PowerShell и POSIX shell. Приложить пример добавления слайда; skill выбирает имя CLI и путь для текущей ОС.
- [ ] На каждой целевой ОС и архитектуре запустить release-бинарник с тестовым каталогом, открыть системный браузер, создать и изменить доску через CLI, получить SVG/PNG, перезапустить сервер и проверить сохранение. Запуск не требует Node.js или Vite.
- [ ] Экспортировать JSON доски с кириллицей и изображением на одной ОС и импортировать на другой; проверить содержимое и последующее редактирование. Отдельно проверить стандартный data-dir, явный data-dir, блокировку второго процесса и права runtime-файла на всех трёх ОС.
- [x] Провести независимое ревью Rust, TypeScript, безопасности HTTP и файловых операций. Исправить значимые замечания и повторить затронутые проверки.
- [x] Финальная проверка: `cargo test`, `cargo clippy -- -D warnings`, frontend typecheck/build, e2e и release smoke. Сохранить результат проверок в README отдельно по платформам и архитектурам, не выдавать component checks или Windows-проверки за полный сценарий на macOS/Linux.
- [x] Передать исходники, бинарники для проверенных платформ, инструкции запуска и screenshot; явно перечислить целевые платформы, которые ещё не проверены. Не публиковать проект в GitHub и не изменять глобальные настройки Codex без отдельного запроса.

## Выполнение

Рекомендуемый способ — реализация в текущей сессии с независимым ревью в конце: задачи используют общие интерфейсы и последовательное построение модели, store, API и UI. Параллельная реализация каждой задачи отдельными агентами здесь добавляет согласование контрактов; это доступный альтернативный способ, если пользователь его выберет.

## Проверено 2026-10-08

Реализация и локальные проверки завершены: 27 Rust тестов Windows/Linux GNU/Linux musl, 21 браузерный сценарий Windows, release smoke и перенос JSON Windows↔Linux. См. [отчёт проверки](../../../work/verification.md). Незаполненные пункты выше относятся к native macOS и физическим системным браузерам/clipboard целевых ОС: Darwin cargo check прошёл для обеих архитектур, но Mac host недоступен. Git создаёт пользователь; текущие результаты сохранены в work/, комплекты — dist/.
