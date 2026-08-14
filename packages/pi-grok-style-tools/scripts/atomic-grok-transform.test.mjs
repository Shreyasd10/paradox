import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DISABLE_CHECK,
	DISABLE_DEFAULT,
	isAtomicMainUrl,
	isAtomicWorkflowsGraphUrl,
	revertCliSource,
	revertGraphThemeSource,
	revertMainSource,
	transformCliSource,
	transformGraphThemeSource,
	transformMainSource,
} from "./atomic-grok-transform.mjs";

const mainV0912 =
	'const isolateInteractiveHost = appMode === "interactive" && !isPlainRuntimeMetadataCommand(parsed) && engineEnv.child !== "1";';
const mainOlder =
	'const isolateInteractiveHost = appMode === "interactive" && !isPlainRuntimeMetadataCommand(parsed) && process.env.ATOMIC_INTERACTIVE_ENGINE_CHILD !== "1";';

const cliV0912 = `process.env[\`\${APP_NAME.toUpperCase()}_CODING_AGENT\`] = "true";
process.emitWarning = (() => { });`;

const cliV0913 = `process.env[\`\${APP_NAME.toUpperCase()}_CODING_AGENT\`] = "true";
process.env.AI_AGENT = ATOMIC_AI_AGENT;
process.emitWarning = (() => { });`;

test("main transform appends the disable check for 0.9.12+ and older builds", () => {
	for (const original of [mainV0912, mainOlder]) {
		const once = transformMainSource(original);
		assert.equal(once.status, "original");
		assert.ok(once.source.includes(DISABLE_CHECK));
		const twice = transformMainSource(once.source);
		assert.equal(twice.status, "patched");
		assert.equal(twice.source, once.source);
		const reverted = revertMainSource(once.source);
		assert.equal(reverted.status, "patched");
		assert.equal(reverted.source, original);
	}
});

test("cli transform inserts after CODING_AGENT and survives the 0.9.13 AI_AGENT line", () => {
	for (const original of [cliV0912, cliV0913]) {
		const once = transformCliSource(original);
		assert.equal(once.status, "original");
		assert.ok(once.source.includes(DISABLE_DEFAULT));
		assert.ok(once.source.includes('process.env[`${APP_NAME.toUpperCase()}_CODING_AGENT`] = "true";'));
		if (original.includes("AI_AGENT")) {
			assert.ok(once.source.includes("process.env.AI_AGENT = ATOMIC_AI_AGENT;"));
		}
		const twice = transformCliSource(once.source);
		assert.equal(twice.status, "patched");
		const reverted = revertCliSource(once.source);
		assert.equal(reverted.status, "patched");
		assert.equal(reverted.source, original);
	}
});

test("unknown shapes are left alone", () => {
	assert.equal(transformMainSource("export const x = 1;").status, "unknown");
	assert.equal(transformCliSource("console.log(1);").status, "unknown");
});

test("atomic main URL matcher", () => {
	assert.equal(
		isAtomicMainUrl("file:///Users/me/.npm-global/lib/node_modules/@bastani/atomic/dist/main.js"),
		true,
	);
	assert.equal(isAtomicMainUrl("file:///Users/me/.npm-global/lib/node_modules/@bastani/atomic/dist/cli.js"), false);
});

const bundledGraphTheme = `function tryPiAccessor(fn, color) {
  if (typeof fn !== "function")
    return;
  try {
    return fn(color);
  } catch {
    return;
  }
}
function fgHex(theme, color) {
  return parsePiAnsiToHex(tryPiAccessor(theme.getFgAnsi, color));
}
function bgHex(theme, color) {
  return parsePiAnsiToHex(tryPiAccessor(theme.getBgAnsi, color));
}
function deriveGraphThemeFromPiTheme(theme) {
  if (!theme || typeof theme !== "object")
    return deriveGraphTheme({});
  const t = theme;
  const accent = fgHex(t, "accent");
  const overrides = {
    backgroundPanel: bgHex(t, "toolPendingBg") ?? bgHex(t, "customMessageBg"),
    backgroundElement: bgHex(t, "customMessageBg") ?? bgHex(t, "toolPendingBg"),
    selection: bgHex(t, "selectedBg"),
  };
  return deriveGraphTheme(cleaned);
}
`;

test("graph theme transform binds accessors and maps Oscura canvas bg", () => {
	const once = transformGraphThemeSource(bundledGraphTheme);
	assert.equal(once.status, "original");
	assert.ok(once.source.includes("return fn.call(theme, color);"));
	assert.ok(once.source.includes("tryPiAccessor(theme, theme.getFgAnsi, color)"));
	assert.ok(once.source.includes('const page = bgHex(t, "customMessageBg") ?? bgHex(t, "toolPendingBg")'));
	assert.ok(once.source.includes("bg: page,"));
	assert.ok(once.source.includes("backgroundPanel: elevated,"));
	assert.equal(transformGraphThemeSource(once.source).status, "patched");
	const reverted = revertGraphThemeSource(once.source);
	assert.equal(reverted.status, "patched");
	assert.equal(reverted.source, bundledGraphTheme);
});

test("graph theme URL matcher", () => {
	assert.equal(
		isAtomicWorkflowsGraphUrl(
			"file:///Users/me/.npm-global/lib/node_modules/@bastani/atomic/dist/builtin/workflows/src/extension/index.bundle.mjs",
		),
		true,
	);
	assert.equal(
		isAtomicWorkflowsGraphUrl("file:///Users/me/.npm-global/lib/node_modules/@bastani/atomic/dist/main.js"),
		false,
	);
});
