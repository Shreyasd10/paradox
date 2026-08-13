#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2] ?? "apply";
if (!["apply", "check", "rollback"].includes(action)) {
	throw new Error("Usage: patch-atomic-grok-ui.mjs [apply|check|rollback]");
}

const npmEnv = { ...process.env };
delete npmEnv.npm_config_prefix;
delete npmEnv.NPM_CONFIG_PREFIX;
const npmRoot = execFileSync("npm", ["root", "--global"], { encoding: "utf8", env: npmEnv }).trim();
const atomicRoot = process.env.ATOMIC_PACKAGE_ROOT || join(npmRoot, "@bastani", "atomic");
const packageJson = JSON.parse(readFileSync(join(atomicRoot, "package.json"), "utf8"));
const mainPath = join(atomicRoot, "dist", "main.js");
const cliPath = join(atomicRoot, "dist", "cli.js");
const atomicAgentDir = process.env.ATOMIC_CODING_AGENT_DIR || join(homedir(), ".atomic", "agent");
const settingsPath = join(atomicAgentDir, "settings.json");
const themeSources = [
	fileURLToPath(new URL("../theme/grok-dark.json", import.meta.url)),
	fileURLToPath(new URL("../theme/oscura-midnight.json", import.meta.url)),
];

/** @type {{ original: string; patched: string }[]} */
const mainVariants = [
	// Atomic ≥0.9.12 (bootstrap env object)
	{
		original:
			'const isolateInteractiveHost = appMode === "interactive" && !isPlainRuntimeMetadataCommand(parsed) && engineEnv.child !== "1";',
		patched:
			'const isolateInteractiveHost = appMode === "interactive" && !isPlainRuntimeMetadataCommand(parsed) && engineEnv.child !== "1" && process.env.ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION !== "1";',
	},
	// Older Atomic (direct env flag)
	{
		original:
			'const isolateInteractiveHost = appMode === "interactive" && !isPlainRuntimeMetadataCommand(parsed) && process.env.ATOMIC_INTERACTIVE_ENGINE_CHILD !== "1";',
		patched:
			'const isolateInteractiveHost = appMode === "interactive" && !isPlainRuntimeMetadataCommand(parsed) && process.env.ATOMIC_INTERACTIVE_ENGINE_CHILD !== "1" && process.env.ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION !== "1";',
	},
];

const cliOriginal =
	'process.env[`${APP_NAME.toUpperCase()}_CODING_AGENT`] = "true";\nprocess.emitWarning = (() => { });';
const cliPatched =
	'process.env[`${APP_NAME.toUpperCase()}_CODING_AGENT`] = "true";\nprocess.env.ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION ??= "1";\nprocess.emitWarning = (() => { });';

function mainState() {
	const content = readFileSync(mainPath, "utf8");
	for (const variant of mainVariants) {
		if (content.includes(variant.patched)) return { status: "patched", variant };
		if (content.includes(variant.original)) return { status: "original", variant };
	}
	return { status: "unknown", variant: undefined };
}

function cliState() {
	const content = readFileSync(cliPath, "utf8");
	if (content.includes(cliPatched)) return "patched";
	if (content.includes(cliOriginal)) return "original";
	return "unknown";
}

function replaceOnce(path, from, to, label) {
	const content = readFileSync(path, "utf8");
	if (content.includes(to)) return;
	if (!content.includes(from)) {
		throw new Error(
			`${label} does not match Atomic ${packageJson.version}; update the managed patch before continuing`,
		);
	}
	writeFileSync(path, content.replace(from, to));
}

function themeTargetFor(source) {
	return join(atomicAgentDir, "themes", basename(source));
}

function themeStateFor(source) {
	const themeTarget = themeTargetFor(source);
	if (!existsSync(themeTarget)) return "missing";
	try {
		if (lstatSync(themeTarget).isSymbolicLink() && realpathSync(themeTarget) === realpathSync(source)) {
			return "linked";
		}
		if (readFileSync(themeTarget, "utf8") === readFileSync(source, "utf8")) return "copied";
	} catch {
		return "conflict";
	}
	return "conflict";
}

function ensureThemes() {
	for (const source of themeSources) {
		const themeTarget = themeTargetFor(source);
		const current = themeStateFor(source);
		if (current === "linked" || current === "copied") continue;
		if (current === "conflict") {
			throw new Error(`Refusing to replace unmanaged Atomic theme: ${themeTarget}`);
		}
		mkdirSync(dirname(themeTarget), { recursive: true });
		symlinkSync(source, themeTarget);
	}
}

