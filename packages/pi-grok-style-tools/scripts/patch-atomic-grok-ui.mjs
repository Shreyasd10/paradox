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
import {
	DISABLE_FLAG,
	revertCliSource,
	revertGraphThemeSource,
	revertMainSource,
	transformCliSource,
	transformGraphThemeSource,
	transformMainSource,
} from "./atomic-grok-transform.mjs";

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
const workflowsBundlePath = join(
	atomicRoot,
	"dist",
	"builtin",
	"workflows",
	"src",
	"extension",
	"index.bundle.mjs",
);
const graphThemePath = join(atomicRoot, "dist", "builtin", "workflows", "src", "tui", "graph-theme.ts");
const atomicAgentDir = process.env.ATOMIC_CODING_AGENT_DIR || join(homedir(), ".atomic", "agent");
const settingsPath = join(atomicAgentDir, "settings.json");
const piThemesDir = process.env.PI_CODING_AGENT_DIR
	? join(process.env.PI_CODING_AGENT_DIR, "themes")
	: join(homedir(), ".pi", "agent", "themes");
const themeSources = [
	fileURLToPath(new URL("../theme/grok-dark.json", import.meta.url)),
	fileURLToPath(new URL("../theme/oscura-midnight.json", import.meta.url)),
];

function distState(path, transform) {
	if (!existsSync(path)) return "missing";
	return transform(readFileSync(path, "utf8")).status;
}

function applyDist(path, transform, label) {
	const current = readFileSync(path, "utf8");
	const result = transform(current);
	if (result.status === "original") {
		writeFileSync(path, result.source);
		return "patched";
	}
	if (result.status === "patched") return "already-patched";
	console.warn(
		`[grok-ui] skip ${label} (Atomic ${packageJson.version} shape changed). The ~/.atomic/bin wrapper still disables isolation at runtime.`,
	);
	return "skipped";
}

function revertDist(path, revert, label) {
	if (!existsSync(path)) return "missing";
	const current = readFileSync(path, "utf8");
	const result = revert(current);
	if (result.status === "patched") {
		writeFileSync(path, result.source);
		return "reverted";
	}
	if (result.status === "original") return "clean";
	console.warn(`[grok-ui] skip ${label} rollback (no managed patch marker)`);
	return "skipped";
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

/** Atomic also auto-loads ~/.pi/agent/themes; `-path` drops the Pi copy so names do not collide. */
function managedPiThemeExcludes() {
	return themeSources.map((source) => `-${join(piThemesDir, basename(source))}`);
}

function themeExcludesPresent(settings) {
	const themes = Array.isArray(settings?.themes) ? settings.themes : [];
	return managedPiThemeExcludes().every((entry) => themes.includes(entry));
}

/**
 * Durable opt-out in ~/.atomic/agent/settings.json.
 * Survives `atomic update` (which only replaces npm dist artifacts).
 * Current Atomic still needs the runtime wrapper (or dist patch); future Atomic
 * that reads `interactiveEngineIsolation` will honor this without either.
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
	let changed = false;
	if (settings.interactiveEngineIsolation !== false) {
		settings.interactiveEngineIsolation = false;
		changed = true;
	}
	const themes = Array.isArray(settings.themes) ? [...settings.themes] : [];
	for (const entry of managedPiThemeExcludes()) {
		if (!themes.includes(entry)) {
			themes.push(entry);
			changed = true;
		}
	}
	if (!changed) return;
	settings.themes = themes;
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
	if (!current.settings) return;
	const settings = { ...current.settings };
	let changed = false;
	if ("interactiveEngineIsolation" in settings) {
		delete settings.interactiveEngineIsolation;
		changed = true;
	}
	if (Array.isArray(settings.themes)) {
		const managed = new Set(managedPiThemeExcludes());
		const next = settings.themes.filter((entry) => !managed.has(entry));
		if (next.length !== settings.themes.length) {
			if (next.length === 0) delete settings.themes;
			else settings.themes = next;
			changed = true;
		}
	}
	if (!changed) return;
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

if (action === "check") {
	const settings = settingsIsolationState();
	const problems = [];
	for (const source of themeSources) {
		const currentThemeState = themeStateFor(source);
		if (!["linked", "copied"].includes(currentThemeState)) {
			problems.push(`theme:${basename(source)}=${currentThemeState}`);
		}
	}
	if (settings.status !== "opted-out") {
		problems.push(`settings=${settings.status}${settings.message ? `(${settings.message})` : ""}`);
	}
	if (!themeExcludesPresent(settings.settings)) {
		problems.push("themes=missing-pi-excludes");
	}
	if (problems.length > 0) {
		throw new Error(
			`Atomic ${packageJson.version} Grok UI patch is not active (${problems.join(", ")})`,
		);
	}
	const main = distState(mainPath, transformMainSource);
	const cli = distState(cliPath, transformCliSource);
	const workflows = distState(workflowsBundlePath, transformGraphThemeSource);
	const graphTheme = distState(graphThemePath, transformGraphThemeSource);
	console.log(`Atomic ${packageJson.version} Grok UI patch: active`);
	console.log(`Durable settings opt-out: ${settingsPath} (interactiveEngineIsolation=false)`);
	console.log(`Pi theme excludes: ${managedPiThemeExcludes().join(", ")}`);
	console.log(
		`Dist best-effort: main=${main} cli=${cli} workflows=${workflows} graphTheme=${graphTheme} (runtime wrapper does not need these)`,
	);
	process.exit(0);
}

if (action === "apply") {
	applyDist(mainPath, transformMainSource, "dist/main.js");
	applyDist(cliPath, transformCliSource, "dist/cli.js");
	applyDist(workflowsBundlePath, transformGraphThemeSource, "workflows bundle");
	applyDist(graphThemePath, transformGraphThemeSource, "graph-theme.ts");
	ensureThemes();
	ensureSettingsOptOut();
	console.log(`Atomic ${packageJson.version} Grok UI patch applied`);
	for (const source of themeSources) {
		console.log(`Atomic theme linked: ${themeTargetFor(source)}`);
	}
	console.log(`Durable settings opt-out written: ${settingsPath}`);
	console.log(`Pi theme copies excluded: ${managedPiThemeExcludes().join(", ")}`);
	console.log(`Set ${DISABLE_FLAG}=0 to temporarily restore isolation.`);
	console.log("Later `atomic update` does not need a re-patch when using ~/.atomic/bin/atomic.");
	process.exit(0);
}

// rollback
if (themeSources.some((source) => themeStateFor(source) === "linked")) {
	for (const source of themeSources) {
		if (themeStateFor(source) === "linked") unlinkSync(themeTargetFor(source));
	}
}
revertDist(cliPath, revertCliSource, "dist/cli.js");
revertDist(mainPath, revertMainSource, "dist/main.js");
revertDist(workflowsBundlePath, revertGraphThemeSource, "workflows bundle");
revertDist(graphThemePath, revertGraphThemeSource, "graph-theme.ts");
clearSettingsOptOut();
console.log(`Atomic ${packageJson.version} Grok UI patch rolled back`);
