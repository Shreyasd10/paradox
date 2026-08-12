import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type AssetLockEntry = {
	path: string;
	bytes: number;
	sha256: string;
};

type AssetLock = {
	schema_version: number;
	upstream: { repository: string; commit: string };
	assets: AssetLockEntry[];
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const sourceWorkflowRoot = resolve(moduleDir, "..");
const bundledWorkflowRoot = resolve(moduleDir, "../..", "workflows");

export const workflowRoot = existsSync(resolve(sourceWorkflowRoot, "assets", "asset-lock.json"))
	? sourceWorkflowRoot
	: bundledWorkflowRoot;
export const assetRoot = resolve(workflowRoot, "assets");
export const templateRoot = resolve(assetRoot, "templates");
export const agentRoot = resolve(assetRoot, "agents");

let cachedLock: AssetLock | undefined;

function assetLock(): AssetLock {
	if (cachedLock !== undefined) return cachedLock;
	const parsed = JSON.parse(readFileSync(resolve(assetRoot, "asset-lock.json"), "utf8")) as AssetLock;
	if (parsed.schema_version !== 1 || !Array.isArray(parsed.assets)) {
		throw new Error("Unsupported workflow asset lock schema");
	}
	cachedLock = parsed;
	return parsed;
}

export function lockedAsset(relativePath: string): Buffer {
	const entry = assetLock().assets.find((candidate) => candidate.path === relativePath);
	if (entry === undefined) throw new Error(`Workflow asset is not locked: ${relativePath}`);
	const bytes = readFileSync(resolve(assetRoot, relativePath));
	const digest = createHash("sha256").update(bytes).digest("hex");
	if (bytes.byteLength !== entry.bytes || digest !== entry.sha256) {
		throw new Error(`Workflow asset failed integrity validation: ${relativePath}`);
	}
	return bytes;
}

export function verbatimSkill(name: string): string {
	return lockedAsset(`skills/${name}/SKILL.md`).toString("utf8");
}

export function lockedAssetEntries(): readonly AssetLockEntry[] {
	return assetLock().assets;
}

export function assertAllWorkflowAssets(): void {
	for (const entry of assetLock().assets) lockedAsset(entry.path);
}

export function assetLockSha256(): string {
	return createHash("sha256").update(readFileSync(resolve(assetRoot, "asset-lock.json"))).digest("hex");
}