/**
 * Durable opt-out in ~/.atomic/agent/settings.json.
 * Survives `atomic update` (which only replaces npm dist artifacts).
 * Current Atomic still needs the dist patch; future Atomic that reads
 * `interactiveEngineIsolation` will honor this without re-patching.
 */
function settingsIsolationState() {
	if (!existsSync(settingsPath)) return { status: "missing", settings: undefined };
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: "malformed", settings: undefined, message };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { status: "malformed", settings: undefined, message: "settings.json root must be an object" };
	}
	const value = parsed.interactiveEngineIsolation;
	if (value === false) return { status: "opted-out", settings: parsed };
	if (value === true || value === undefined) return { status: "default", settings: parsed };
	return {
		status: "conflict",
		settings: parsed,
		message: `interactiveEngineIsolation must be a boolean (got ${typeof value})`,
	};
}

function ensureSettingsOptOut() {
	const current = settingsIsolationState();
	if (current.status === "malformed" || current.status === "conflict") {
		throw new Error(
			`Refusing to rewrite Atomic settings: ${current.message ?? "invalid interactiveEngineIsolation"} (${settingsPath})`,
		);
	}
	const settings = current.settings ? { ...current.settings } : {};
	if (settings.interactiveEngineIsolation === false) return;
	settings.interactiveEngineIsolation = false;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function clearSettingsOptOut() {
	const current = settingsIsolationState();
	if (current.status === "malformed" || current.status === "conflict") {
		throw new Error(
			`Refusing to rewrite Atomic settings: ${current.message ?? "invalid interactiveEngineIsolation"} (${settingsPath})`,
		);
	}
	if (!current.settings || !("interactiveEngineIsolation" in current.settings)) return;
	const settings = { ...current.settings };
	delete settings.interactiveEngineIsolation;
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

const main = mainState();
const cli = cliState();

if (action === "check") {
	const settings = settingsIsolationState();
	const problems = [];
	if (main.status !== "patched") problems.push(`main=${main.status}`);
	if (cli !== "patched") problems.push(`cli=${cli}`);
	for (const source of themeSources) {
		const currentThemeState = themeStateFor(source);
		if (!["linked", "copied"].includes(currentThemeState)) {
			problems.push(`theme:${basename(source)}=${currentThemeState}`);
		}
	}
	if (settings.status !== "opted-out") {
		problems.push(`settings=${settings.status}${settings.message ? `(${settings.message})` : ""}`);
	}
	if (problems.length > 0) {
		throw new Error(
			`Atomic ${packageJson.version} Grok UI patch is not active (${problems.join(", ")})`,
		);
	}
	console.log(`Atomic ${packageJson.version} Grok UI patch: active`);
	console.log(`Durable settings opt-out: ${settingsPath} (interactiveEngineIsolation=false)`);
	process.exit(0);
}

if (action === "apply") {
	if (main.status === "unknown") {
		throw new Error(
			`dist/main.js does not match Atomic ${packageJson.version}; update the managed patch before continuing`,
		);
	}
	if (main.status === "original" && main.variant) {
		replaceOnce(mainPath, main.variant.original, main.variant.patched, "dist/main.js");
	}
	replaceOnce(cliPath, cliOriginal, cliPatched, "dist/cli.js");
	ensureThemes();
	ensureSettingsOptOut();
	console.log(`Atomic ${packageJson.version} Grok UI patch applied`);
	for (const source of themeSources) {
		console.log(`Atomic theme linked: ${themeTargetFor(source)}`);
	}
	console.log(`Durable settings opt-out written: ${settingsPath}`);
	console.log("Set ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION=0 to temporarily restore isolation.");
	console.log("Re-run `npm run atomic:patch` after `atomic update` (dist patches are replaced).");
	process.exit(0);
}

// rollback
if (themeSources.some((source) => themeStateFor(source) === "linked")) {
	for (const source of themeSources) {
		if (themeStateFor(source) === "linked") unlinkSync(themeTargetFor(source));
	}
}
if (cli === "patched") replaceOnce(cliPath, cliPatched, cliOriginal, "dist/cli.js");
if (main.status === "patched" && main.variant) {
	replaceOnce(mainPath, main.variant.patched, main.variant.original, "dist/main.js");
} else if (main.status === "patched") {
	// Patched with a known variant shape but state() already matched — find which
	const content = readFileSync(mainPath, "utf8");
	const variant = mainVariants.find((entry) => content.includes(entry.patched));
	if (!variant) {
		throw new Error(`dist/main.js is patched but does not match a known rollback pattern`);
	}
	replaceOnce(mainPath, variant.patched, variant.original, "dist/main.js");
}
clearSettingsOptOut();
console.log(`Atomic ${packageJson.version} Grok UI patch rolled back`);
