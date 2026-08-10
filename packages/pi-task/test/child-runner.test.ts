import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SettingsManager, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import {
	ADVISOR_PACKAGE_SOURCE,
	buildAppendSystemPrompts,
	clampRequestMaxTokens,
	createTaskResourceLoader,
	deriveChildTools,
	runChild,
	usageDeltaFromMessage,
} from "../src/child-runner.ts";

function makeEmptyResourceLoader(onReload: () => void = () => {}): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: {} as never }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => onReload(),
	};
}

function createLoaderFixture(): {
	root: string;
	cwd: string;
	agentDir: string;
	extensionPath: string;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-advisor-loader-"));
	const cwd = path.join(root, "work");
	const agentDir = path.join(root, "agent");
	const extensionPath = path.join(root, "advisor.mjs");
	fs.mkdirSync(cwd, { recursive: true });
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(extensionPath, "export default function () {}\n");
	return { root, cwd, agentDir, extensionPath };
}

function extensionPackageManager(extensionPath: string) {
	return {
		resolveExtensionSources: async () => ({
			extensions: [{ path: extensionPath, enabled: true, metadata: {} as never }],
			skills: [],
			prompts: [],
			themes: [],
		}),
	};
}

describe("child-runner", () => {
	it("honors an already-aborted signal without hanging", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await runChild({
			cwd: process.cwd(),
			sessionPath: null,
			model: undefined,
			tools: [],
			systemPrompt: null,
			task: "probe",
			signal: controller.signal,
			timeoutMs: 0,
			noSession: true,
			noExtensions: true,
			noSkills: true,
		});

		assert.equal(result.interrupted, true);
		assert.equal(result.timedOut, false);
		assert.equal(result.exitCode, 1);
	});

	it("prompt composition ignores thinking/budget options (bytes stay stable)", () => {
		const base = buildAppendSystemPrompts("Agent body");
		// Thinking/budgets are session options — must not alter append prompts.
		assert.deepEqual(buildAppendSystemPrompts("Agent body"), base);
		assert.equal(base[1], "Agent body");
	});


	describe("usageDeltaFromMessage", () => {
		it("maps per-message usage into an explicit delta", () => {
			const d = usageDeltaFromMessage({
				input: 100,
				output: 20,
				cacheRead: 5,
				cacheWrite: 1,
				cost: { total: 0.01 },
			});
			assert.deepEqual(d, { input: 100, output: 20, cacheRead: 5, cacheWrite: 1, cost: 0.01 });
		});

		it("missing fields contribute zero", () => {
			assert.deepEqual(usageDeltaFromMessage({}), {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
			});
			assert.deepEqual(usageDeltaFromMessage(undefined), {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
			});
		});

		it("two-turn deltas sum exactly once when applied as deltas", () => {
			const a = usageDeltaFromMessage({ input: 100, output: 20, cost: { total: 0.01 } });
			const b = usageDeltaFromMessage({ input: 80, output: 12, cost: { total: 0.02 } });
			const total = {
				input: a.input + b.input,
				output: a.output + b.output,
				cost: a.cost + b.cost,
			};
			assert.deepEqual(total, { input: 180, output: 32, cost: 0.03 });
		});
	});

	describe("buildAppendSystemPrompts", () => {
		it("preserves LeanCTX-only prompt bytes when no agent body", () => {
			const prompts = buildAppendSystemPrompts(null);
			assert.equal(prompts.length, 1);
			assert.match(prompts[0]!, /<!-- lean-ctx -->/);
			assert.match(prompts[0]!, /<!-- \/lean-ctx -->/);
			// Exact snapshot for later loader replacement
			assert.equal(
				prompts[0],
				`<!-- lean-ctx -->
You are running inside a LeanCTX-equipped environment. Prefer the \`lean-ctx\` CLI (compressed, session-cached) over native \`read\`/\`bash\`/\`grep\`/\`find\`/\`ls\`. Note: \`ctx_*\` MCP tools are NOT loaded in this child (\`--no-extensions\` is set), so reach lean-ctx via the CLI binary. See \`LEAN-CTX.md\` (open on demand) or run \`lean-ctx cheatsheet\` for the full mapping.
<!-- /lean-ctx -->
`,
			);
		});

		it("keeps LeanCTX preamble then unchanged agent body", () => {
			const body = "You are a locator agent.\nFind files.";
			const prompts = buildAppendSystemPrompts(body);
			assert.equal(prompts.length, 2);
			assert.equal(prompts[1], body);
			assert.equal(prompts[0], buildAppendSystemPrompts(null)[0]);
		});

		it("trims whitespace-only agent bodies to LeanCTX-only", () => {
			assert.deepEqual(buildAppendSystemPrompts("   \n"), buildAppendSystemPrompts(null));
		});
	});


	describe("createTaskResourceLoader", () => {
		it("returns empty collections and exact append prompts without discovery", async () => {
			const body = "Agent body bytes";
			let resolved = false;
			const loader = await createTaskResourceLoader({
				cwd: "/tmp",
				agentDir: "/tmp/.pi",
				settingsManager: {} as never,
				systemPrompt: body,
				packageManager: {
					resolveExtensionSources: async () => {
						resolved = true;
						throw new Error("default isolation must not resolve packages");
					},
				},
				createDefaultResourceLoaderFn: () => {
					throw new Error("default isolation must not create the discovery loader");
				},
			});
			await loader.reload();
			assert.equal(resolved, false);
			assert.deepEqual(loader.getSkills().skills, []);
			assert.deepEqual(loader.getPrompts().prompts, []);
			assert.deepEqual(loader.getThemes().themes, []);
			assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
			assert.equal(loader.getSystemPrompt(), undefined);
			assert.equal(loader.getSystemPromptSource(), undefined);
			assert.deepEqual(loader.getAppendSystemPrompt(), buildAppendSystemPrompts(body));
			assert.deepEqual(loader.getAppendSystemPromptSources(), []);
			const ext = loader.getExtensions();
			assert.equal(ext.extensions.length, 0);
			assert.ok(ext.runtime);
		});

		it("allocates a distinct extension runtime per isolated loader", async () => {
			const options = {
				cwd: "/tmp",
				agentDir: "/tmp/.pi",
				settingsManager: {} as never,
				systemPrompt: null,
			};
			const a = (await createTaskResourceLoader(options)).getExtensions().runtime;
			const b = (await createTaskResourceLoader(options)).getExtensions().runtime;
			assert.notEqual(a, b);
		});

		it("resolves and reloads only the allowlisted Advisor extension", async () => {
			let receivedSources: string[] = [];
			let capturedOptions: Record<string, unknown> | undefined;
			let reloads = 0;
			const expectedLoader = makeEmptyResourceLoader(() => reloads++);
			const loader = await createTaskResourceLoader({
				cwd: "/work",
				agentDir: "/agent",
				settingsManager: {} as never,
				systemPrompt: "Agent body",
				childExtensions: ["advisor", "advisor"],
				packageManager: {
					resolveExtensionSources: async (sources) => {
						receivedSources = [...sources];
						return {
							extensions: [
								{ path: "/advisor/index.ts", enabled: true, metadata: {} as never },
								{ path: "/pi-workflows/index.ts", enabled: false, metadata: {} as never },
							],
							skills: [],
							prompts: [],
							themes: [],
						};
					},
				},
				createDefaultResourceLoaderFn: (options) => {
					capturedOptions = options as unknown as Record<string, unknown>;
					return expectedLoader;
				},
			});

			assert.equal(loader, expectedLoader);
			assert.deepEqual(receivedSources, [ADVISOR_PACKAGE_SOURCE]);
			assert.equal(reloads, 1);
			assert.deepEqual(capturedOptions?.additionalExtensionPaths, ["/advisor/index.ts"]);
			assert.equal(capturedOptions?.noExtensions, true);
			assert.equal(capturedOptions?.noSkills, true);
			assert.equal(capturedOptions?.noPromptTemplates, true);
			assert.equal(capturedOptions?.noThemes, true);
			assert.equal(capturedOptions?.noContextFiles, true);
			assert.deepEqual((capturedOptions?.settingsManager as SettingsManager).getPackages(), []);
			assert.equal(capturedOptions?.systemPrompt, "");
			assert.deepEqual(capturedOptions?.appendSystemPrompt, []);
			const override = capturedOptions?.appendSystemPromptOverride as (base: string[]) => string[];
			assert.deepEqual(override(["unrelated base"]), buildAppendSystemPrompts("Agent body"));
		});

		it("blocks discovered prompts and preserves literal append prompt bytes", async () => {
			const fixture = createLoaderFixture();
			try {
				fs.writeFileSync(path.join(fixture.agentDir, "SYSTEM.md"), "UNRELATED GLOBAL SYSTEM\n");
				fs.writeFileSync(path.join(fixture.cwd, "README.md"), "UNRELATED REPOSITORY README\n");
				const loader = await createTaskResourceLoader({
					cwd: fixture.cwd,
					agentDir: fixture.agentDir,
					settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }),
					systemPrompt: "README.md",
					childExtensions: ["advisor"],
					packageManager: extensionPackageManager(fixture.extensionPath),
				});

				assert.equal(loader.getSystemPrompt(), undefined);
				assert.equal(loader.getSystemPromptSource(), undefined);
				assert.deepEqual(loader.getAppendSystemPrompt(), buildAppendSystemPrompts("README.md"));
				assert.deepEqual(loader.getAppendSystemPromptSources(), []);
				assert.deepEqual(loader.getSkills().skills, []);
				assert.deepEqual(loader.getPrompts().prompts, []);
				assert.deepEqual(loader.getThemes().themes, []);
				assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
				assert.equal(loader.getExtensions().extensions.length, 1);
				assert.deepEqual(loader.getExtensions().errors, []);
			} finally {
				fs.rmSync(fixture.root, { recursive: true, force: true });
			}
		});

		it("does not resolve unrelated packages from the session settings", async () => {
			const fixture = createLoaderFixture();
			const npmLog = path.join(fixture.root, "npm.log");
			const fakeNpm = path.join(fixture.root, "fake-npm");
			try {
				fs.writeFileSync(
					fakeNpm,
					`#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(npmLog)}\nexit 0\n`,
					{ mode: 0o755 },
				);
				const sessionSettings = SettingsManager.inMemory(
					{
						packages: ["npm:@review/missing-package"],
						npmCommand: [fakeNpm],
					},
					{ projectTrusted: false },
				);
				const loader = await createTaskResourceLoader({
					cwd: fixture.cwd,
					agentDir: fixture.agentDir,
					settingsManager: sessionSettings,
					systemPrompt: null,
					childExtensions: ["advisor"],
					packageManager: extensionPackageManager(fixture.extensionPath),
				});

				assert.equal(loader.getExtensions().extensions.length, 1);
				assert.equal(fs.existsSync(npmLog) ? fs.readFileSync(npmLog, "utf8") : "", "");
			} finally {
				fs.rmSync(fixture.root, { recursive: true, force: true });
			}
		});
		it("rejects Advisor extension load errors instead of silently omitting the tool", async () => {
			const fixture = createLoaderFixture();
			try {
				fs.writeFileSync(fixture.extensionPath, 'throw new Error("broken advisor load");\n');
				await assert.rejects(
					createTaskResourceLoader({
						cwd: fixture.cwd,
						agentDir: fixture.agentDir,
						settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }),
						systemPrompt: null,
						childExtensions: ["advisor"],
						packageManager: extensionPackageManager(fixture.extensionPath),
					}),
					/Failed to load Advisor extension:.*broken advisor load/,
				);
			} finally {
				fs.rmSync(fixture.root, { recursive: true, force: true });
			}
		});

		it("denies non-allowlisted child extension names even if the type boundary is bypassed", async () => {
			let resolved = false;
			const loader = await createTaskResourceLoader({
				cwd: "/tmp",
				agentDir: "/tmp/.pi",
				settingsManager: {} as never,
				systemPrompt: null,
				childExtensions: ["pi-workflows"] as never,
				packageManager: {
					resolveExtensionSources: async () => {
						resolved = true;
						throw new Error("denied capabilities must not resolve packages");
					},
				},
			});
			assert.equal(resolved, false);
			assert.deepEqual(loader.getExtensions().extensions, []);
		});

		it("fails when the installed Advisor package has no enabled extension entry", async () => {
			await assert.rejects(
				createTaskResourceLoader({
					cwd: "/tmp",
					agentDir: "/tmp/.pi",
					settingsManager: {} as never,
					systemPrompt: null,
					childExtensions: ["advisor"],
					packageManager: {
						resolveExtensionSources: async () => ({
							extensions: [],
							skills: [],
							prompts: [],
							themes: [],
						}),
					},
				}),
				/Advisor package did not expose an enabled Pi extension/,
			);
		});
	});


	it("reloads Advisor before binding and disposes the child once", async () => {
		let reloads = 0;
		let binds = 0;
		let unsubscribes = 0;
		let disposes = 0;
		let signalAdds = 0;
		let signalRemoves = 0;
		const loader = makeEmptyResourceLoader(() => reloads++);
		const session = {
			messages: [] as any[],
			bindExtensions: async () => { binds++; },
			subscribe: () => () => { unsubscribes++; },
			prompt: async () => {
				session.messages.push({
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					stopReason: "stop",
				});
			},
			abort: () => {},
			dispose: () => { disposes++; },
		};
		const signal = {
			aborted: false,
			addEventListener: () => { signalAdds++; },
			removeEventListener: () => { signalRemoves++; },
		} as unknown as AbortSignal;

		const result = await runChild({
			cwd: "/tmp",
			sessionPath: null,
			tools: ["read", "advisor"],
			systemPrompt: null,
			task: "probe",
			signal,
			timeoutMs: 0,
			noSession: true,
			childExtensions: ["advisor"],
			createTaskResourceLoaderFn: (options) => createTaskResourceLoader({
				...options,
				packageManager: {
					resolveExtensionSources: async () => ({
						extensions: [{ path: "/advisor/index.ts", enabled: true, metadata: {} as never }],
						skills: [],
						prompts: [],
						themes: [],
					}),
				},
				createDefaultResourceLoaderFn: () => loader,
			}),
			createAgentSessionFn: (async (options: any) => {
				assert.equal(reloads, 1);
				assert.equal(options.resourceLoader, loader);
				assert.deepEqual(options.tools, ["read", "advisor"]);
				return { session };
			}) as never,
		});

		assert.equal(result.output, "done");
		assert.equal(binds, 1);
		assert.equal(unsubscribes, 1);
		assert.equal(disposes, 1);
		assert.equal(signalAdds, 1);
		assert.ok(signalRemoves >= 1);
	});

	it("disposes the child session when extension binding fails", async () => {
		let disposes = 0;
		const session = {
			bindExtensions: async () => {
				throw new Error("session_start failed");
			},
			dispose: () => { disposes++; },
		};

		await assert.rejects(
			runChild({
				cwd: "/tmp",
				sessionPath: null,
				tools: ["advisor"],
				systemPrompt: null,
				task: "probe",
				signal: null,
				noSession: true,
				childExtensions: ["advisor"],
				createTaskResourceLoaderFn: async () => makeEmptyResourceLoader(),
				createAgentSessionFn: (async () => ({ session })) as never,
			}),
			/session_start failed/,
		);
		assert.equal(disposes, 1);
	});

	it("propagates session creation failures without session cleanup", async () => {
		let createAttempts = 0;
		await assert.rejects(
			runChild({
				cwd: "/tmp",
				sessionPath: null,
				tools: ["advisor"],
				systemPrompt: null,
				task: "probe",
				signal: null,
				noSession: true,
				childExtensions: ["advisor"],
				createTaskResourceLoaderFn: async () => makeEmptyResourceLoader(),
				createAgentSessionFn: (async () => {
					createAttempts++;
					throw new Error("session creation failed");
				}) as never,
			}),
			/session creation failed/,
		);
		assert.equal(createAttempts, 1);
	});

	describe("clampRequestMaxTokens", () => {
		it("clamps to model maximum", () => {
			assert.equal(
				clampRequestMaxTokens({
					existing: 100000,
					modelMax: 4096,
					perRequestCap: 16384,
					remaining: 32768,
					totalBudgetEnabled: true,
				}),
				4096,
			);
		});

		it("preserves a lower existing request cap", () => {
			assert.equal(
				clampRequestMaxTokens({
					existing: 100,
					modelMax: 4096,
					perRequestCap: 16384,
					remaining: 32768,
					totalBudgetEnabled: true,
				}),
				100,
			);
		});

		it("clamps to remaining total budget", () => {
			assert.equal(
				clampRequestMaxTokens({
					existing: undefined,
					modelMax: 100000,
					perRequestCap: 16384,
					remaining: 50,
					totalBudgetEnabled: true,
				}),
				50,
			);
		});

		it("ignores total budget when disabled (zero)", () => {
			assert.equal(
				clampRequestMaxTokens({
					existing: undefined,
					modelMax: 100000,
					perRequestCap: 16384,
					remaining: 0,
					totalBudgetEnabled: false,
				}),
				16384,
			);
		});
	});

	describe("deriveChildTools", () => {
		it("denies task tool by default", () => {
			const tools = deriveChildTools(["read", "grep", "task", "write"], false);
			assert.ok(tools);
			assert.ok(!tools!.includes("task"));
			assert.ok(tools!.includes("read"));
			assert.ok(tools!.includes("grep"));
			assert.ok(tools!.includes("write"));
		});

		it("denies subagent tool by default", () => {
			const tools = deriveChildTools(["read", "subagent", "grep"], false);
			assert.ok(tools);
			assert.ok(!tools!.includes("subagent"));
			assert.ok(tools!.includes("read"));
		});

		it("allows task tool when allowRecursion is true", () => {
			const tools = deriveChildTools(["read", "task", "grep"], true);
			assert.ok(tools);
			assert.ok(tools!.includes("task"));
		});

		it("denies todowrite by default", () => {
			const tools = deriveChildTools(["read", "todowrite", "grep"], false);
			assert.ok(tools);
			assert.ok(!tools!.includes("todowrite"));
		});

		it("returns undefined for empty tools", () => {
			assert.equal(deriveChildTools([], false), undefined);
		});

		it("returns undefined for undefined tools", () => {
			assert.equal(deriveChildTools(undefined, false), undefined);
		});

		it("preserves default tool order and appends Advisor only when enabled", () => {
			assert.deepEqual(deriveChildTools(["read", "write"], false), ["read", "write"]);
			assert.deepEqual(
				deriveChildTools(["read", "write"], false, ["advisor"]),
				["read", "write", "advisor"],
			);
			assert.deepEqual(
				deriveChildTools(["read", "advisor"], false, ["advisor", "advisor"]),
				["read", "advisor"],
			);
			assert.equal(deriveChildTools(undefined, false, ["advisor"]), undefined);
		});

		it("removes task, subagent, and todowrite together", () => {
			const tools = deriveChildTools(["task", "subagent", "todowrite", "read"], false);
			assert.ok(tools);
			assert.equal(tools!.length, 1);
			assert.equal(tools![0], "read");
		});
	});
});
