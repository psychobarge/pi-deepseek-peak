import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isPeak(): boolean {
	const h = new Date().getUTCHours();
	return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

function statusText(theme: { fg: (color: string, text: string) => string }): string {
	return isPeak()
		? theme.fg("warning", "🔴 DS Peak")
		: theme.fg("success", "🟢 DS Normal");
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("deepseek-peak", statusText(ctx.ui.theme));
		timer = setInterval(() => {
			ctx.ui.setStatus("deepseek-peak", statusText(ctx.ui.theme));
		}, 5 * 60 * 1000);
	});

	pi.on("session_shutdown", async () => {
		if (timer !== null) clearInterval(timer);
	});
}
