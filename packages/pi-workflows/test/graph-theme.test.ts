import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveGraphTheme, deriveGraphThemeFromPiTheme } from "../src/tui/graph-theme.js";

function truecolor(kind: "fg" | "bg", hex: string): string {
	const n = hex.replace("#", "");
	const r = Number.parseInt(n.slice(0, 2), 16);
	const g = Number.parseInt(n.slice(2, 4), 16);
	const b = Number.parseInt(n.slice(4, 6), 16);
	return `\x1b[${kind === "fg" ? 38 : 48};2;${r};${g};${b}m`;
}

/** Oscura Midnight tokens from ~/.pi/agent/themes/oscura-midnight.json */
const OSCURA = {
	customMessageBg: "#020203",
	toolPendingBg: "#020203",
	userMessageBg: "#1C1E24",
	selectedBg: "#242034",
	accent: "#C4A7E7",
	customMessageLabel: "#9B7ECE",
	mdLink: "#7DCFDF",
	success: "#7EBBA5",
	warning: "#F1BD00",
	error: "#DC5A64",
	text: "#E4E4E4",
	customMessageText: "#E4E4E4",
	muted: "#81868F",
	dim: "#5E646C",
	border: "#343048",
	borderMuted: "#242034",
	borderAccent: "#9B7ECE",
} as const;

const BG_KEYS = new Set(["customMessageBg", "toolPendingBg", "userMessageBg", "selectedBg"]);

/** Mirrors Pi's Theme class: accessors read instance maps via `this`. */
class BoundPiTheme {
	constructor(private readonly tokens: Record<string, string>) {}
	getFgAnsi(color: string): string {
		const hex = this.tokens[color];
		if (!hex || BG_KEYS.has(color)) throw new Error(`unknown fg ${color}`);
		return truecolor("fg", hex);
	}
	getBgAnsi(color: string): string {
		const hex = this.tokens[color];
		if (!hex || !BG_KEYS.has(color)) throw new Error(`unknown bg ${color}`);
		return truecolor("bg", hex);
	}
}

/** Mirrors Pi's exported `theme` Proxy, which forwards methods unbound. */
function fakePiTheme(tokens: Record<string, string>): BoundPiTheme {
	const inner = new BoundPiTheme(tokens);
	return new Proxy({} as BoundPiTheme, {
		get(_target, prop) {
			return inner[prop as keyof BoundPiTheme];
		},
	});
}

describe("deriveGraphThemeFromPiTheme", () => {
	test("falls back to Mocha canvas when the host theme is missing", () => {
		const mocha = deriveGraphTheme({});
		assert.equal(deriveGraphThemeFromPiTheme(undefined).bg, mocha.bg);
		assert.equal(deriveGraphThemeFromPiTheme({}).bg, mocha.bg);
		assert.equal(mocha.bg, "#1e1e2e");
	});

	test("maps Oscura Midnight page/panels/accents onto the graph canvas", () => {
		const theme = deriveGraphThemeFromPiTheme(fakePiTheme(OSCURA));
		assert.equal(theme.bg, "#020203");
		assert.equal(theme.surface, "#020203");
		assert.equal(theme.backgroundPanel, "#1c1e24");
		assert.equal(theme.backgroundElement, "#1c1e24");
		assert.equal(theme.selection, "#242034");
		assert.equal(theme.accent, "#c4a7e7");
		assert.equal(theme.mauve, "#9b7ece");
		assert.equal(theme.info, "#7dcfdf");
		assert.equal(theme.success, "#7ebba5");
		assert.equal(theme.warning, "#f1bd00");
		assert.equal(theme.error, "#dc5a64");
		assert.equal(theme.text, "#e4e4e4");
	});

	test("falls back per-token when only some Pi accessors resolve", () => {
		const mocha = deriveGraphTheme({});
		const theme = deriveGraphThemeFromPiTheme(
			fakePiTheme({
				accent: "#C4A7E7",
			}),
		);
		assert.equal(theme.accent, "#c4a7e7");
		assert.equal(theme.bg, mocha.bg);
		assert.equal(theme.info, "#c4a7e7");
	});
});
