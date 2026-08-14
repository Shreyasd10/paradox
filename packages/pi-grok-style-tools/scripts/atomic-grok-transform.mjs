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

const PAGE_MARKER = 'const page = bgHex(t, "customMessageBg") ?? bgHex(t, "toolPendingBg")';
const BOUND_MARKER = "tryPiAccessor(theme, theme.getFgAnsi";
const PANEL_RE =
	/(\n[ \t]*)backgroundPanel:\s*bgHex\(t,\s*"toolPendingBg"\)\s*\?\?\s*bgHex\(t,\s*"customMessageBg"\),\s*backgroundElement:\s*bgHex\(t,\s*"customMessageBg"\)\s*\?\?\s*bgHex\(t,\s*"toolPendingBg"\),/;

export function isAtomicWorkflowsGraphUrl(url) {
	try {
		const path = decodeURIComponent(new URL(url).pathname);
		if (!path.includes("/@bastani/atomic/")) return false;
		return (
			path.endsWith("/builtin/workflows/src/extension/index.bundle.mjs") ||
			path.endsWith("/builtin/workflows/src/tui/graph-theme.ts") ||
			path.endsWith("/builtin/workflows/src/tui/graph-theme.js")
		);
	} catch {
		return false;
	}
}

function bindThemeAccessors(source) {
	if (source.includes(BOUND_MARKER)) return source;
	if (!/function tryPiAccessor\(fn/.test(source)) return source;
	let next = source.replace(/function tryPiAccessor\((fn[^,]*), color/, "function tryPiAccessor(theme, $1, color");
	next = next.replace(
		/(function tryPiAccessor\([\s\S]*?try\s*\{\s*)return fn\(color\);/,
		"$1return fn.call(theme, color);",
	);
	next = next.replaceAll("tryPiAccessor(theme.getFgAnsi, color)", "tryPiAccessor(theme, theme.getFgAnsi, color)");
	next = next.replaceAll("tryPiAccessor(theme.getBgAnsi, color)", "tryPiAccessor(theme, theme.getBgAnsi, color)");
	return next;
}

function unbindThemeAccessors(source) {
	if (!source.includes(BOUND_MARKER)) return source;
	let next = source.replaceAll("tryPiAccessor(theme, theme.getFgAnsi, color)", "tryPiAccessor(theme.getFgAnsi, color)");
	next = next.replaceAll("tryPiAccessor(theme, theme.getBgAnsi, color)", "tryPiAccessor(theme.getBgAnsi, color)");
	next = next.replace(/function tryPiAccessor\(theme, (fn[^,]*), color/, "function tryPiAccessor($1, color");
	next = next.replace(
		/(function tryPiAccessor\([\s\S]*?try\s*\{\s*)return fn\.call\(theme, color\);/,
		"$1return fn(color);",
	);
	return next;
}

function mapOscuraCanvas(source) {
	if (source.includes(PAGE_MARKER)) return source;
	const withDecls = source.replace(
		/const accent = fgHex\(t, "accent"\);(\s*)const overrides/,
		`const accent = fgHex(t, "accent");$1${PAGE_MARKER};$1const elevated = bgHex(t, "userMessageBg") ?? bgHex(t, "selectedBg") ?? page;$1const overrides`,
	);
	if (withDecls === source || !PANEL_RE.test(withDecls)) return source;
	return withDecls.replace(PANEL_RE, (_, ws) => {
		const indent = ws.match(/[ \t]+$/)?.[0] ?? "    ";
		return `${ws}bg: page,\n${indent}surface: page,\n${indent}backgroundPanel: elevated,\n${indent}backgroundElement: elevated ?? page,`;
	});
}

function unmapOscuraCanvas(source) {
	if (!source.includes(PAGE_MARKER)) return source;
	let next = source.replace(
		/const accent = fgHex\(t, "accent"\);(\s*)const page = bgHex\(t, "customMessageBg"\) \?\? bgHex\(t, "toolPendingBg"\);\1const elevated = bgHex\(t, "userMessageBg"\) \?\? bgHex\(t, "selectedBg"\) \?\? page;\1const overrides/,
		'const accent = fgHex(t, "accent");$1const overrides',
	);
	next = next.replace(
		/(\n[ \t]*)bg: page,\s*surface: page,\s*backgroundPanel: elevated,\s*backgroundElement: elevated \?\? page,/,
		(_, ws) => {
			const indent = ws.match(/[ \t]+$/)?.[0] ?? "    ";
			return `${ws}backgroundPanel: bgHex(t, "toolPendingBg") ?? bgHex(t, "customMessageBg"),\n${indent}backgroundElement: bgHex(t, "customMessageBg") ?? bgHex(t, "toolPendingBg"),`;
		},
	);
	return next;
}

/**
 * Map Atomic's builtin workflow graph canvas onto the live host theme.
 * Stock Atomic leaves `bg` on Catppuccin Mocha `#1e1e2e`; Pi's pi-workflows
 * fork uses Oscura `customMessageBg` instead.
 *
 * @param {string} source
 * @returns {{ source: string; status: "patched" | "original" | "unknown" }}
 */
export function transformGraphThemeSource(source) {
	if (!source.includes("function deriveGraphThemeFromPiTheme")) return { source, status: "unknown" };
	if (source.includes(PAGE_MARKER) && source.includes(BOUND_MARKER)) return { source, status: "patched" };
	const next = mapOscuraCanvas(bindThemeAccessors(source));
	if (!next.includes(PAGE_MARKER) || !next.includes(BOUND_MARKER)) return { source, status: "unknown" };
	return { source: next, status: "original" };
}

/**
 * @param {string} source
 * @returns {{ source: string; status: "patched" | "original" | "unknown" }}
 */
export function revertGraphThemeSource(source) {
	if (!source.includes("function deriveGraphThemeFromPiTheme")) return { source, status: "unknown" };
	if (!source.includes(PAGE_MARKER) && !source.includes(BOUND_MARKER)) {
		return { source, status: PANEL_RE.test(source) ? "original" : "unknown" };
	}
	const next = unbindThemeAccessors(unmapOscuraCanvas(source));
	if (next.includes(PAGE_MARKER) || next.includes(BOUND_MARKER)) return { source, status: "unknown" };
	return { source: next, status: "patched" };
}
