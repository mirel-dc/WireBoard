# Wireboard

## Git communication

Prefer English for commit messages, branch names, pull request titles and descriptions, and GitHub issues or comments unless the user explicitly requests another language. Keep README.md in English.

## Board comments

Если пользователь просит разобрать комментарии схемы, прочитай `docs/agents/wireboard-comments.md` и `skills/wireboard/SKILL.md`. Работай через CLI запущенного сервера: для Compose — `just cli`, для native — binary с его `--data-dir`.

Сначала выбери доску по поручению, прочитай открытые обсуждения и свежую revision. Изменения схемы и ответ `comment_reply` сохраняй одним atomic apply. Используй `author:codex`, обязательный `submitForReview`; результат закрывает пользователь. Не обрабатывай комментарии без команды и не правь хранилище JSON напрямую.
