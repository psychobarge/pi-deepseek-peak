# pi-deepseek-peak

Pi extension that shows DeepSeek peak hours in the TUI status bar.

![Screenshot](screenshot.png)

DeepSeek API pricing varies by time of day. Peak hours are more expensive. This extension adds a persistent status indicator so you know when you are in a peak window.

## Features

- Status bar indicator: "DS Peak" or "DS Normal"
- Follows DeepSeek's billing windows exactly: peak Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; weekends (Sat/Sun Beijing time) are off-peak all day
- Countdown to the next price change next to the dot (on by default, `/dsp-countdown off` to disable): "DS Peak for 1h30m", "DS Normal for 27h"
- Auto-refresh every 5 minutes
- Correct DeepSeek V4 session pricing: each assistant reply's stored cost is patched at write time with the rate in effect when it completed (peak or off-peak), and `/dsp-cost` recomputes the whole session (peak/off-peak split, per model)
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

It recomputes the whole session from the stored messages (model and timestamp per message), so it is correct even for sessions resumed from disk. Output:

- Current-period rates for both models (`DS Peak: flash in $0.44/M (hit $0.014) out $1.32/M · pro in $1.32/M (hit $0.044) out $3.96/M`)
- `Total $X (peak $A / off-peak $B)`
- Per-model token and cost lines
- A note when any message had a model outside the rate table (e.g. legacy `deepseek-chat`): those keep pi's bundled cost

DeepSeek's official rates (https://api-docs.deepseek.com/quick_start/pricing/): peak $0.44 input / $0.014 cache hit / $1.32 output per 1M tokens for flash, $1.32 / $0.044 / $3.96 for pro; off-peak is exactly half.

> **Note:** `/session` and the footer display the stored costs — correct for messages created after this extension was activated, but messages from before (or from a resumed session) keep pi's old flat-rate cost there. `/dsp-cost` is the only view that recomputes everything.

### Countdown to the next price change

Show how long until the green/red dot flips (e.g. red peak until 04:00 UTC):

```sh
/dsp-countdown on    # enable: "🔴 DS Peak for 1h30m"
/dsp-countdown off   # disable: "🔴 DS Peak"
/dsp-countdown       # show current state
```

The remaining time is colored with the current state (red while peak, green while off-peak) and refreshes with the same 5-minute check. The setting is saved to `~/.pi/agent/deepseek-peak.json`.

### UTC offset (compatibility)

`/dsp-offset` is kept for backward compatibility: DeepSeek's windows are defined in UTC, so the indicator no longer depends on it.

```sh
/dsp-offset 2      # saved, but does not change the indicator
/dsp-offset        # show stored offset
```

The config file `~/.pi/agent/deepseek-peak.json` stores `{ "offset": 2, "countdown": true }` and persists across restarts.

## How it works

On session start, the extension computes the current DeepSeek pricing period and displays either "DS Peak" or "DS Normal" in the pi status bar. A timer refreshes the indicator every 5 minutes.

Billing rule (https://api-docs.deepseek.com/quick_start/pricing/): peak hours are 01:00-04:00 and 06:00-10:00 **UTC**, Monday through Friday. All other hours are off-peak, and weekends (Saturdays and Sundays, Beijing time) are off-peak all day. Since the windows are UTC-based, the indicator is the same for every timezone.

When the countdown option is on, the time until the next status change is shown next to the dot, e.g. "🟢 DS Normal for 27h" on a weekend day (next peak starts Monday 01:00 UTC).

The same peak/off-peak rule drives pricing: the extension patches each DeepSeek V4 assistant message's stored cost at `message_end` with the rate in effect at completion, and `/dsp-cost` recomputes the full session history.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
