/**
 * Shared Grok/Atomic isolation transforms.
 * Used by the on-disk patcher and the runtime module loader so `atomic update`
 * does not require exact dist snippets from a specific Atomic version.
 */

export const DISABLE_FLAG = "ATOMIC_DISABLE_INTERACTIVE_ENGINE_ISOLATION";
export const DISABLE_CHECK = `process.env.${DISABLE_FLAG} !== "1"`;
export const DISABLE_DEFAULT = `process.env.${DISABLE_FLAG} ??= "1";`;

const ISOLATE_RE = /const isolateInteractiveHost = [^;]+;/;
const CODING_AGENT_LINE = 'process.env[`${APP_NAME.toUpperCase()}_CODING_AGENT`] = "true";';
const DISABLE_SUFFIX = ` && ${DISABLE_CHECK}`;

/**
 * @param {string} source
 * @returns {{ source: string; status: "patched" | "original" | "unknown" }}
 */
export function transformMainSource(source) {
	const match = source.match(ISOLATE_RE);
	if (!match) return { source, status: "unknown" };
	if (match[0].includes(DISABLE_FLAG)) return { source, status: "patched" };
	const patched = match[0].replace(/;$/, `${DISABLE_SUFFIX};`);
	return { source: source.replace(match[0], patched), status: "original" };
}

/**
 * @param {string} source
 * @returns {{ source: string; status: "patched" | "original" | "unknown" }}
 */
export function revertMainSource(source) {
	const match = source.match(ISOLATE_RE);
	if (!match) return { source, status: "unknown" };
	if (!match[0].includes(DISABLE_FLAG)) return { source, status: "original" };
	if (!match[0].includes(DISABLE_SUFFIX)) return { source, status: "unknown" };
	const original = match[0].replace(DISABLE_SUFFIX, "");
	return { source: source.replace(match[0], original), status: "patched" };
}

/**
 * @param {string} source
 * @returns {{ source: string; status: "patched" | "original" | "unknown" }}
 */
export function transformCliSource(source) {
	if (source.includes(DISABLE_DEFAULT)) return { source, status: "patched" };
	if (!source.includes(CODING_AGENT_LINE)) return { source, status: "unknown" };
	return {
		source: source.replace(CODING_AGENT_LINE, `${CODING_AGENT_LINE}\n${DISABLE_DEFAULT}`),
		status: "original",
	};
}

/**
 * @param {string} source
 * @returns {{ source: string; status: "patched" | "original" | "unknown" }}
 */
export function revertCliSource(source) {
	if (!source.includes(DISABLE_DEFAULT)) return { source, status: "original" };
	const next = source.replace(`\n${DISABLE_DEFAULT}`, "");
	if (next === source) return { source, status: "unknown" };
	return { source: next, status: "patched" };
}

export function isAtomicMainUrl(url) {
	try {
		const path = decodeURIComponent(new URL(url).pathname);
		return path.endsWith("/dist/main.js") && path.includes("/@bastani/atomic/");
	} catch {
		return false;
	}
}
