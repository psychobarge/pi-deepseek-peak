import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const H = 3600e3; // one hour in ms
// DeepSeek peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday, excluding Chinese
// public holidays (weekends, Sat/Sun Beijing time, and holidays are off-peak all day).
const PEAK_WINDOWS: Array<[number, number]> = [
	[1, 4],
	[6, 10],
];

// Chinese public holidays (official State Council dates), off-peak in full. Source:
// State Council notices on gov.cn (2027: https://www.gov.cn/zhengce/content/202611/content_7085101.htm);
// refresh each November when the notice for the next year is released. Make-up workdays (调休) need no entry: they are always
// Sat/Sun, which are off-peak anyway, so only weekday holidays can change a decision.
const CHINA_HOLIDAY_RANGES: Array<[string, string]> = [
	["2026-01-01", "2026-01-03"], // New Year
	["2026-02-15", "2026-02-23"], // Spring Festival
	["2026-04-04", "2026-04-06"], // Ching Ming
	["2026-05-01", "2026-05-05"], // Labour Day
	["2026-06-19", "2026-06-21"], // Dragon Boat
	["2026-09-25", "2026-09-27"], // Mid-Autumn
	["2026-10-01", "2026-10-07"], // National Day
	["2027-01-01", "2027-01-03"], // New Year
	["2027-02-05", "2027-02-13"], // Spring Festival
	["2027-04-03", "2027-04-05"], // Ching Ming
	["2027-05-01", "2027-05-05"], // Labour Day
	["2027-06-09", "2027-06-09"], // Dragon Boat
	["2027-09-15", "2027-09-15"], // Mid-Autumn
	["2027-10-01", "2027-10-07"], // National Day
];

/** Years covered by CHINA_HOLIDAY_RANGES (the selfcheck refuses to pass on a stale table). */
export const HOLIDAY_YEARS: number[] = [
	...new Set(CHINA_HOLIDAY_RANGES.map(([from]) => Number(from.slice(0, 4)))),
];

// Beijing calendar-day keys ("YYYY-MM-DD"), expanded once at load (UTC math, no DST).
const HOLIDAY_DAYS = new Set<string>();
for (const [from, to] of CHINA_HOLIDAY_RANGES) {
	const end = Date.parse(`${to}T00:00:00Z`);
	for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 24 * H) {
		HOLIDAY_DAYS.add(new Date(t).toISOString().slice(0, 10));
	}
}

// Allowed auto-refresh intervals, in seconds. Keep in sync with the /dsp-refresh picker.
const REFRESH_OPTIONS: Array<{ label: string; seconds: number }> = [
	{ label: "30s", seconds: 30 },
	{ label: "1m", seconds: 60 },
	{ label: "5m", seconds: 300 },
];

interface Config {
	countdown: boolean;
	refresh: number; // seconds; must be one of REFRESH_OPTIONS
}

const DEFAULTS: Config = { countdown: true, refresh: 300 };

/**
 * Config file: `$PI_CODING_AGENT_DIR/deepseek-peak.json` when set (leading `~` expanded, like
 * pi's own getAgentDir()), else `~/.pi/agent/deepseek-peak.json`.
 */
export function configPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR;
	const base = dir ? dir.replace(/^~(?=$|[\\/])/, homedir()) : join(homedir(), ".pi", "agent");
	return join(base, "deepseek-peak.json");
}

function loadConfig(): Config {
	try {
		const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
		const refresh =
			typeof cfg.refresh === "number" && REFRESH_OPTIONS.some((o) => o.seconds === cfg.refresh)
				? cfg.refresh
				: DEFAULTS.refresh;
		return {
			countdown: typeof cfg.countdown === "boolean" ? cfg.countdown : DEFAULTS.countdown,
			refresh,
		};
	} catch {
		return { ...DEFAULTS };
	}
}

function saveConfig(patch: Partial<Config>): void {
	const path = configPath();
	const data = JSON.stringify({ ...loadConfig(), ...patch }, null, 2) + "\n";
	mkdirSync(dirname(path), { recursive: true });
	// write-then-rename: a kill mid-write leaves the old file intact instead of a truncated one
	writeFileSync(path + ".tmp", data);
	renameSync(path + ".tmp", path);
}

/** Beijing time (UTC+8) as a Date whose getUTC* fields read Beijing values. */
function beijing(date: Date): Date {
	return new Date(date.getTime() + 8 * H);
}

/**
 * True when DeepSeek bills off-peak: all day on weekends (Sat/Sun Beijing time) and on
 * Chinese public holidays, otherwise outside the UTC peak windows. Peak windows fall
 * inside a single Beijing calendar day, so the holiday lookup by date is exact.
 */
