# pi-deepseek-peak

Pi extension that shows DeepSeek peak hours in the TUI status bar.

![Screenshot](screenshot.png)

DeepSeek API pricing varies by time of day. Peak hours are more expensive. This extension adds a persistent status indicator so you know when you are in a peak window.

## Features

- Status bar indicator: "DS Peak" or "DS Normal"
- Follows DeepSeek's billing windows exactly: peak Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; weekends (Sat/Sun Beijing time) are off-peak all day
- Countdown to the next price change next to the dot (on by default, `/dsp-countdown off` to disable): "DS Peak for 1h30m", "DS Normal for 27h"
- Auto-refresh at a configurable interval (30s / 1m / 5m, default 5m) via `/dsp-refresh`
- Uses theme colors (warning for peak, success for normal)
- Thats it

## Install

```sh
pi install npm:pi-deepseek-peak
```

Restart pi or run `/reload` to activate.

## Usage

Once installed, the status bar shows the current DeepSeek pricing period.

### Countdown to the next price change

Show how long until the green/red dot flips (e.g. red peak until 04:00 UTC):

```sh
/dsp-countdown on    # enable: "🔴 DS Peak for 1h30m"
/dsp-countdown off   # disable: "🔴 DS Peak"
/dsp-countdown       # show current state
```

The remaining time is colored with the current state (red while peak, green while off-peak) and refreshes with the same status check. The setting is saved to `~/.pi/agent/deepseek-peak.json`.

### Auto-refresh interval

How often the status indicator refreshes. No value to type — a menu offers the three choices:

```sh
/dsp-refresh    # pick 30s, 1m or 5m from a menu
```

The current interval is shown in the picker title; pick another anytime to switch. The choice is saved to `~/.pi/agent/deepseek-peak.json` (`refresh`, in seconds, default 300) and applies immediately.

### UTC offset (compatibility)

`/dsp-offset` is kept for backward compatibility: DeepSeek's windows are defined in UTC, so the indicator no longer depends on it.

```sh
/dsp-offset 2      # saved, but does not change the indicator
/dsp-offset        # show stored offset
```

The config file `~/.pi/agent/deepseek-peak.json` stores `{ "offset": 2, "countdown": true, "refresh": 300 }` and persists across restarts.

## How it works

On session start, the extension computes the current DeepSeek pricing period and displays either "DS Peak" or "DS Normal" in the pi status bar. A timer refreshes the indicator at the configured interval (default every 5 minutes, adjustable via `/dsp-refresh`).

Billing rule (https://api-docs.deepseek.com/quick_start/pricing/): peak hours are 01:00-04:00 and 06:00-10:00 **UTC**, Monday through Friday. All other hours are off-peak, and weekends (Saturdays and Sundays, Beijing time) are off-peak all day. Since the windows are UTC-based, the indicator is the same for every timezone.

When the countdown option is on, the time until the next status change is shown next to the dot, e.g. "🟢 DS Normal for 27h" on a weekend day (next peak starts Monday 01:00 UTC).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
