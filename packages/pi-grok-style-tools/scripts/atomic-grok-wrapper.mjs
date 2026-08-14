#!/usr/bin/env node

/**
 * PATH wrapper for `atomic`.
 * Installed to ~/.atomic/bin/atomic (must precede ~/.npm-global/bin on PATH).
 *
 * Disables interactive-engine isolation at runtime (env + ESM loader) so Grok UI
 * patches reach the parent TUI. Dist files are not required to stay patched
 * across `atomic update`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DISABLE_FLAG = "ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION";
const wrapperPath = fileURLToPath(import.meta.url);
const wrapperDir = dirname(wrapperPath);
const args = process.argv.slice(2);
const registerPath = join(wrapperDir, "atomic-grok-register.mjs");

function pathEntries() {
	return (process.env.PATH ?? "").split(delimiter).filter(Boolean);
}

function resolveAtomicCandidate(dir) {
	const candidate = join(dir, "atomic");
	if (!existsSync(candidate)) return undefined;
	try {
		const real = realpathSync(candidate);
		if (real === realpathSync(wrapperPath)) return undefined;
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

function isolationEnv() {
	const env = { ...process.env };
	if (env[DISABLE_FLAG] === undefined) env[DISABLE_FLAG] = "1";
	return env;
}

const realAtomic = findRealAtomic();
if (!realAtomic) {
	console.error(
		"[grok-ui] could not find the real `atomic` binary on PATH (behind ~/.atomic/bin). Set ATOMIC_REAL_BIN.",
	);
	process.exit(1);
}

const env = isolationEnv();
const useLoader = existsSync(registerPath) && env[DISABLE_FLAG] !== "0";
const result = useLoader
	? spawnSync(process.execPath, ["--import", pathToFileURL(registerPath).href, realAtomic, ...args], {
			stdio: "inherit",
			env,
		})
	: spawnSync(realAtomic, args, { stdio: "inherit", env });

process.exit(result.status ?? (result.signal ? 1 : 0));
