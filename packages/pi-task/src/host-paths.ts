import { homedir } from "node:os";
import * as path from "node:path";

export const HOST_CONFIG_DIR_NAME = ".pi";

function expandTilde(value: string, home: string): string {
	if (value === "~") return home;
	if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
	return value;
}

export function resolveHostAgentDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	const override = env.PI_CODING_AGENT_DIR || env.ATOMIC_CODING_AGENT_DIR;
	return override ? expandTilde(override, home) : path.join(home, HOST_CONFIG_DIR_NAME, "agent");
}
