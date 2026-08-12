import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import { it } from "node:test";
import { discoverAgents } from "../src/agents.ts";
import { TaskRuntime, type TaskRunConfig } from "../src/task-runtime.ts";
import { readRecord } from "../src/task-state.ts";
import { emptyUsage, type ChildRunOutput } from "../src/types.ts";

it("discovers a project agent from the requested task cwd before child startup", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-index-"));
	const home = path.join(root, "home");
	const artifactCwd = path.join(root, "artifact");
	const requestedCwd = path.join(root, "repository");
	const projectAgentsDir = path.join(requestedCwd, ".pi", "agents");
	const originalHome = process.env.HOME;
	const runtimePrototype = TaskRuntime.prototype as unknown as {
		invokeChild: (config: TaskRunConfig) => Promise<ChildRunOutput>;
	};
	const originalInvokeChild = runtimePrototype.invokeChild;
	let childStarts = 0;
	const childConfigs: TaskRunConfig[] = [];
	let shutdown: (() => void) | undefined;

	try {
		process.env.HOME = home;
		fs.mkdirSync(artifactCwd, { recursive: true });
		fs.mkdirSync(projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectAgentsDir, "stage-probe.md"),
			"---\nname: stage-probe\ndescription: Requested cwd probe\ntools: read\n---\nRun the requested cwd probe.\n",
		);

		assert.deepEqual(discoverAgents(artifactCwd, "project").agents, []);
		assert.deepEqual(
			discoverAgents(requestedCwd, "project").agents.map((agent) => agent.name),
			["stage-probe"],
		);

		runtimePrototype.invokeChild = async (config) => {
			childStarts++;
			childConfigs.push(config);
			return {
				exitCode: 0,
				output: "child-started",
				stderr: "",
				usage: emptyUsage(),
				model: null,
				interrupted: false,
				timedOut: false,
				truncated: false,
			};
		};

		const { default: registerPiTask } = await import("../src/index.ts");
		let taskTool: any;
		const handlers = new Map<string, (...args: any[]) => any>();
		registerPiTask({
			on: (event: string, handler: (...args: any[]) => any) => {
				handlers.set(event, handler);
			},
			registerMessageRenderer: () => {},
			registerCommand: () => {},
			registerTool: (tool: any) => {
				if (tool.name === "task") taskTool = tool;
			},
			getThinkingLevel: () => "off",
		} as any);
		shutdown = handlers.get("session_shutdown") as (() => void) | undefined;
		assert.ok(taskTool);

		const confirmations: Array<{ title: string; message: string }> = [];
		const ui = {
			confirm: async (title: string, message: string) => {
				confirmations.push({ title, message });
				return true;
			},
			setStatus: () => {},
			setWidget: () => {},
			onTerminalInput: () => () => {},
			getEditorText: () => "",
			notify: () => {},
		};
		const result = await taskTool.execute(
			"call-id",
			{
				agent: "stage-probe",
				task: "Start the child",
				cwd: requestedCwd,
				agent_scope: "project",
				child_extensions: ["advisor"],
			},
			new AbortController().signal,
			undefined,
			{
				cwd: artifactCwd,
				hasUI: true,
				ui,
				model: undefined,
				modelRegistry: { find: () => undefined },
				sessionManager: {
					getSessionFile: () => null,
					getSessionId: () => "parent-session",
				},
			},
		);

		assert.equal(childStarts, 1);
		assert.equal(result.content[0]?.text, "child-started");
		assert.equal(childConfigs[0]?.cwd, requestedCwd);
		assert.deepEqual(childConfigs[0]?.childExtensions, ["advisor"]);
		assert.deepEqual(childConfigs[0]?.tools, ["read", "advisor"]);
		assert.deepEqual(confirmations, [{
			title: "Run project-local agent?",
			message: `Agent: stage-probe\nSource: ${projectAgentsDir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
		}]);

		const record = readRecord(result.details.taskId);
		assert.ok(record);
		assert.equal(record.cwd, requestedCwd);
		assert.equal(record.agent, "stage-probe");
		assert.equal(record.agentSource, "project");
		assert.deepEqual(record.childExtensions, ["advisor"]);
		assert.equal(record.state, "completed");

		fs.mkdirSync(path.dirname(record.sessionPath!), { recursive: true });
		fs.writeFileSync(record.sessionPath!, "");
		await taskTool.execute(
			"resume-call-id",
			{
				agent: "stage-probe",
				task: "Synthesize the gathered evidence",
				task_id: record.id,
				cwd: requestedCwd,
				agent_scope: "project",
				max_turns: 7,
				max_output_tokens: 900,
				thinking: "low",
			},
			new AbortController().signal,
			undefined,
			{
				cwd: artifactCwd,
				hasUI: true,
				ui,
				model: undefined,
				modelRegistry: { find: () => undefined },
				sessionManager: {
					getSessionFile: () => null,
					getSessionId: () => "parent-session",
				},
			},
		);
		assert.equal(childStarts, 2);
		assert.equal(childConfigs[1]?.maxTurns, 7);
		assert.equal(childConfigs[1]?.maxOutputTokens, 900);
		assert.equal(childConfigs[1]?.thinkingOverride, "low");
	} finally {
		shutdown?.();
		runtimePrototype.invokeChild = originalInvokeChild;
		process.env.HOME = originalHome;
		fs.rmSync(root, { recursive: true, force: true });
	}
});