export function isOffPeak(date: Date): boolean {
	const bj = beijing(date);
	const dow = bj.getUTCDay();
	if (dow === 0 || dow === 6) return true;
	if (HOLIDAY_DAYS.has(bj.toISOString().slice(0, 10))) return true;
	const h = date.getUTCHours();
	return !PEAK_WINDOWS.some(([start, end]) => h >= start && h < end);
}

// --- DeepSeek pricing (USD per 1M tokens; peak rates) ---
// Official: https://api-docs.deepseek.com/quick_start/pricing/
// Two models are served: deepseek-flash (V4.1-Flash) and deepseek-v4-pro (V4-Pro-0813).
// The retired ids (deepseek-v4-flash, deepseek-v4-flash-vision-exp) are still accepted by the
// API, served by V4.1-Flash and billed at the Flash price — the API reports `deepseek-flash`
// as `responseModel`, which rateForIds() resolves first, so they price correctly anyway.
// Off-peak = exactly half (official rule), derived at use time. cacheWrite is free.
// hardcoded per user choice — bump on the next rate change.
type Rate = { input: number; cacheRead: number; output: number };

const FLASH_RATES: Rate = { input: 0.3, cacheRead: 0.006, output: 1.2 };
const PRO_RATES: Rate = { input: 1.32, cacheRead: 0.044, output: 3.96 };
const RATES: Record<string, Rate> = {
	"deepseek-flash": FLASH_RATES,
	"deepseek-v4-pro": PRO_RATES,
};

type UsageLike = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens?: number;
	cost?: { total: number };
};

type Timestamp = number | string | Date;

function toMs(ts: Timestamp): number {
	return typeof ts === "number" ? ts : new Date(ts).getTime();
}

/**
 * Effective per-token rates (USD) for a model at a timestamp, or null when the model isn't in the table.
 * `ts` is the instant the request started (`message.timestamp`), never the response end.
 */
function rateFor(model: string, ts: Timestamp): Rate | null {
	const peak = RATES[model];
	if (!peak) return null;
	const k = isOffPeak(new Date(toMs(ts))) ? 0.5 : 1;
	return { input: peak.input * k, cacheRead: peak.cacheRead * k, output: peak.output * k };
}

/**
 * First id present in the rate table wins (the timestamp still picks peak or off-peak).
 * The API reports the canonical id (`responseModel`, e.g. `deepseek-flash`) while the
 * requested id is the fallback, so callers pass `[responseModel, model]`.
 * Returns null only when no id is known.
 */
function rateForIds(
	ids: Array<string | undefined | null>,
	ts: Timestamp,
): { model: string; rate: Rate } | null {
	for (const id of ids) {
		if (id && RATES[id]) return { model: id, rate: rateFor(id, ts)! };
	}
	return null;
}

/** Per-field cost (USD) in pi's `usage.cost` shape; the only place the price formula lives. */
function costBreakdown(rate: Rate, usage: UsageLike) {
	const input = (usage.input * rate.input) / 1e6;
	const output = (usage.output * rate.output) / 1e6;
	const cacheRead = (usage.cacheRead * rate.cacheRead) / 1e6;
	return { input, output, cacheRead, cacheWrite: 0, total: input + output + cacheRead };
}

/** Real cost of one request (USD); pi's stored total for models outside the table. */
export function requestCost(model: string, usage: UsageLike, ts: Timestamp): number {
	const rate = rateFor(model, ts);
	return rate ? costBreakdown(rate, usage).total : (usage.cost?.total ?? 0);
}

export interface SessionCost {
	total: number;
	peakCost: number;
	offPeakCost: number;
	byModel: Record<string, { tokens: number; cost: number }>;
	fallbackMessages: number;
	unknownModels: string[];
}

/**
 * Real session cost from session entries: per-message model and request-start timestamp, peak/off-peak split.
 * Assistant replies and `usage` entries (cache keep-warm requests) are re-priced; tool results and
 * compaction/branch summaries keep pi's stored cost, like the footer (message_end only patches assistants).
 */
