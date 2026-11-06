// Self-check for the peak/countdown logic. Zero deps: run with
//   node scripts/selfcheck.ts   (Node >= 22.18; type stripping built in)
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import extension, { isOffPeak, nextPriceChange, formatCountdown, statusText, requestCost, sessionCost, configPath, HOLIDAY_YEARS } from "../extensions/deepseek-peak.ts";

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
assert.equal(f(sat + 22 * H), "27h", "Sat 22:00 UTC (Sun 00:00 Beijing) -> Mon 01:00 UTC = 27h (user example)");
assert.equal(f(fri + 16 * H), "2d9h", "Beijing Sat 00:00 -> Mon 01:00 UTC = 2d9h (long off-peak in days)");

// --- Chinese public holidays (official 2026 State Council dates) are off-peak all day,
// even on weekdays inside the UTC peak windows; 调休 make-up days are Sat/Sun anyway ---
assert.equal(isOffPeak(new Date(Date.UTC(2026, 0, 1, 2))), true, "Thu 2026-01-01 02:00 UTC (New Year) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 16, 2))), true, "Mon 2026-02-16 02:00 UTC (Spring Festival) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 3, 6, 3))), true, "Mon 2026-04-06 03:00 UTC (Ching Ming) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 4, 1, 2))), true, "Fri 2026-05-01 02:00 UTC (Labour Day) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 5, 19, 2))), true, "Fri 2026-06-19 02:00 UTC (Dragon Boat) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 8, 25, 7))), true, "Fri 2026-09-25 07:00 UTC (Mid-Autumn) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 9, 1, 7))), true, "Thu 2026-10-01 07:00 UTC (National Day) -> off-peak");
// A plain weekday is still peak, and a make-up workday stays off-peak (it is a Sunday).
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 9, 2))), false, "Mon 2026-02-09 02:00 UTC (no holiday) -> peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 0, 4, 2))), true, "Sun 2026-01-04 02:00 UTC (make-up workday) -> off-peak");
// Holiday edges are Beijing midnights: Spring Festival ends after Mon 2026-02-23.
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 24, 0, 59))), true, "Tue 2026-02-24 00:59 UTC -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 24, 1))), false, "Tue 2026-02-24 01:00 UTC -> peak");
// The scan horizon spans the whole Spring Festival (the old 4-day window returned null).
assert.equal(
	nextPriceChange(new Date(Date.UTC(2026, 1, 15, 3)))?.getTime(),
	Date.UTC(2026, 1, 24, 1),
	"Sun 2026-02-15 03:00 UTC -> next flip Tue 2026-02-24 01:00 UTC",
);
assert.equal(f(Date.UTC(2026, 1, 15, 3)), "8d22h", "Spring Festival countdown uses days");

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

// requestCost: flash, peak (Mon 02:00 UTC): 1M miss + 100k hit + 200k out -> 0.3 + 0.0006 + 0.24
close(requestCost("deepseek-flash", u(1e6, 1e5, 2e5), mon + 2 * H), 0.5406);
// off-peak (Mon 04:00) -> exactly half
close(requestCost("deepseek-flash", u(1e6, 1e5, 2e5), mon + 4 * H), 0.2703);
// boundary 03:59:59.999 peak vs 04:00 off-peak
close(requestCost("deepseek-flash", u(1e6, 0, 0), mon + 4 * H - 1), 0.3);
close(requestCost("deepseek-flash", u(1e6, 0, 0), mon + 4 * H), 0.15);
// weekend Beijing rule applies to pricing: Sat 02:00 UTC -> off-peak rates
close(requestCost("deepseek-flash", u(1e6, 0, 0), sat + 2 * H), 0.15);
// pro values: 1.32 + 0.0044 + 0.792 = 2.1164
close(requestCost("deepseek-v4-pro", u(1e6, 1e5, 2e5), mon + 2 * H), 2.1164);
close(requestCost("deepseek-v4-pro", u(1e6, 1e5, 2e5), mon + 4 * H), 1.0582);
// retired ids and unknown models are not in the table -> pi's stored total
assert.equal(requestCost("deepseek-v4-flash", u(100, 100, 100, 5.5), mon + 2 * H), 5.5);
assert.equal(requestCost("deepseek-chat", u(100, 100, 100, 5.5), mon + 2 * H), 5.5);

