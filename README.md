# pi-deepseek-peak

Pi extension that shows DeepSeek peak hours in the TUI status bar.

DeepSeek API pricing varies by time of day. Peak hours are more expensive. This extension adds a persistent status indicator so you know when you are in a peak window.

## Features

- Status bar indicator: "DS Peak" or "DS Normal"
- Follows DeepSeek's billing windows exactly: peak Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; weekends (Sat/Sun Beijing time) are off-peak all day
- Optional countdown to the next price change next to the dot (`/dsp-countdown on`): "DS Peak for 1h30m", "DS Normal for 27h"
- Auto-refresh every 5 minutes
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

The remaining time is colored with the current state (red while peak, green while off-peak) and refreshes with the same 5-minute check. The setting is saved to `~/.pi/agent/deepseek-peak.json`.

### UTC offset (compatibility)

`/dsp-offset` is kept for backward compatibility: DeepSeek's windows are defined in UTC, so the indicator no longer depends on it.

```sh
/dsp-offset 2      # saved, but does not change the indicator
/dsp-offset        # show stored offset
```

The config file `~/.pi/agent/deepseek-peak.json` stores `{ "offset": 2, "countdown": false }` and persists across restarts.

## How it works

On session start, the extension computes the current DeepSeek pricing period and displays either "DS Peak" or "DS Normal" in the pi status bar. A timer refreshes the indicator every 5 minutes.

Billing rule (https://api-docs.deepseek.com/quick_start/pricing/): peak hours are 01:00-04:00 and 06:00-10:00 **UTC**, Monday through Friday. All other hours are off-peak, and weekends (Saturdays and Sundays, Beijing time) are off-peak all day. Since the windows are UTC-based, the indicator is the same for every timezone.

When the countdown option is on, the time until the next status change is shown next to the dot, e.g. "🟢 DS Normal for 27h" on a weekend day (next peak starts Monday 01:00 UTC).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
