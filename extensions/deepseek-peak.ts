import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".pi/agent/deepseek-peak.json");

const H = 3600e3; // one hour in ms
// DeepSeek peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday
// (weekends, Sat/Sun Beijing time, are off-peak all day).
const PEAK_WINDOWS: Array<[number, number]> = [
	[1, 4],
	[6, 10],
];

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

function loadConfig(): Config {
	try {
		const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
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
	writeFileSync(CONFIG_PATH, JSON.stringify({ ...loadConfig(), ...patch }, null, 2) + "\n");
}

/** Day of week (0=Sun..6=Sat) in Beijing time (UTC+8) — DeepSeek bills weekends by Beijing time. */
function beijingDay(date: Date): number {
	return new Date(date.getTime() + 8 * H).getUTCDay();
}

/** True when DeepSeek bills off-peak: all day on weekends (Sat/Sun Beijing time), otherwise outside the UTC peak windows. */
export function isOffPeak(date: Date): boolean {
	const dow = beijingDay(date);
	if (dow === 0 || dow === 6) return true;
	const h = date.getUTCHours();
	return !PEAK_WINDOWS.some(([start, end]) => h >= start && h < end);
}

// --- DeepSeek V4 pricing (USD per 1M tokens; peak rates) ---
// Official: https://api-docs.deepseek.com/quick_start/pricing/
// Off-peak = exactly half (official rule), derived at use time.
// cacheWrite is free; legacy model ids (deepseek-chat/deepseek-reasoner) are not in the
// table because their historical rates are unknowable — those keep pi's bundled cost.
type Rate = { input: number; cacheRead: number; output: number };

// Flash series (deepseek-v4-flash + deepseek-v4-flash-vision-exp, same price line) plus the
// canonical V4.1 id (deepseek-flash) that the API reports as `responseModel`.
// DeepSeek cut flash prices on 2026-09-10 12:00 Beijing (= 04:00 UTC): messages completing
// before FLASH_CUTOFF keep FLASH_RATES_OLD, from that instant on they use FLASH_RATES.
// ponytail: hardcoded per user choice — bump FLASH_RATES + FLASH_CUTOFF on the next rate change.
const FLASH_RATES_OLD: Rate = { input: 0.44, cacheRead: 0.014, output: 1.32 };
const FLASH_RATES: Rate = { input: 0.3, cacheRead: 0.006, output: 1.2 };
const FLASH_CUTOFF = Date.UTC(2026, 8, 10, 4); // 2026-09-10 12:00 Beijing = 04:00 UTC
const FLASH_MODELS = ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];
// V4 Pro is routed to V4.1 Flash on the server and billed at flash rates from
// 2026-09-14 12:00 Beijing (= 04:00 UTC).
// ponytail: temporary cutover state — handle a proper V4.1 Pro rate when it ships.
const PRO_FLASH_CUTOFF = Date.UTC(2026, 8, 14, 4);