export function sessionCost(entries: any[]): SessionCost {
	const result: SessionCost = {
		total: 0,
		peakCost: 0,
		offPeakCost: 0,
		byModel: {},
		fallbackMessages: 0,
		unknownModels: [],
	};
	const unknown = new Set<string>();
	for (const entry of entries) {
		let ids: Array<string | undefined | null> = [];
		let usage: UsageLike | null = null;
		let ts: Timestamp = entry.timestamp;
		if (entry.type === "message") {
			const msg = entry.message;
			ts = msg.timestamp ?? entry.timestamp;
			if (msg.role === "assistant") {
				ids = [msg.responseModel, msg.model];
				usage = msg.usage;
			} else if (msg.role === "toolResult" && msg.usage) {
				result.total += msg.usage.cost?.total ?? 0;
			}
		} else if (entry.type === "usage" && entry.usage) {
			// pi stamps it on completion, but a warm request is maxTokens 1, so start ≈ end. model = responseModel ?? model.
			ids = [entry.model];
			usage = entry.usage;
		} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
			result.total += entry.usage.cost?.total ?? 0;
		}
		if (!usage) continue;
		const resolved = rateForIds(ids, ts);
		if (!resolved) {
			result.total += usage.cost?.total ?? 0;
			result.fallbackMessages++;
			for (const id of ids) if (id) unknown.add(id);
			continue;
		}
		const cost = requestCost(resolved.model, usage, ts);
		result.total += cost;
		const bucket = (result.byModel[resolved.model] ??= { tokens: 0, cost: 0 });
		bucket.tokens += usage.totalTokens ?? usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		bucket.cost += cost;
		if (isOffPeak(new Date(toMs(ts)))) result.offPeakCost += cost;
		else result.peakCost += cost;
	}
	result.unknownModels = [...unknown];
	return result;
}

// How far ahead nextPriceChange looks. Spring Festival is ~9.5 contiguous off-peak days
// (weekend + holiday), so 4 days would return null and blank the countdown mid-holiday.
const CHANGE_SCAN_DAYS = 21;

/**
 * First instant where the green/red status flips, or null (never within range).
 * Candidates: UTC window edges (01:00/04:00/06:00/10:00) and Beijing midnights — holiday
 * boundaries are Beijing midnights too — for the 21 UTC calendar days starting today.
 * Boundaries where the status stays the same (e.g. weekend end = Beijing Monday midnight
 * while local is Sunday evening) are skipped.
 */
export function nextPriceChange(date: Date): Date | null {
	const now = date.getTime();
	const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const state = isOffPeak(date);
	const candidates: number[] = [];
	for (let i = 0; i < CHANGE_SCAN_DAYS; i++) {
		const d = day + i * 24 * H;
		for (const h of [1, 4, 6, 10]) candidates.push(d + h * H);
		candidates.push(d - 8 * H); // Beijing midnight
	}
	for (const t of candidates.sort((a, b) => a - b)) {
		if (t > now && isOffPeak(new Date(t + 1)) !== state) return new Date(t);
	}
	return null;
}

