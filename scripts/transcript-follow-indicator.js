// Patched pi host: main-chat "Jump to bottom" follow indicator.
// Ported from bastani-inc/atomic packages/coding-agent/src/modes/interactive/components/transcript-follow-indicator.ts
// (MIT). Shows a clickable pill while the main transcript is scrolled away
// from its live end; clicking emits the internal jump URL handled by
// interactive-mode.js.
import { hyperlink, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";

export const TRANSCRIPT_JUMP_TO_END_URL = "atomic-ui://transcript/jump-to-end";
const FULL_RESET = "\x1b[0m";

export class TranscriptFollowIndicator {
	constructor(options) {
		this.options = options;
	}
	invalidate() {}
	render(width) {
		if (this.options.isFollowing()) return [];
		const viewportWidth = Math.max(0, Math.floor(width));
		if (viewportWidth === 0) return [""];

		const keyLabel = this.options.keyLabel();
		const label = keyLabel.length > 0 ? `Jump to bottom (${keyLabel}) ↓` : "Jump to bottom ↓";

		// The highlight is the box: one padding column on each side, dropped when the
		// viewport cannot afford both columns and a visible character.
		const sidePadding = viewportWidth >= 3 ? 1 : 0;
		const truncatedLabel = truncateToWidth(label, viewportWidth - sidePadding * 2);
		const labelWidth = visibleWidth(truncatedLabel);
		if (labelWidth === 0) return [""];

		const pad = " ".repeat(sidePadding);
		const highlightWidth = labelWidth + sidePadding * 2;
		const leftPadding = " ".repeat(Math.floor((viewportWidth - highlightWidth) / 2));
		// `truncateToWidth` marks its ellipsis with a full SGR reset, which would punch a
		// hole in the highlight; restore both colors after every reset it emits.
		const restyled = truncatedLabel.replaceAll(
			FULL_RESET,
			`${FULL_RESET}${theme.getBgAnsi("selectedBg")}${theme.getFgAnsi("muted")}`,
		);
		const highlighted = theme.bg("selectedBg", theme.fg("muted", `${pad}${restyled}${pad}`));

		return [`${leftPadding}${hyperlink(highlighted, TRANSCRIPT_JUMP_TO_END_URL)}`];
	}
}
