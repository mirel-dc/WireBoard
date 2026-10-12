# Docker library repair — 2026-10-12

`just up` was serving an empty directory instead of the existing Windows library. A read-only Docker probe could not see the board files in `%LOCALAPPDATA%/Wireboard`. Independently, `justfile` did not load `.env`, so its exported default library path overrode the configured Compose path.

The complete library was copied to `F:/SOFT/Wireboard-library` after stopping the native writer. Board files were compared by SHA256 before switching. The original Windows path now links to that directory, preserving the native default without creating a second active library. The original complete directory is retained at `C:/Users/mirel/AppData/Local/Wireboard-before-Docker-20261012-093327`; the empty Docker placeholder was archived separately. `.env` selects the new library. Runtime and lock files were not copied into it.

`justfile` now loads `.env`, preserving explicit environment overrides. On Windows, `just up` builds the image, verifies a unique host marker through a one-off Compose container, and only then starts the server. A sharing failure stops startup; the verifier does not open a board writer. Its temporary marker is removed in `finally`.

Verification:

- `node scripts/docker-config-test.mjs` initially failed because the configured `.env` path was ignored. It now passes for a path with spaces, an explicit environment override, and the native default.
- The preflight failed against the original mismatched directory and passed against the new shared folder.
- `just up` completed with a healthy container mounted at `F:/SOFT/Wireboard-library`.
- A temporary file written by Docker was immediately readable on Windows and was removed after verification.
- `just down` followed by `just up` preserved both board files byte for byte, including comments and history. The native Windows alias reads the same hashes.
- At the restart check, Inter RAO had revision 27, 181 elements, 11 discussions, and 26 messages. These include the latest saved edits present when the writer was stopped. Subsequent live edits reached revision 29 with 13 discussions and 28 messages; host, container, and native-alias file hashes matched, confirming new saves reach the shared library.
- Playwright opened the existing board URL and displayed the board, slides, and comment markers with status “Все изменения сохранены”. Browser console: zero errors or warnings.
- Code review found no actionable issues in the launch/configuration changes.

Machine-readable migration and verification evidence is saved under `work/docker-library-*-20261012.json`.
