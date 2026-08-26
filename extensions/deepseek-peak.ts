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

interface Config {
	// Kept for backward compatibility (existing config files / /dsp-offset command).
	// DeepSeek windows are UTC, so the offset no longer affects the indicator.
	offset: number;
	countdown: boolean;
}

const DEFAULTS: Config = { offset: 2, countdown: true };

function loadConfig(): Config {
	try {
		const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		return {
			offset: typeof cfg.offset === "number" ? cfg.offset : DEFAULTS.offset,
			countdown: typeof cfg.countdown === "boolean" ? cfg.countdown : DEFAULTS.countdown,
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
// ponytail: hardcoded per user choice — bump the package when DeepSeek changes rates.
const RATES: Record<string, { input: number; cacheRead: number; output: number }> = {
	"deepseek-v4-flash": { input: 0.44, cacheRead: 0.014, output: 1.32 },
	"deepseek-v4-flash-vision-exp": { input: 0.44, cacheRead: 0.014, output: 1.32 },
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

/** Effective per-token rates (USD) for a model at a timestamp, or null when the model isn't in the table. */
function rateFor(model: string, ts: Timestamp): { input: number; cacheRead: number; output: number } | null {
	const peak = RATES[model];
	if (!peak) return null;
	const k = isOffPeak(new Date(toMs(ts))) ? 0.5 : 1;
	return { input: peak.input * k, cacheRead: peak.cacheRead * k, output: peak.output * k };
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
}

/**
 * Real session cost from session entries: per-message model and timestamp, peak/off-peak split.
 * Nested tool usage and compaction/branch summaries are attributed to the nearest preceding
 * assistant message's model; without one they count at pi's stored cost (fallbackMessages).
 */
export function sessionCost(entries: any[]): SessionCost {
	const result: SessionCost = { total: 0, peakCost: 0, offPeakCost: 0, byModel: {}, fallbackMessages: 0 };
	let lastModel: string | null = null;
	for (const entry of entries) {
		let model: string | null = null;
		let usage: UsageLike | null = null;
		let ts: Timestamp = entry.timestamp;
		if (entry.type === "message") {
			const msg = entry.message;
			ts = msg.timestamp ?? entry.timestamp;
			if (msg.role === "assistant") {
				model = msg.responseModel ?? msg.model;
				lastModel = model;
				usage = msg.usage;
			} else if (msg.role === "toolResult" && msg.usage) {
				model = lastModel;
				usage = msg.usage;
			}
		} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
			model = lastModel;
			usage = entry.usage;
		}
		if (!usage) continue;
		const { cost, known } = requestCost(model ?? "", usage, ts);
		result.total += cost;
		if (!known) {
			result.fallbackMessages++;
			continue;
		}
		const bucket = (result.byModel[model!] ??= { tokens: 0, cost: 0 });
		bucket.tokens += usage.totalTokens ?? usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		bucket.cost += cost;
		if (isOffPeak(new Date(toMs(ts)))) result.offPeakCost += cost;
		else result.peakCost += cost;
	}
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

	pi.registerCommand("dsp-offset", {
		description: "Set UTC offset (compat only: DeepSeek windows are UTC, the indicator no longer depends on it). Usage: /dsp-offset 3",
		handler: async (args: string, ctx: any) => {
			const n = parseInt(args, 10);
			if (isNaN(n)) {
				ctx.ui.notify(`Stored offset: UTC+${loadConfig().offset} (compat only)`, "info");
				return;
			}
			saveConfig({ offset: n });
			ctx.ui.notify("Offset saved (compat only — DeepSeek windows are UTC, the indicator no longer depends on it)", "info");
		},
	});

	pi.registerCommand("dsp-cost", {
		description: "Show the real DeepSeek session cost (peak/off-peak rates, per model). Usage: /dsp-cost",
		handler: async (_args: string, ctx: any) => {
			const { total, peakCost, offPeakCost, byModel, fallbackMessages } = sessionCost(ctx.sessionManager.getEntries());
			const fmt = (n: number) => `$${Math.round(n * 10000) / 10000}`;
			const k = isOffPeak(new Date()) ? 0.5 : 1;
			const rates = (m: string) => {
				const r = RATES[m];
				return `in ${fmt(r.input * k)}/M (hit ${fmt(r.cacheRead * k)}) out ${fmt(r.output * k)}/M`;
			};
			const lines = [
				`${isOffPeak(new Date()) ? "DS Normal" : "DS Peak"}: flash ${rates("deepseek-v4-flash")} · pro ${rates("deepseek-v4-pro")}`,
				`Total ${fmt(total)} (peak ${fmt(peakCost)} / off-peak ${fmt(offPeakCost)})`,
			];
			for (const [model, b] of Object.entries(byModel)) {
				lines.push(`${model}: ${b.tokens.toLocaleString("en-US")} tok · ${fmt(b.cost)}`);
			}
			if (fallbackMessages > 0) {
				lines.push(`${fallbackMessages} message${fallbackMessages === 1 ? "" : "s"} kept at pi's bundled cost`);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("dsp-countdown", {
		description: "Show time until the next price change next to the status dot. Usage: /dsp-countdown on|off",
		handler: async (args: string, ctx: any) => {
			const arg = args.trim().toLowerCase();
			if (arg !== "on" && arg !== "off") {
				ctx.ui.notify(`Countdown is ${loadConfig().countdown ? "on" : "off"}`, "info");
				return;
			}
			saveConfig({ countdown: arg === "on" });
			updateStatus(ctx);
			ctx.ui.notify(`DeepSeek countdown ${arg}`, "info");
		},
	});

	pi.on("message_end", async (event: any, _ctx: any) => {
		const msg = event.message;
		if (msg.role !== "assistant" || !msg.usage) return;
		// Patch the stored cost with the rate in effect when the request completed, so every
		// pi cost surface (footer, /session, usage totals) shows the real DeepSeek price.
		const rate = rateFor(msg.responseModel ?? msg.model, msg.timestamp ?? Date.now());
		if (!rate) return; // unknown model: keep pi's stored cost
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
			timer = setInterval(refreshStatus, 5 * 60 * 1000);
		}
	});

	pi.on("session_shutdown", async () => {
		stopTimer();
		currentCtx = null;
	});
};