// --- sessionCost: peak + off-peak assistants re-priced, nested tool usage kept at pi's stored cost ---
const msgEntry = (role: string, model: string, ts: number, usage: ReturnType<typeof u>) => ({
	type: "message",
	timestamp: new Date(ts).toISOString(),
	message: { role, model, usage, timestamp: ts },
});
const flashPeak = msgEntry("assistant", "deepseek-flash", mon + 2 * H, u(1e6, 0, 0)); // 0.3 peak
const proOff = msgEntry("assistant", "deepseek-v4-pro", mon + 4 * H, u(0, 0, 1e5)); // 0.198 off-peak
const toolNested = msgEntry("toolResult", "deepseek-v4-pro", mon + 4.1 * H, u(1e6, 0, 0, 0.5)); // stored 0.5, not re-priced
const fallback = msgEntry("assistant", "deepseek-chat", mon + 5 * H, u(100, 100, 100, 7)); // stored 7, unknown
const sc = sessionCost([flashPeak, proOff, toolNested, fallback]);
close(sc.total, 7.998);
close(sc.peakCost, 0.3);
close(sc.offPeakCost, 0.198);
close(sc.byModel["deepseek-flash"].cost, 0.3);
assert.equal(sc.byModel["deepseek-flash"].tokens, 1e6);
close(sc.byModel["deepseek-v4-pro"].cost, 0.198);
assert.equal(sc.byModel["deepseek-v4-pro"].tokens, 1e5);
assert.equal(sc.fallbackMessages, 1);
// tool results and compactions keep pi's stored cost (same as the footer), not counted as fallback
const lone = sessionCost([
	msgEntry("toolResult", "deepseek-v4-pro", mon + 2 * H, u(100, 0, 0, 3)),
	{ type: "compaction", timestamp: new Date(mon + 2 * H).toISOString(), usage: u(1e6, 0, 0, 0.25) },
]);
close(lone.total, 3.25);
assert.equal(lone.fallbackMessages, 0);
// `usage` entries (cache keep-warm requests) are re-priced from their model at their timestamp
const warm = sessionCost([{ type: "usage", model: "deepseek-flash", timestamp: new Date(mon + 2 * H).toISOString(), usage: u(0, 1e6, 0, 9) }]);
close(warm.total, 0.006); // peak cache hit, not the stored 9
close(warm.peakCost, 0.006);
close(warm.byModel["deepseek-flash"].cost, 0.006);
// responseModel overrides the requested model id
const rm = sessionCost([{ ...msgEntry("assistant", "deepseek-v4-flash", mon + 2 * H, u(1e6, 0, 0)), message: { role: "assistant", model: "deepseek-v4-flash", responseModel: "deepseek-v4-pro", usage: u(1e6, 0, 0), timestamp: mon + 2 * H } }]);
close(rm.total, 1.32);
close(rm.byModel["deepseek-v4-pro"].cost, 1.32);

// --- Holiday weekdays price at off-peak rates, and mix with normal peak days in a session ---
close(requestCost("deepseek-flash", u(1e6, 0, 0), Date.UTC(2026, 1, 16, 2)), 0.15); // Spring Festival Monday
const holidayMix = sessionCost([
	msgEntry("assistant", "deepseek-flash", Date.UTC(2026, 1, 16, 2), u(1e6, 0, 0)), // holiday -> 0.15
	msgEntry("assistant", "deepseek-flash", Date.UTC(2026, 1, 9, 2), u(1e6, 0, 0)), // normal Monday -> 0.3
]);
close(holidayMix.total, 0.45);
close(holidayMix.peakCost, 0.3);
close(holidayMix.offPeakCost, 0.15);

// --- Flash price is date-independent now (the 2026-09-10 cutover table is gone): the same
// deepseek-flash rates apply to old and new messages, only peak/off-peak varies. ---
const sep9 = Date.UTC(2026, 8, 9); // Wednesday
const sep10 = Date.UTC(2026, 8, 10); // Thursday