const RATES: Record<string, Rate> = {
	"deepseek-flash": FLASH_RATES,
	"deepseek-v4-flash": FLASH_RATES_OLD,
	"deepseek-v4-flash-vision-exp": FLASH_RATES_OLD,
	"deepseek-v4-pro": { input: 1.32, cacheRead: 0.044, output: 3.96 },
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

/** Peak rates (USD/1M) for a model at a timestamp, or null when the model isn't in the table. */
function ratesFor(model: string, ts: Timestamp): Rate | null {
	const peak = RATES[model];
	if (!peak) return null;
	const t = toMs(ts);
	if (FLASH_MODELS.includes(model)) return t >= FLASH_CUTOFF ? FLASH_RATES : FLASH_RATES_OLD;
	if (model === "deepseek-v4-pro" && t >= PRO_FLASH_CUTOFF) return FLASH_RATES;
	return peak;
}

/** Effective per-token rates (USD) for a model at a timestamp, or null when the model isn't in the table. */
function rateFor(model: string, ts: Timestamp): Rate | null {
	const peak = ratesFor(model, ts);
	if (!peak) return null;
	const k = isOffPeak(new Date(toMs(ts))) ? 0.5 : 1;
	return { input: peak.input * k, cacheRead: peak.cacheRead * k, output: peak.output * k };
}

/**
 * First id present in the rate table wins (timestamp applied, so cutovers still hold).
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

/** Real cost of one request (USD); `known: false` with pi's stored total for models outside the table. */
export function requestCost(
	model: string,
	usage: UsageLike,
	ts: Timestamp,
): { cost: number; known: boolean } {
	const rate = rateFor(model, ts);
	if (!rate) return { cost: usage.cost?.total ?? 0, known: false };
	const cost = (usage.input * rate.input + usage.cacheRead * rate.cacheRead + usage.output * rate.output) / 1e6;
	return { cost, known: true };
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
 * Real session cost from session entries: per-message model and timestamp, peak/off-peak split.
 * Nested tool usage and compaction/branch summaries are attributed to the nearest preceding
 * assistant message's model; without one they count at pi's stored cost (fallbackMessages).
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
	let lastModel: string | null = null;
	for (const entry of entries) {
		let ids: Array<string | undefined | null> = [];
		let usage: UsageLike | null = null;
		let isAssistant = false;
		let ts: Timestamp = entry.timestamp;
		if (entry.type === "message") {
			const msg = entry.message;
			ts = msg.timestamp ?? entry.timestamp;
			if (msg.role === "assistant") {
				ids = [msg.responseModel, msg.model];
				isAssistant = true;
				usage = msg.usage;
			} else if (msg.role === "toolResult" && msg.usage) {
				ids = [lastModel];
				usage = msg.usage;
			}
		} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
			ids = [lastModel];
			usage = entry.usage;
		}
		if (!usage) continue;
		const resolved = rateForIds(ids, ts);
		if (isAssistant) lastModel = resolved?.model ?? ids[0] ?? null;
		if (!resolved) {
			result.total += usage.cost?.total ?? 0;
			result.fallbackMessages++;
			for (const id of ids) if (id) unknown.add(id);
			continue;
		}
		const { cost } = requestCost(resolved.model, usage, ts);
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

/**
 * First instant where the green/red status flips, or null (never within range).
 * Candidates: UTC window edges (01:00/04:00/06:00/10:00) and Beijing midnights, for
 * the 4 UTC calendar days starting today. Boundaries where the status stays the same
 * (e.g. weekend end = Beijing Monday midnight while local is Sunday evening) are skipped.
 */
export function nextPriceChange(date: Date): Date | null {
	const now = date.getTime();
	const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const state = isOffPeak(date);
	const candidates: number[] = [];
	for (let i = 0; i < 4; i++) {
		const d = day + i * 24 * H;
		for (const h of [1, 4, 6, 10]) candidates.push(d + h * H);
		candidates.push(d - 8 * H); // Beijing midnight
	}
	for (const t of candidates.sort((a, b) => a - b)) {
		if (t > now && isOffPeak(new Date(t + 1)) !== state) return new Date(t);
	}
	return null;
}

/** Time until the next status flip: "27h", "1h30m", "45m" (rounded up to the minute). */
export function formatCountdown(date: Date): string {
	const next = nextPriceChange(date);
	if (!next) return "";
	const m = Math.ceil((next.getTime() - date.getTime()) / 60000);
	if (m % 60 === 0) return `${m / 60}h`;
	if (m < 60) return `${m}m`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
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
				const r = ratesFor(m, new Date());
				if (!r) return ""; // not in the table; no per-model line for it
				return `in ${fmt(r.input * k)}/M (hit ${fmt(r.cacheRead * k)}) out ${fmt(r.output * k)}/M`;
			};
			// After PRO_FLASH_CUTOFF, ratesFor() already returns the flash table for pro; the
			// suffix explains why pro and flash show the same numbers.
			const proNote = Date.now() >= PRO_FLASH_CUTOFF ? " (routed to flash)" : "";
			const lines = [
				`${isOffPeak(new Date()) ? "DS Normal" : "DS Peak"}: flash ${rates("deepseek-flash")} · pro ${rates("deepseek-v4-pro")}${proNote}`,
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
		// Patch the stored cost with the rate in effect when the request completed, so every
		// pi cost surface (footer, /session, usage totals) shows the real DeepSeek price.
		const resolved = rateForIds([msg.responseModel, msg.model], msg.timestamp ?? Date.now());
		if (!resolved) return; // unknown model: keep pi's stored cost
		const rate = resolved.rate;
		const u = msg.usage;
		const cost = {
			input: (u.input * rate.input) / 1e6,
			output: (u.output * rate.output) / 1e6,
			cacheRead: (u.cacheRead * rate.cacheRead) / 1e6,
			cacheWrite: 0,
			total: 0,
		};
		cost.total = cost.input + cost.output + cost.cacheRead;
		return { message: { ...msg, usage: { ...u, cost } } };
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
