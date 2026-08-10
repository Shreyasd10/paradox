#!/usr/bin/env node

/**
 * Installs the Grok auto-patch wrapper at ~/.atomic/bin/atomic and ensures
 * that directory is first on PATH in the user's shell rc.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2] ?? "install";
if (!["install", "uninstall", "check"].includes(action)) {
	throw new Error("Usage: install-atomic-wrapper.mjs [install|uninstall|check]");
}

const home = homedir();
const wrapperSource = fileURLToPath(new URL("./atomic-grok-wrapper.mjs", import.meta.url));
const binDir = process.env.ATOMIC_GROK_BIN_DIR || join(home, ".atomic", "bin");
const wrapperTarget = join(binDir, "atomic");
const pathExport =
	'export PATH="$HOME/.atomic/bin:$PATH"  # pi-grok-style-tools auto-patch after atomic update';

function isOurWrapper(content) {
	return content.includes("updateIncludesAtomicSelf") || content.includes("re-applying Atomic Grok UI patch");
}

function detectRcFiles() {
	const candidates = [
		join(home, ".zshrc"),
		join(home, ".zprofile"),
		join(home, ".bashrc"),
		join(home, ".bash_profile"),
	];
	return candidates.filter((path) => existsSync(path));
}

function rcHasPath(path) {
	const text = readFileSync(path, "utf8");
	return text.includes("/.atomic/bin") && text.includes("PATH");
}

function ensurePathInRc() {
	const rcs = detectRcFiles();
	const target = rcs.find((path) => path.endsWith(".zshrc")) ?? rcs[0] ?? join(home, ".zshrc");
	if (existsSync(target) && rcHasPath(target)) {
		return { path: target, status: "present" };
	}
	mkdirSync(dirname(target), { recursive: true });
	const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
	const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
	writeFileSync(target, `${existing}${prefix}${pathExport}\n`);
	return { path: target, status: "added" };
}

function removePathFromRc() {
	for (const path of detectRcFiles()) {
		if (!rcHasPath(path)) continue;
		const lines = readFileSync(path, "utf8").split("\n");
		const next = lines.filter(
			(line) =>
				!(line.includes("/.atomic/bin") && line.includes("PATH") && line.includes("pi-grok-style-tools")),
		);
		writeFileSync(path, next.join("\n"));
	}
}

function installWrapper() {
	mkdirSync(binDir, { recursive: true });
	if (existsSync(wrapperTarget)) {
		const current = readFileSync(wrapperTarget, "utf8");
		if (!isOurWrapper(current)) {
			throw new Error(`Refusing to replace unmanaged binary: ${wrapperTarget}`);
		}
		unlinkSync(wrapperTarget);
	}
	// Copy (not symlink) so the wrapper keeps working if the repo moves temporarily;
	// re-run install/patch after relocating the package.
	copyFileSync(wrapperSource, wrapperTarget);
	chmodSync(wrapperTarget, 0o755);
	const rc = ensurePathInRc();
	console.log(`Grok atomic wrapper installed: ${wrapperTarget}`);
	console.log(`Shell PATH (${rc.status}): ${rc.path}`);
	console.log("Open a new shell (or `source` that rc) so `which atomic` resolves to ~/.atomic/bin/atomic");
}

function uninstallWrapper() {
	if (existsSync(wrapperTarget)) {
		const current = readFileSync(wrapperTarget, "utf8");
		if (!isOurWrapper(current)) {
			throw new Error(`Refusing to remove unmanaged binary: ${wrapperTarget}`);
		}
		unlinkSync(wrapperTarget);
	}
	removePathFromRc();
	console.log(`Grok atomic wrapper removed from ${binDir}`);
}

function checkWrapper() {
	if (!existsSync(wrapperTarget)) {
		throw new Error(`Grok atomic wrapper not installed (${wrapperTarget})`);
	}
	const current = readFileSync(wrapperTarget, "utf8");
	if (!isOurWrapper(current)) {
		throw new Error(`Unmanaged binary at ${wrapperTarget}`);
	}
	const rcs = detectRcFiles().filter(rcHasPath);
	if (rcs.length === 0) {
		throw new Error(`~/.atomic/bin is not on PATH in shell rc`);
	}
	console.log(`Grok atomic wrapper: active (${wrapperTarget})`);
	console.log(`PATH configured in: ${rcs.join(", ")}`);
}

if (action === "install") installWrapper();
else if (action === "uninstall") uninstallWrapper();
else checkWrapper();
