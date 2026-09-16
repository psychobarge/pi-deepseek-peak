# pi-deepseek-peak

[![npm version](https://img.shields.io/npm/v/pi-deepseek-peak?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/pi-deepseek-peak)
[![license MIT](https://img.shields.io/npm/l/pi-deepseek-peak?style=flat-square)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-7B61FF?style=flat-square)](https://github.com/earendil-works/pi)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2022.18-339933?style=flat-square&logo=node.js&logoColor=white)](#development)

Pi extension that shows DeepSeek peak hours in the TUI status bar, and prices the session with the real peak/off-peak rates.

![Screenshot](screenshot.png)

## Features

- Status bar indicator: "DS Peak" or "DS Normal", with a countdown to the next price change ("DS Peak for 1h30m") — toggle via `/dsp-countdown`
- Auto-refresh at 30s / 1m / 5m (default 5m) via `/dsp-refresh`
- Real session pricing: each assistant reply's stored cost is patched at write time with the rate in effect when it completed, and `/dsp-cost` recomputes the whole session (peak/off-peak split, per model)
- Uses theme colors (warning for peak, success for normal)
- Thats it

## Install

```sh
pi install npm:pi-deepseek-peak
```

Restart pi or run `/reload` to activate.

## Usage

Once installed, the status bar shows the current DeepSeek pricing period. Peak and off-peak rules, windows, and current rates live at
<https://api-docs.deepseek.com/quick_start/pricing/> — in short: peak Mon–Fri 01:00–04:00 and 06:00–10:00 UTC, weekends off-peak all day, off-peak rates are half the peak ones.

### Commands

```sh
/dsp-countdown    # show or hide the countdown next to the dot (menu)
/dsp-refresh      # pick the status refresh interval: 30s, 1m or 5m (menu)
/dsp-cost         # recompute the whole session's real cost
```

`/dsp-cost` re-prices every message from its stored model and timestamp, so it is correct for sessions resumed from disk, and prints:

- current-period rates per model
- `Total $X (peak $A / off-peak $B)`
- per-model token and cost lines
- any model id without a rate entry (those keep pi's bundled cost)

`/session` and the footer show the stored costs, patched by this extension at write time; `/dsp-cost` is the only view that recomputes everything.

Settings are saved to `$PI_CODING_AGENT_DIR/deepseek-peak.json` (default `~/.pi/agent/deepseek-peak.json`) as `{ "countdown": true, "refresh": 300 }` and persist across restarts. Changing `PI_CODING_AGENT_DIR` starts from defaults at the new location.

## Models

The extension resolves rates from the id the API reports (`responseModel`, today `deepseek-flash`), falling back to the requested id — so retired ids, or ids not in pi's catalogue, still price correctly. Any other id keeps pi's bundled cost.

`deepseek-flash` is absent from pi's *built-in* catalogue, but pi overlays the pi.dev catalogue (`$PI_CODING_AGENT_DIR/models-store.json`, refreshed every 4h), which lists it with vision — so normally nothing to do. Only an offline setup (`PI_OFFLINE`) needs it added by hand in `$PI_CODING_AGENT_DIR/models.json`; copy the entry from <https://pi.dev/api/models/providers/deepseek>.

## Development

```sh
npm test    # self-check for the peak/countdown/pricing logic
```

Requires Node ≥ 22.18 (built-in TypeScript type stripping; no build step).

To test a local branch, `pi install /absolute/path/to/pi-deepseek-peak` (it replaces the npm version), then `/reload`; `pi install npm:pi-deepseek-peak` to switch back.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
