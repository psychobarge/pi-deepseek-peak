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
