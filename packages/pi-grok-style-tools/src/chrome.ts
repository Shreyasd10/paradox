/**
 * Restore Pi's built-in footer (cwd · tokens · context% · cost · model).
 * Clears any prior custom footer from this package.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI || !ctx.ui?.setFooter) return;
		try {
			ctx.ui.setFooter(undefined);
		} catch {
			/* noop */
		}
	});
}
