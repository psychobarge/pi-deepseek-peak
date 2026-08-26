# Changelog

## 1.4.0 (2026-08-25)

- Correct DeepSeek session pricing: each DeepSeek V4 assistant reply's stored `usage.cost` is patched at `message_end` with the rate in effect when the request completed (peak/off-peak, per model) — pi's footer and `/session` cost totals now reflect the real price
- Add `/dsp-cost`: recomputes the whole session (peak/off-peak split, per-model tokens and cost) from stored messages, correct for sessions resumed from disk; nested tool usage and compaction summaries are attributed to the nearest preceding assistant message
- Add DeepSeek V4 rate table (flash $0.44/$0.014/$1.32, pro $1.32/$0.044/$3.96 per 1M tokens; off-peak = exactly half); legacy `deepseek-chat`/`deepseek-reasoner` messages keep pi's bundled cost
- Selfcheck now covers `requestCost`/`sessionCost` (`npm test`)

## 1.3.1 (2026-08-25)

- Countdown next to the status dot is now on by default (`/dsp-countdown off` to disable); existing configs with `countdown: false` are respected
- Fix crash on session replacement or `/reload`: status timer no longer holds a stale extension ctx (crash reported in #1)
- Timer now tracks the current session's ctx (refreshed on `session_start`, cleared on `session_shutdown`) and stops itself if the ctx ever goes stale

## 1.3.0 (2026-08-24)

- Off-peak all day on weekends (Saturdays/Sundays, Beijing time), per DeepSeek's updated billing rules (effective 2026-08-23)
- Peak windows now match DeepSeek's published rule exactly: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; `/dsp-offset` no longer shifts the windows (kept for compatibility)
- Add `/dsp-countdown on|off` option: shows the time until the next price change next to the status dot ("DS Peak for 1h30m", "DS Normal for 27h"), refreshed with the 5-minute status check
- Add `scripts/selfcheck.ts` for the peak/countdown logic (`npm test`)

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
