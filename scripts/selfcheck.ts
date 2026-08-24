// Self-check for the peak/countdown logic. Zero deps: run with
//   node scripts/selfcheck.ts   (Node >= 22.18; type stripping built in)
import assert from "node:assert/strict";
import { isOffPeak, nextPriceChange, formatCountdown, statusText } from "../extensions/deepseek-peak.ts";

const H = 3600e3;
// Fixed clock: 2026-08-21 = Friday, 08-22 = Saturday, 08-23 = Sunday, 08-24 = Monday (UTC).
const fri = Date.UTC(2026, 7, 21);
const sat = Date.UTC(2026, 7, 22);
const sun = Date.UTC(2026, 7, 23);
const mon = Date.UTC(2026, 7, 24);

// --- Weekends (Sat/Sun Beijing time) are off-peak all day, even inside UTC peak windows ---
assert.equal(isOffPeak(new Date(sat + 2 * H)), true, "Sat 02:00 UTC (Beijing 10:00) -> off-peak");
assert.equal(isOffPeak(new Date(sat + 7 * H)), true, "Sat 07:00 UTC (Beijing 15:00) -> off-peak");
assert.equal(isOffPeak(new Date(sun + 3 * H)), true, "Sun 03:00 UTC (Beijing 11:00) -> off-peak");
assert.equal(isOffPeak(new Date(fri + 17 * H)), true, "Fri 17:00 UTC = Beijing Sat 01:00 -> off-peak");
assert.equal(isOffPeak(new Date(sun + 17 * H)), true, "Sun 17:00 UTC = Beijing Mon 01:00 -> off-peak (Paris Sun 19:00)");

// --- Weekdays: UTC windows 01:00-04:00 and 06:00-10:00, exclusive right edges ---
assert.equal(isOffPeak(new Date(mon + 2 * H)), false, "Mon 02:00 UTC -> peak");
assert.equal(isOffPeak(new Date(mon + 4 * H - 1)), false, "Mon 03:59:59.999 UTC -> peak");
assert.equal(isOffPeak(new Date(mon + 4 * H)), true, "Mon 04:00 UTC -> off-peak");
assert.equal(isOffPeak(new Date(mon + 7 * H)), false, "Mon 07:00 UTC -> peak");
assert.equal(isOffPeak(new Date(mon + 10 * H)), true, "Mon 10:00 UTC -> off-peak");
assert.equal(isOffPeak(new Date(mon + H - 1)), true, "Mon 00:59:59.999 UTC -> off-peak");
assert.equal(isOffPeak(new Date(mon + 20 * H)), true, "Mon 20:00 UTC -> off-peak");

// --- nextPriceChange: skips no-flip boundaries (Beijing weekend start/end) ---
assert.equal(
	nextPriceChange(new Date(fri + 15 * H))?.getTime(),
	mon + H,
	"Fri 15:00 UTC -> next flip is Mon 01:00 UTC (Beijing midnight Sat & Sun edges skip)",
);

// --- Countdown formatting ---
const f = (t: number) => formatCountdown(new Date(t));
assert.equal(f(mon + 2.5 * H), "1h30m", "Mon 02:30 UTC -> 04:00 = 1h30m");
assert.equal(f(mon + 3.25 * H), "45m", "Mon 03:15 UTC -> 04:00 = 45m");
assert.equal(f(mon + 2 * H + 55 * 60000), "1h05m", "Mon 02:55 UTC -> 04:00 = 1h05m");
assert.equal(f(mon + 3 * H), "1h", "Mon 03:00 UTC -> 04:00 = 1h");
assert.equal(f(sat + 22 * H), "27h", "Sun 00:00 local (offset 2) -> Mon 01:00 UTC = 27h (user example)");
assert.equal(f(fri + 16 * H), "57h", "Beijing Sat 00:00 -> Mon 01:00 UTC = 57h (max)");

// --- Full status strings with mock theme ---
const theme = { fg: (color: string, text: string) => `[${color}]${text}[/${color}]` };
assert.equal(
	statusText(true, theme, new Date(mon + 2.5 * H)),
	"[warning]\u{1F534} DS Peak for 1h30m[/warning]",
	"red state: countdown in warning color",
);
assert.equal(
	statusText(true, theme, new Date(sat + 22 * H)),
	"[success]\u{1F7E2} DS Normal for 27h[/success]",
	"green weekend: countdown in success color",
);
assert.equal(
	statusText(false, theme, new Date(mon + 2.5 * H)),
	"[warning]\u{1F534} DS Peak[/warning]",
	"countdown off: no suffix",
);

console.log("selfcheck OK");
