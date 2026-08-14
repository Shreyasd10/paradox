import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	isAtomicMainUrl,
	isAtomicWorkflowsGraphUrl,
	transformGraphThemeSource,
	transformMainSource,
} from "./atomic-grok-transform.mjs";

export async function load(url, context, nextLoad) {
	const result = await nextLoad(url, context);
	const transform = isAtomicMainUrl(url)
		? transformMainSource
		: isAtomicWorkflowsGraphUrl(url)
			? transformGraphThemeSource
			: null;
	if (!transform) return result;

	let source = result.source;
	if (source == null) {
		source = readFileSync(fileURLToPath(url), "utf8");
	} else if (typeof source !== "string") {
		source = Buffer.from(source).toString("utf8");
	}

	const transformed = transform(source);
	return {
		format: result.format ?? context.format ?? "module",
		source: transformed.source,
		shortCircuit: true,
	};
}
