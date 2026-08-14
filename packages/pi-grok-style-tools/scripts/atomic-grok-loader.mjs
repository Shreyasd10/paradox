import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAtomicMainUrl, transformMainSource } from "./atomic-grok-transform.mjs";

export async function load(url, context, nextLoad) {
	const result = await nextLoad(url, context);
	if (!isAtomicMainUrl(url)) return result;

	let source = result.source;
	if (source == null) {
		source = readFileSync(fileURLToPath(url), "utf8");
	} else if (typeof source !== "string") {
		source = Buffer.from(source).toString("utf8");
	}

	const transformed = transformMainSource(source);
	return {
		format: result.format ?? context.format ?? "module",
		source: transformed.source,
		shortCircuit: true,
	};
}