/** Minutes as "2h", "1h30m", "45m" (empty for 0). */
function formatHM(m: number): string {
	if (m === 0) return "";
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	const min = m % 60;
	return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, "0")}m`;
}

/** Time until the next status flip: "8d22h", "27h", "1h30m", "45m" (rounded up to the minute). */
export function formatCountdown(date: Date): string {
	const next = nextPriceChange(date);
	if (!next) return "";
	const m = Math.ceil((next.getTime() - date.getTime()) / 60000);
	// Long off-peak stretches (Chinese holidays) read better in days.
	if (m >= 48 * 60) return `${Math.floor(m / 1440)}d${formatHM(m % 1440)}`;
	return formatHM(m);
}

export function statusText(countdown: boolean, theme: { fg: (color: string, text: string) => string }, now: Date = new Date()): string {
	const peak = !isOffPeak(now);
	const color = peak ? "warning" : "success";
	const label = peak ? "DS Peak" : "DS Normal";
	const cd = countdown ? formatCountdown(now) : "";
	const suffix = cd ? ` for ${cd}` : "";
	return theme.fg(color, `${peak ? "\u{1F534}" : "\u{1F7E2}"} ${label}${suffix}`);
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	// ctx is session-bound: it goes stale after session replacement or /reload.
	// Never capture it in a timer closure. Keep only the current session's ctx,
	// refreshed on session_start and cleared on session_shutdown.
	let currentCtx: any = null;

	function stopTimer(): void {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}

	function updateStatus(ctx: any) {
		ctx.ui.setStatus("deepseek-peak", statusText(loadConfig().countdown, ctx.ui.theme));
	}

	function refreshStatus(): void {
		if (currentCtx === null) return;
		try {
			updateStatus(currentCtx);
		} catch {
			// ctx went stale (session replaced or /reload). Stop polling instead of
			// letting an uncaught exception escape the timer and crash pi.
			stopTimer();
			currentCtx = null;
		}
	}

	pi.registerCommand("dsp-refresh", {
		description: "Pick the status auto-refresh interval (30s / 1m / 5m) from a menu. No argument needed.",
		handler: async (_args: string, ctx: any) => {
			const current = loadConfig().refresh;
			const label = (seconds: number) => REFRESH_OPTIONS.find((o) => o.seconds === seconds)!.label;
			if (!ctx.hasUI) {
				ctx.ui.notify(`Auto-refresh interval: ${label(current)}`, "info");
				return;
			}
			const choice = await ctx.ui.select(
				`Auto-refresh interval (current: ${label(current)})`,
				REFRESH_OPTIONS.map((o) => o.label),
			);
			const picked = REFRESH_OPTIONS.find((o) => o.label === choice);
			if (!picked) return; // cancelled
			saveConfig({ refresh: picked.seconds });
			if (timer !== null) {
				clearInterval(timer);
				timer = setInterval(refreshStatus, picked.seconds * 1000);
			}
			updateStatus(ctx);
			ctx.ui.notify(`Auto-refresh set to ${picked.label}`, "info");
		},
	});

	pi.registerCommand("dsp-cost", {
		description: "Show the real DeepSeek session cost (peak/off-peak rates, per model). Usage: /dsp-cost",
		handler: async (_args: string, ctx: any) => {
			const { total, peakCost, offPeakCost, byModel, fallbackMessages, unknownModels } = sessionCost(ctx.sessionManager.getEntries());
			const fmt = (n: number) => `$${Math.round(n * 10000) / 10000}`;
			const k = isOffPeak(new Date()) ? 0.5 : 1;
			const rates = (m: string) => {
				const r = RATES[m];
				if (!r) return ""; // not in the table; no per-model line for it
				return `in ${fmt(r.input * k)}/M (hit ${fmt(r.cacheRead * k)}) out ${fmt(r.output * k)}/M`;
			};
			const lines = [
				`${isOffPeak(new Date()) ? "DS Normal" : "DS Peak"}: flash ${rates("deepseek-flash")} · pro ${rates("deepseek-v4-pro")}`,
				`Total ${fmt(total)} (peak ${fmt(peakCost)} / off-peak ${fmt(offPeakCost)})`,
			];
			for (const [model, b] of Object.entries(byModel)) {
				lines.push(`${model}: ${b.tokens.toLocaleString("en-US")} tok · ${fmt(b.cost)}`);
			}
			if (fallbackMessages > 0) {
				const ids = unknownModels.length ? ` (${unknownModels.join(", ")})` : "";
				lines.push(
					`${fallbackMessages} message${fallbackMessages === 1 ? "" : "s"} without a rate entry${ids} — kept at pi's bundled cost`,
				);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("dsp-countdown", {
		description: "Pick whether the countdown shows next to the status dot. No argument needed.",
		handler: async (_args: string, ctx: any) => {
			const current = loadConfig().countdown;
			const label = (on: boolean) => (on ? "on" : "off");
			if (!ctx.hasUI) {
				ctx.ui.notify(`Countdown is ${label(current)}`, "info");
				return;
			}
			const choice = await ctx.ui.select(`Countdown (current: ${label(current)})`, ["on", "off"]);
			const picked = choice === "on";
			if (choice !== "on" && choice !== "off") return; // cancelled
			saveConfig({ countdown: picked });
			updateStatus(ctx);
			ctx.ui.notify(`DeepSeek countdown ${label(picked)}`, "info");
		},
	});

	pi.on("message_end", async (event: any, _ctx: any) => {
		const msg = event.message;
		if (msg.role !== "assistant" || !msg.usage) return;
		// Patch the stored cost with the rate in effect when the request started (pi's `timestamp`),
		// so every pi cost surface (footer, /session, usage totals) shows the real DeepSeek price.
		// DeepSeek does not document whether it resolves the rate at receipt or at completion;
		// the request start is used, and it is the only instant pi records for legacy messages.
		const resolved = rateForIds([msg.responseModel, msg.model], msg.timestamp ?? Date.now());
		if (!resolved) return; // unknown model: keep pi's stored cost
		return { message: { ...msg, usage: { ...msg.usage, cost: costBreakdown(resolved.rate, msg.usage) } } };
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		currentCtx = ctx;
		updateStatus(ctx);
		if (timer === null) {
			timer = setInterval(refreshStatus, loadConfig().refresh * 1000);
		}
	});

	pi.on("session_shutdown", async () => {
		stopTimer();
		currentCtx = null;
	});
};
