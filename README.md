# pi-deepseek-peak

Pi extension that shows DeepSeek peak hours in the TUI status bar.

![Screenshot](screenshot.png)

DeepSeek API pricing varies by time of day. Peak hours are more expensive. This extension adds a persistent status indicator so you know when you are in a peak window.

## Features

- Status bar indicator: "DS Peak" or "DS Normal"
- Follows DeepSeek's billing windows exactly: peak Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; weekends (Sat/Sun Beijing time) are off-peak all day
- Countdown to the next price change next to the dot (on by default, toggle via `/dsp-countdown`): "DS Peak for 1h30m", "DS Normal for 27h"
- Auto-refresh at a configurable interval (30s / 1m / 5m, default 5m) via `/dsp-refresh`
- Correct DeepSeek V4 session pricing: each assistant reply's stored cost is patched at write time with the rate in effect when it completed (peak or off-peak), and `/dsp-cost` recomputes the whole session (peak/off-peak split, per model: V4.1 flash, flash, flash-vision-exp and pro)
- Reads the model id the API reports (`responseModel`, currently `deepseek-flash`) and falls back to the requested id, so V4.1 responses are priced correctly even though `deepseek-flash` is not a pi-bundled model
- Uses theme colors (warning for peak, success for normal)
- Thats it

## Install

```sh
pi install npm:pi-deepseek-peak
```

Restart pi or run `/reload` to activate.

## Usage

Once installed, the status bar shows the current DeepSeek pricing period.

### Real session cost

Every DeepSeek V4 assistant reply is priced at the rate in effect when the request completed (peak/off-peak), and the stored cost is corrected at write time — so pi's footer and `/session` cost totals already reflect the real price. To see the full breakdown:

```sh
/dsp-cost
```

It recomputes the whole session from the stored messages (model and timestamp per message), so it is correct even for sessions resumed from disk. Each message is priced at the rate table in effect when it completed — flash messages before 2026-09-10 04:00 UTC use the old rates, from that instant on the new ones. For each message the extension reads the id DeepSeek reports back (`responseModel`, today `deepseek-flash`) and, if that id is not in the table, the id that was requested. Output:

- Current-period rates for both models (`DS Peak: flash in $0.30/M (hit $0.006) out $1.20/M · pro in $1.32/M (hit $0.044) out $3.96/M`); from 2026-09-14 04:00 UTC pro is routed to flash and the line reads `pro in $0.30/M (hit $0.006) out $1.20/M (routed to flash)`
- `Total $X (peak $A / off-peak $B)`
- Per-model token and cost lines
- A note when any message had a model outside the rate table (e.g. legacy `deepseek-chat`): those keep pi's bundled cost, and the unknown ids are listed

DeepSeek's official rates (https://api-docs.deepseek.com/quick_start/pricing/): since 2026-09-10 12:00 Beijing (= 04:00 UTC), $0.30 input / $0.006 cache hit / $1.20 output per 1M tokens at peak (half off-peak) for flash and flash-vision-exp, $1.32 / $0.044 / $3.96 for pro; before that cutover, flash was $0.44 / $0.014 / $1.32. From 2026-09-14 12:00 Beijing (= 04:00 UTC) V4 Pro is routed to V4.1 Flash and billed at the flash rates above. Off-peak is exactly half.

> **Note:** `/session` and the footer display the stored costs — correct for messages created after this extension was activated, but messages from before (or from a resumed session) keep pi's old flat-rate cost there. `/dsp-cost` is the only view that recomputes everything.

### Countdown to the next price change

Show how long until the green/red dot flips (e.g. red peak until 04:00 UTC). The menu offers on/off:

```sh
/dsp-countdown    # pick on or off from a menu
```
enable: "🔴 DS Peak for 1h30m"
disable: "🔴 DS Peak"

The remaining time is colored with the current state (red while peak, green while off-peak) and refreshes with the same status check. The setting is saved to `~/.pi/agent/deepseek-peak.json`.

### Auto-refresh interval

How often the status indicator refreshes. No value to type — a menu offers the three choices:

```sh
/dsp-refresh    # pick 30s, 1m or 5m from a menu
```

The current interval is shown in the picker title; pick another anytime to switch. The choice is saved to `~/.pi/agent/deepseek-peak.json` (`refresh`, in seconds, default 300) and applies immediately.

The config file `~/.pi/agent/deepseek-peak.json` stores `{ "countdown": true, "refresh": 300 }` and persists across restarts.

## How it works

On session start, the extension computes the current DeepSeek pricing period and displays either "DS Peak" or "DS Normal" in the pi status bar. A timer refreshes the indicator at the configured interval (default every 5 minutes, adjustable via `/dsp-refresh`).

