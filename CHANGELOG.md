# Changelog

## 1.2.1 (2026-08-13)

- Fix crash on session replacement or `/reload`: status timer no longer holds a stale extension ctx
- Timer now tracks the current session's ctx (refreshed on `session_start`, cleared on `session_shutdown`) and stops itself if the ctx ever goes stale

## 1.2.0 (2026-07-28)

- Switch install to `pi install npm:pi-deepseek-peak`
- Add screenshot preview for pi.dev gallery

## 1.1.1 (2025-07-25)

- Fix export format: default export is now the factory function directly (not wrapped in an object)
- Resolves `"Extension does not export a valid factory function"` error

## 1.1.0 (2025-07-25)

- Add `/dsp-offset` command to configure UTC offset
- Persist offset to `~/.pi/agent/deepseek-peak.json`
- Default UTC+2

## 1.0.0 (2025-07-25)

- Initial release
- Status bar indicator for DeepSeek peak hours (UTC)
- Auto-refresh every 5 minutes
