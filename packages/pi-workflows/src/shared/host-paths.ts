/**
 * Stock-pi host filesystem roots for `@shreyasdevadiga/pi-workflows`.
 *
 * `@bastani/atomic`'s `CONFIG_DIR_NAME` / `getAgentDir()` always resolve to
 * `.atomic` because the published package pins `atomicConfig.configDir`. This
 * module is the single source of truth so pi-workflows writes and reads under
 * `.pi` instead — independent of any sibling `.atomic` tree.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { getEnvValue } from "@bastani/atomic";

/** Project / user config directory name used by this extension under stock pi. */
export const HOST_CONFIG_DIR_NAME = ".pi";

/**
 * Discovery order for config trees. Writes always use `HOST_CONFIG_DIR_NAME`
 * alone; this list is intentionally `.pi`-only so the extension does not
 * inherit Atomic project state.
 */
export const HOST_CONFIG_DIR_NAMES = [HOST_CONFIG_DIR_NAME] as const;

/** Override the durable workflow-artifact root (also accepts Atomic's env name). */
export const ENV_WORKFLOW_ARTIFACT_DIR = "PI_WORKFLOW_ARTIFACT_DIR";
const LEGACY_ENV_WORKFLOW_ARTIFACT_DIR = "ATOMIC_WORKFLOW_ARTIFACT_DIR";

/** Override the agent config directory (also accepts Atomic's env name). */
export const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";
const LEGACY_ENV_AGENT_DIR = "ATOMIC_CODING_AGENT_DIR";

function expandTildePath(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}

function firstEnv(...names: readonly string[]): string | undefined {
	for (const name of names) {
		const value = getEnvValue(name) ?? process.env[name];
		if (value !== undefined && value.length > 0) return value;
	}
	return undefined;
}

/** `~/.pi/agent` (or `PI_CODING_AGENT_DIR` / `ATOMIC_CODING_AGENT_DIR` override). */
export function getHostAgentDir(): string {
	const override = firstEnv(ENV_AGENT_DIR, LEGACY_ENV_AGENT_DIR);
	if (override !== undefined) return expandTildePath(override);
	return join(homedir(), HOST_CONFIG_DIR_NAME, "agent");
}

/** Agent dirs in precedence order. Currently a single `.pi` root. */
export function getHostAgentDirs(): string[] {
	return [getHostAgentDir()];
}

/** Project config roots under `cwd` (`.pi` only). */
export function getHostProjectConfigDirs(cwd: string): string[] {
	return HOST_CONFIG_DIR_NAMES.map((name) => join(cwd, name));
}

/** Paths inside every project config root. */
export function getHostProjectConfigPaths(cwd: string, ...segments: string[]): string[] {
	return getHostProjectConfigDirs(cwd).map((dir) => join(dir, ...segments));
}

/** Durable workflow artifact root: env override, else `~/.pi/workflows`. */
export function getHostWorkflowArtifactRoot(): string {
	const override = firstEnv(ENV_WORKFLOW_ARTIFACT_DIR, LEGACY_ENV_WORKFLOW_ARTIFACT_DIR);
	if (override !== undefined) return expandTildePath(override);
	return join(homedir(), HOST_CONFIG_DIR_NAME, "workflows");
}

/** Project-local workflow artifact / status / worktree root: `<cwd>/.pi/...`. */
export function getHostProjectPath(cwd: string, ...segments: string[]): string {
	return join(cwd, HOST_CONFIG_DIR_NAME, ...segments);
}