Billing rule (https://api-docs.deepseek.com/quick_start/pricing/): peak hours are 01:00-04:00 and 06:00-10:00 **UTC**, Monday through Friday. All other hours are off-peak, and weekends (Saturdays and Sundays, Beijing time) are off-peak all day. Since the windows are UTC-based, the indicator is the same for every timezone.

When the countdown option is on, the time until the next status change is shown next to the dot, e.g. "🟢 DS Normal for 27h" on a weekend day (next peak starts Monday 01:00 UTC).

The same peak/off-peak rule drives pricing: the extension patches each DeepSeek V4 assistant message's stored cost at `message_end` with the rate table in effect at completion (peak/off-peak), and `/dsp-cost` recomputes the full session history. Flash series rates changed on 2026-09-10 04:00 UTC, so pre-cutover messages stay priced at the old flash table and later ones at the new; from 2026-09-14 04:00 UTC V4 Pro is billed at the flash table it is routed to.

## V4.1 Flash and pi's model catalogue

DeepSeek V4.1 Flash is live. Three model ids matter:

- `deepseek-flash` — the canonical V4.1 Flash id, and the one the API reports back as `responseModel` for every request, including the older ids below.
- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` — **removed server-side** but still accepted and routed to V4.1 Flash, billed at the same rates.
- `deepseek-v4-pro` — still accepted; routed to V4.1 Flash and billed at flash rates from 2026-09-14 12:00 Beijing (= 04:00 UTC).

The extension prices a message with the id the API reports first (`responseModel`), then the requested id, so all three land on the same V4.1 flash table.

pi's bundled catalogue ships `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` and `deepseek-v4-pro` — but **not** `deepseek-flash`. An extension cannot add it: `registerProvider("deepseek", { models })` replaces the provider's whole model list. So add it yourself in `~/.pi/agent/models.json` (merge it — the provider's other models survive):

```json
{
  "providers": {
    "deepseek": {
      "models": [
        {
          "id": "deepseek-flash",
          "name": "DeepSeek V4.1 Flash",
          "api": "openai-completions",
          "baseUrl": "https://api.deepseek.com",
          "reasoning": true,
          "input": ["text", "image"],
          "cost": { "input": 0.3, "output": 1.2, "cacheRead": 0.006, "cacheWrite": 0 },
          "contextWindow": 1000000,
          "maxTokens": 384000,
          "compat": {
            "supportsStore": false,
            "supportsDeveloperRole": false,
            "maxTokensField": "max_tokens",
            "requiresReasoningContentOnAssistantMessages": true,
            "thinkingFormat": "deepseek"
          },
          "thinkingLevelMap": { "minimal": null, "low": "low", "medium": null, "high": "high", "max": "max" }
        }
      ]
    }
  }
}
```

Why bother: it is the only way to get **vision** (`input: ["text", "image"]`) under the V4.1 Flash id — the bundled catalogue has no entry for it. The `cost` block above is informational for pi's own estimate; this extension reprices the session anyway.

Gotchas:

- `models.json` is global: `~/.pi/agent/models.json`, or `$PI_CODING_AGENT_DIR/models.json` when that env var is set.
- `settings.json` `providers.*` is ignored (tested) — use `models.json`.
- `enabledModels` only controls Ctrl+P cycling; it is not a whitelist.

## Testing an unpublished branch

To test a local branch (e.g. `feat/[branch_name]`) before publishing:

```sh
# from the repo on your host machine
git checkout feat/[branch_name]
```

### With pi installed locally

```sh
pi install /absolute/path/to/pi-deepseek-peak
```

This replaces the published npm version (no need to uninstall it first). Then `/reload` (or restart pi). 
To switch back to the released version:

```sh
pi install npm:pi-deepseek-peak
```

and `/reload` again.

### When pi runs inside a Docker container

Copy the branch into the running container, then install from there:

```sh
docker cp . <container-name>:/tmp/pi-deepseek-peak
```

Run the following inside the container's pi:

```sh
pi install /tmp/pi-deepseek-peak
```

If a previously installed copy of this extension is still active (e.g. an old npm/git source), remove it :

```sh
pi list          # see the installed sources
pi remove git:github.com/psychobarge/pi-deepseek-peak
```

Then `/reload` to pick up the change.
To get back to the released version and set it as the only source:

```sh
pi install npm:pi-deepseek-peak
```

and `/reload`. Iterating often? Mount the repo as a Docker volume (`-v ~/Workspace/Perso/pi-deepseek-peak:/app/pi-deepseek-peak ...`) and reinstall after each `git checkout` on the host.

## Development

Run the self-check for the peak/countdown/pricing logic:

```sh
npm test
```

Requires Node ≥ 22.18 (built-in TypeScript type stripping; no build step).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
