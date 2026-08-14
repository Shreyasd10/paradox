// Build the pi extension bundle. `@earendil-works/pi-tui` stays external so
// component identity matches the host, but pi's extension loader cannot
// resolve package subpaths (it joins the subpath onto the package main), so
// `@earendil-works/pi-tui/dist/layout.js` is bundled inline instead. The
// module is pure (layout geometry helpers) and only imports relative
// siblings plus node builtins, so bundling it duplicates no host state.
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const layoutPath = require.resolve("@earendil-works/pi-tui/dist/layout.js", {
	paths: ["./node_modules/@bastani/atomic"],
});

await build({
	entryPoints: ["src/extension/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: "src/extension/index.bundle.mjs",
	external: [
		"@bastani/atomic",
		"@earendil-works/pi-tui",
		"@earendil-works/pi-ai/compat",
		"typebox",
		"typebox/*",
	],
	plugins: [
		{
			name: "bundle-pi-tui-layout-subpath",
			setup(build) {
				build.onResolve({ filter: /^@earendil-works\/pi-tui\/dist\/layout\.js$/ }, () => ({
					path: layoutPath,
					external: false,
				}));
			},
		},
	],
});
