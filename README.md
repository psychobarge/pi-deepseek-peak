# pi-deepseek-peak

Pi extension that shows DeepSeek peak hours in the TUI status bar.

DeepSeek API pricing varies by time of day. Peak hours are more expensive. This extension adds a persistent status indicator so you know when you are in a peak window.

## Features

- Status bar indicator: "DS Peak" or "DS Normal"
- Configurable UTC offset for your timezone
- Auto-refresh every 5 minutes
- Uses theme colors (warning for peak, success for normal)
- Thats it

## Install

```sh
pi install git:github.com/psychobarge/pi-deepseek-peak
```

Restart pi or run `/reload` to activate.

## Usage

Once installed, the status bar shows the current DeepSeek pricing period.

### UTC offset

Peak hours are defined in UTC (01:00-04:00 and 06:00-10:00). Set your local UTC offset so the indicator matches your timezone:

```sh
/dsp-offset 2      # set UTC+2 (France summer, default)
/dsp-offset 1      # set UTC+1 (France winter)
/dsp-offset -5     # set UTC-5 (US Eastern)
/dsp-offset        # show current offset
```

The offset is saved to `~/.pi/agent/deepseek-peak.json` and persists across restarts.

## How it works

On session start, the extension reads the configured offset, computes the local hour, and displays either "DS Peak" or "DS Normal" in the pi status bar. A timer refreshes the indicator every 5 minutes.

Peak windows (after offset): 03:00-06:00 and 08:00-12:00 local time at default UTC+2.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
