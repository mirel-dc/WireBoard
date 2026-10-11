# Wireboard: Docker Compose и just

Запрос пользователя: запуск через just/justfile, приложение и сборка в Docker Compose. Пользователь подтвердил just; работа авторизована в текущей сессии. Git остаётся под управлением пользователя.

Один service wireboard. Multi-stage Dockerfile собирает TypeScript/Vite и Rust со встроенными production ресурсами; runtime содержит один Linux binary и системные библиотеки, без Node/Rust compiler. Linux images amd64/arm64 собираются нативно выбранной Docker платформой (Apple Silicon не требует Windows/Mac binary).

В контейнере serve слушает 0.0.0.0:9843; Compose публикует 127.0.0.1:${WIREBOARD_PORT:-9843}:9843. Обычный desktop запуск сохраняет default 127.0.0.1. Внешний browser origin явно задан и ограничен HTTP loopback; внутренний endpoint CLI остаётся 127.0.0.1:9843. Host разрешает ровно эти два адреса, Origin браузера — только внешний. Auth/bootstrap/CSP/revision остаются обязательными.

Доски и приватный runtime — в named volume /data. Runtime user non-root, private runtime 0600 на Linux FS volume. Compose stop SIGTERM использует тот же graceful shutdown, что Ctrl+C, в том числе SSE. Healthcheck проверяет авторизованный CLI; up ждёт healthy. down не удаляет volume. Старые native данные не переносятся автоматически.

Для браузера host helper получает одноразовый URL через `docker compose exec -T ... open --print-url`, держит URL в переменной и вызывает системный opener. URL не выводится в recipe/logs. Хост требует только Docker Compose, just и стандартный PowerShell на Windows / sh и browser opener на POSIX.

just recipes: up, open, down, logs, ps, restart, build, cli (argv сохраняются), upload/download для JSON/экспорта через docker compose cp в writable volume /data (tmpfs /tmp не подходит для cp). Файлы операций передаются в контейнер; CLI использует API своего сервера, не переписывает boards JSON напрямую. Не используется host networking, privileged container, внешний reverse proxy или обход авторизации.

Проверки: CLI сетевой профиль с различным внутренним/публичным портом и browser grant; недопустимые origins/listen; реальный Docker build, readiness, CLI create/apply/render/export, browser, down/up persistence, SIGTERM/runtime cleanup. Проверить just argv с пробелами и quoting на Windows. Сохранить отчёт, инструкции и независимое ревью.