// peak 0.30/M miss whatever the date (Wed 02:00 and Thu 07:00 UTC are both peak)
close(requestCost("deepseek-flash", u(1e6, 0, 0), sep9 + 2 * H), 0.3);
close(requestCost("deepseek-flash", u(1e6, 0, 0), sep10 + 7 * H), 0.3);
// off-peak 0.15/M miss, 0.003/M hit
close(requestCost("deepseek-flash", u(1e6, 0, 0), sep9 + 20 * H), 0.15);
close(requestCost("deepseek-flash", u(1e6, 0, 0), sep10 + 20 * H), 0.15);
close(requestCost("deepseek-flash", u(0, 1e6, 0), sep10 + 20 * H), 0.003);
// retired ids are out of the table (they still price via the reported responseModel)
assert.equal(requestCost("deepseek-v4-flash", u(1e6, 0, 0, 3), sep10 + 7 * H), 3);
assert.equal(requestCost("deepseek-v4-flash-vision-exp", u(1e6, 0, 0, 3), sep10 + 7 * H), 3);

// --- V4.1: the API reports `responseModel: "deepseek-flash"` for every request (including
// deepseek-v4-flash). It is the canonical id and must price at the V4.1 flash table. ---
// Regression: requested deepseek-v4-flash (out of the table), reported deepseek-flash.
const reg = sessionCost([
	{
		type: "message",
		timestamp: new Date(sep10 + 20 * H).toISOString(),
		message: {
			role: "assistant",
			model: "deepseek-v4-flash",
			responseModel: "deepseek-flash",
			usage: u(1e6, 0, 0),
			timestamp: sep10 + 20 * H,
		},
	},
]);
close(reg.total, 0.15); // V4.1 flash off-peak, not pi's bundled 0.14/M
assert.equal(reg.fallbackMessages, 0);
close(reg.byModel["deepseek-flash"].cost, 0.15);
assert.equal(reg.byModel["deepseek-flash"].tokens, 1e6);
assert.deepEqual(reg.unknownModels, []);

// requestCost on the canonical id: peak 0.3 + 0.0006 + 0.24 = 0.5406
close(requestCost("deepseek-flash", u(1e6, 1e5, 2e5), sep10 + 7 * H), 0.5406);
close(requestCost("deepseek-flash", u(1e6, 1e5, 2e5), sep10 + 20 * H), 0.2703);
close(requestCost("deepseek-flash", u(0, 1e6, 0), sep10 + 20 * H), 0.003);

// --- Pro keeps its own rates: the pro->flash routing was retracted, so 2026-09-14 04:00 UTC
// (Monday, off-peak) and 07:00 UTC (peak) are billed at the pro table. ---
const proCut = Date.UTC(2026, 8, 14, 4);
// 04:00 UTC off-peak -> half of 1.32
close(requestCost("deepseek-v4-pro", u(1e6, 0, 0), proCut), 0.66);
// +3h (07:00 UTC, peak) -> full pro rate, not flash 0.30
close(requestCost("deepseek-v4-pro", u(1e6, 0, 0), proCut + 3 * H), 1.32);
const sc3 = sessionCost([
	msgEntry("assistant", "deepseek-v4-pro", proCut + 3 * H, u(1e6, 0, 0)), // 1.32 peak
	msgEntry("assistant", "deepseek-v4-pro", proCut, u(1e6, 0, 0)), // 0.66 off-peak
]);
close(sc3.total, 1.98);
close(sc3.peakCost, 1.32);
close(sc3.offPeakCost, 0.66);

// --- Unknown reported id: fall back to the requested id; both unknown -> pi's cost + listed id ---
const unknownReported = sessionCost([
	{
		type: "message",
		timestamp: new Date(sep10 + 20 * H).toISOString(),
		message: {
			role: "assistant",
			model: "deepseek-flash",
			responseModel: "deepseek-v4.1-flash-x",
			usage: u(1e6, 0, 0),
			timestamp: sep10 + 20 * H,
		},
	},
]);
close(unknownReported.total, 0.15); // falls back to the requested id, which is in the table
assert.equal(unknownReported.fallbackMessages, 0);
assert.deepEqual(unknownReported.unknownModels, []);
const allUnknown = sessionCost([
	{
		type: "message",
		timestamp: new Date(sep10 + 20 * H).toISOString(),
		message: {
			role: "assistant",
			model: "deepseek-v4.1-flash-x",
			responseModel: "deepseek-v4.1-flash-x",
			usage: u(100, 0, 0, 4.2),
			timestamp: sep10 + 20 * H,
		},
	},
]);
close(allUnknown.total, 4.2);
assert.equal(allUnknown.fallbackMessages, 1);
assert.deepEqual(allUnknown.unknownModels, ["deepseek-v4.1-flash-x"]);

