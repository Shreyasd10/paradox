#!/usr/bin/env node

/**
 * PATH wrapper for `atomic` that re-applies the Grok UI patch after a self-update.
 * Installed to ~/.atomic/bin/atomic (must precede ~/.npm-global/bin on PATH).
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const wrapperPath = fileURLToPath(import.meta.url);
const wrapperDir = dirname(wrapperPath);
const args = process.argv.slice(2);

function resolveGrokRoot() {
	if (process.env.PI_GROK_STYLE_TOOLS) return process.env.PI_GROK_STYLE_TOOLS;
	return join(homedir(), "Desktop", "workspace", "pi-grok-style-tools");
}

function pathEntries() {
	return (process.env.PATH ?? "").split(delimiter).filter(Boolean);
}

function resolveAtomicCandidate(dir) {
	const candidate = join(dir, "atomic");
	if (!existsSync(candidate)) return undefined;
	try {
		const real = realpathSync(candidate);
		if (real === realpathSync(wrapperPath)) return undefined;
		// Skip another copy of this same wrapper dir
		if (dirname(real) === wrapperDir) return undefined;
		return candidate;
	} catch {
		return undefined;
	}
}

function findRealAtomic() {
	if (process.env.ATOMIC_REAL_BIN && existsSync(process.env.ATOMIC_REAL_BIN)) {
		return process.env.ATOMIC_REAL_BIN;
	}
	for (const dir of pathEntries()) {
		if (dir === wrapperDir) continue;
		const candidate = resolveAtomicCandidate(dir);
		if (candidate) return candidate;
	}
	return undefined;
}

/**
 * True when this invocation updates the Atomic package itself (replaces dist).
 * Extension/model-only updates do not need a re-patch.
 */
function updateIncludesAtomicSelf(argv) {
	if (argv[0] !== "update") return false;
	const rest = argv.slice(1);
	if (rest.includes("--help") || rest.includes("-h")) return false;
	if (rest.includes("--all") || rest.includes("--self")) return true;

	const positionals = [];
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--extension") {
			i += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		positionals.push(arg);
	}

	if (positionals.length === 0) {
		if (rest.includes("--extensions") || rest.includes("--models")) return false;
		return true;
	}
	return positionals.some((value) => value === "self" || value === "atomic");
}

function runPatch() {
	const grokRoot = resolveGrokRoot();
	const patchScript = join(grokRoot, "scripts", "patch-atomic-grok-ui.mjs");
	if (!existsSync(patchScript)) {
		console.error(
			`[grok-ui] skip auto-patch: patch script not found at ${patchScript} (set PI_GROK_STYLE_TOOLS)`,
		);
		return false;
	}
	console.log("[grok-ui] re-applying Atomic Grok UI patch after self-update…");
	const result = spawnSync(process.execPath, [patchScript, "apply"], {
		stdio: "inherit",
		cwd: grokRoot,
	});
	if (result.status !== 0) {
		console.error(
			`[grok-ui] auto-patch failed (exit ${result.status ?? "unknown"}). Run: cd ${grokRoot} && npm run atomic:patch`,
		);
		return false;
	}
	return true;
}

const realAtomic = findRealAtomic();
if (!realAtomic) {
	console.error(
		"[grok-ui] could not find the real `atomic` binary on PATH (behind ~/.atomic/bin). Set ATOMIC_REAL_BIN.",
	);
	process.exit(1);
}

const result = spawnSync(realAtomic, args, {
	stdio: "inherit",
	env: process.env,
});
const exitCode = result.status ?? (result.signal ? 1 : 0);

if (exitCode === 0 && updateIncludesAtomicSelf(args)) {
	runPatch();
}

process.exit(exitCode);
