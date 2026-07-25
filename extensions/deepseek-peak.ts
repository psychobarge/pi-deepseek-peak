import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".pi/agent/deepseek-peak.json");

function loadOffset(): number {
	if (existsSync(CONFIG_PATH)) {
		try {
			const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
			if (typeof cfg.offset === "number") return cfg.offset;
		} catch {}
	}
	return 2;
}

function saveOffset(offset: number): void {
	writeFileSync(CONFIG_PATH, JSON.stringify({ offset }, null, 2) + "\n");
}

function isPeak(offset: number): boolean {
	const h = new Date().getUTCHours() + offset;
	return (h >= 3 && h < 6) || (h >= 8 && h < 12);
}

function statusText(offset: number, theme: { fg: (color: string, text: string) => string }): string {
	return isPeak(offset)
		? theme.fg("warning", "\u{1F534} DS Peak")
		: theme.fg("success", "\u{1F7E2} DS Normal");
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;

	function updateStatus(ctx: any) {
		const offset = loadOffset();
		ctx.ui.setStatus("deepseek-peak", statusText(offset, ctx.ui.theme));
	}

	pi.registerCommand("dsp-offset", {
		description: "Set UTC offset for DeepSeek peak hours (default 2). Usage: /dsp-offset 3",
		handler: async (args: string, ctx: any) => {
			const n = parseInt(args, 10);
			if (isNaN(n)) {
				ctx.ui.notify(`Current offset: UTC+${loadOffset()}`, "info");
				return;
			}
			saveOffset(n);
			updateStatus(ctx);
			ctx.ui.notify(`DeepSeek peak offset set to UTC+${n}`, "info");
		},
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		updateStatus(ctx);
		timer = setInterval(() => updateStatus(ctx), 5 * 60 * 1000);
	});

	pi.on("session_shutdown", async () => {
		if (timer !== null) clearInterval(timer);
	});
};