// --- message_end handler: rewrites usage.cost with the DeepSeek rate (persisted to the session JSONL) ---
{
	const handlers: Record<string, Function> = {};
	extension({ on: (name: string, fn: Function) => (handlers[name] = fn), registerCommand: () => {} } as any);
	const msg = { role: "assistant", model: "deepseek-v4-pro", responseModel: "deepseek-flash", usage: u(1e6, 1e5, 2e5, 9), timestamp: mon + 2 * H };
	const out = await handlers.message_end({ message: msg }, {});
	// flash peak: 0.3 + 0.0006 + 0.24 = 0.5406, responseModel wins over the requested pro id
	close(out.message.usage.cost.total, 0.5406);
	close(out.message.usage.cost.input + out.message.usage.cost.cacheRead + out.message.usage.cost.output, 0.5406);
	assert.equal(out.message.usage.cost.cacheWrite, 0);
	assert.equal(msg.usage.cost.total, 9, "original message not mutated");
	assert.equal(await handlers.message_end({ message: { ...msg, model: "x", responseModel: "y" } }, {}), undefined, "unknown model -> pi cost kept");
	assert.equal(await handlers.message_end({ message: { role: "user" } }, {}), undefined, "non-assistant ignored");
}

// --- Config path: $PI_CODING_AGENT_DIR when set (leading ~ expanded, like pi), else ~/.pi/agent ---
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
try {
	delete process.env.PI_CODING_AGENT_DIR;
	assert.equal(configPath(), join(homedir(), ".pi", "agent", "deepseek-peak.json"), "unset env -> default ~/.pi/agent");
	process.env.PI_CODING_AGENT_DIR = "";
	assert.equal(configPath(), join(homedir(), ".pi", "agent", "deepseek-peak.json"), "empty env -> default");
	process.env.PI_CODING_AGENT_DIR = "/home/u/.config/pi/agent";
	assert.equal(configPath(), join("/home/u/.config/pi/agent", "deepseek-peak.json"), "absolute env (XDG) wins");
	process.env.PI_CODING_AGENT_DIR = "~/cfg";
	assert.equal(configPath(), join(homedir(), "cfg", "deepseek-peak.json"), "leading ~ expanded like pi");
	process.env.PI_CODING_AGENT_DIR = "relative/cfg";
	assert.equal(configPath(), join("relative/cfg", "deepseek-peak.json"), "relative env kept relative, like pi");
} finally {
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
}

// --- Config save: creates a missing agent dir, writes atomically (no .tmp left behind) ---
{
	const saved = process.env.PI_CODING_AGENT_DIR;
	const root = mkdtempSync(join(tmpdir(), "dsp-"));
	try {
		process.env.PI_CODING_AGENT_DIR = join(root, "missing", "agent");
		const commands: Record<string, any> = {};
		extension({ on: () => {}, registerCommand: (name: string, cmd: any) => (commands[name] = cmd) } as any);
		const ctx = { hasUI: true, ui: { select: async () => "off", notify: () => {}, setStatus: () => {}, theme: { fg: (_c: string, t: string) => t } } };
		await commands["dsp-countdown"].handler("", ctx);
		assert.deepEqual(JSON.parse(readFileSync(configPath(), "utf-8")), { countdown: false, refresh: 300 });
		assert.equal(existsSync(configPath() + ".tmp"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
		if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = saved;
	}
}

// --- Bundled holiday table must cover the current year, and the next one from November
// (the State Council notice for next year comes out early November) ---
{
	const now = new Date();
	const year = now.getUTCFullYear();
	assert.ok(HOLIDAY_YEARS.includes(year), "holiday table needs a refresh — see gov.cn State Council notice");
	if (now.getUTCMonth() >= 10) {
		assert.ok(HOLIDAY_YEARS.includes(year + 1), `holiday table needs ${year + 1} — see gov.cn State Council notice`);
	}
}

console.log("selfcheck OK");
