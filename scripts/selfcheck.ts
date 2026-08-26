// Self-check for the peak/countdown logic. Zero deps: run with
//   node scripts/selfcheck.ts   (Node >= 22.18; type stripping built in)
import assert from "node:assert/strict";
import { isOffPeak, nextPriceChange, formatCountdown, statusText, requestCost, sessionCost } from "../extensions/deepseek-peak.ts";

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

// --- Real cost: DeepSeek V4 rate table (peak rates; off-peak = half) ---
const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

const u = (input: number, cacheRead: number, output: number, storedTotal = 0) => ({
	input,
	cacheRead,
	output,
	cacheWrite: 0,
	totalTokens: input + cacheRead + output,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: storedTotal },
});

// requestCost: flash, peak (Mon 02:00 UTC): 1M miss + 100k hit + 200k out -> 0.44 + 0.0014 + 0.264
close(requestCost("deepseek-v4-flash", u(1e6, 1e5, 2e5), mon + 2 * H).cost, 0.7054);
// off-peak (Mon 04:00) -> exactly half
close(requestCost("deepseek-v4-flash", u(1e6, 1e5, 2e5), mon + 4 * H).cost, 0.3527);
// boundary 03:59:59.999 peak vs 04:00 off-peak
close(requestCost("deepseek-v4-flash", u(1e6, 0, 0), mon + 4 * H - 1).cost, 0.44);
close(requestCost("deepseek-v4-flash", u(1e6, 0, 0), mon + 4 * H).cost, 0.22);
// weekend Beijing rule applies to pricing: Sat 02:00 UTC -> off-peak rates
close(requestCost("deepseek-v4-flash", u(1e6, 0, 0), sat + 2 * H).cost, 0.22);
// pro values: 1.32 + 0.0044 + 0.792 = 2.1164
close(requestCost("deepseek-v4-pro", u(1e6, 1e5, 2e5), mon + 2 * H).cost, 2.1164);
close(requestCost("deepseek-v4-pro", u(1e6, 1e5, 2e5), mon + 4 * H).cost, 1.0582);
// unknown model -> known: false, cost = pi's stored total
assert.deepEqual(requestCost("deepseek-chat", u(100, 100, 100, 5.5), mon + 2 * H), { cost: 5.5, known: false });

// --- sessionCost: peak + off-peak assistants, nested tool usage attributed to preceding assistant ---
const msgEntry = (role: string, model: string, ts: number, usage: ReturnType<typeof u>) => ({
	type: "message",
	timestamp: new Date(ts).toISOString(),
	message: { role, model, usage, timestamp: ts },
});
const flashPeak = msgEntry("assistant", "deepseek-v4-flash", mon + 2 * H, u(1e6, 0, 0)); // 0.44 peak
const proOff = msgEntry("assistant", "deepseek-v4-pro", mon + 4 * H, u(0, 0, 1e5)); // 0.198 off-peak
const toolNested = msgEntry("toolResult", "deepseek-v4-pro", mon + 4.1 * H, u(1e6, 0, 0)); // 0.66 off-peak (pro)
const fallback = msgEntry("assistant", "deepseek-chat", mon + 5 * H, u(100, 100, 100, 7)); // stored 7, unknown
const sc = sessionCost([flashPeak, proOff, toolNested, fallback]);
close(sc.total, 8.298);
close(sc.peakCost, 0.44);
close(sc.offPeakCost, 0.858);
close(sc.byModel["deepseek-v4-flash"].cost, 0.44);
assert.equal(sc.byModel["deepseek-v4-flash"].tokens, 1e6);
close(sc.byModel["deepseek-v4-pro"].cost, 0.858);
assert.equal(sc.byModel["deepseek-v4-pro"].tokens, 1.1e6);
assert.equal(sc.fallbackMessages, 1);
// nested tool usage before any assistant -> counted at stored cost
const lone = sessionCost([msgEntry("toolResult", "deepseek-v4-pro", mon + 2 * H, u(100, 0, 0, 3))]);
close(lone.total, 3);
assert.equal(lone.fallbackMessages, 1);
// responseModel overrides the requested model id
const rm = sessionCost([{ ...msgEntry("assistant", "deepseek-v4-flash", mon + 2 * H, u(1e6, 0, 0)), message: { role: "assistant", model: "deepseek-v4-flash", responseModel: "deepseek-v4-pro", usage: u(1e6, 0, 0), timestamp: mon + 2 * H } }]);
close(rm.total, 1.32);
close(rm.byModel["deepseek-v4-pro"].cost, 1.32);

console.log("selfcheck OK");
