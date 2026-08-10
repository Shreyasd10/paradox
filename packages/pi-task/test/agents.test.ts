import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverAgents } from "../src/agents.ts";

let tmpHome = "";
const originalHome = process.env.HOME;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-task-agents-"));
	process.env.HOME = tmpHome;
});

afterEach(() => {
	process.env.HOME = originalHome;
	try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

function writeAgent(dir: string, name: string, description: string, tools?: string, model?: string): void {
	fs.mkdirSync(dir, { recursive: true });
	const frontmatter: string[] = ["---", `name: ${name}`, `description: ${description}`];
	if (tools) frontmatter.push(`tools: ${tools}`);
	if (model) frontmatter.push(`model: ${model}`);
	frontmatter.push("---", "");
	frontmatter.push(`System prompt for ${name}.`);
	fs.writeFileSync(path.join(dir, `${name}.md`), frontmatter.join("\n"));
}

describe("agents", () => {
	describe("discoverAgents — user scope (default)", () => {
		it("discovers user agents from ~/.pi/agent/agents", () => {
			const userDir = path.join(tmpHome, ".pi", "agent", "agents");
			writeAgent(userDir, "scout", "Fast recon");
			writeAgent(userDir, "worker", "General purpose");

			const result = discoverAgents("/tmp", "user");
			assert.equal(result.agents.length, 2);
			const names = result.agents.map((a) => a.name).sort();
			assert.deepEqual(names, ["scout", "worker"]);
			assert.equal(result.agents[0].source, "user");
		});

		it("returns empty when no agents exist", () => {
			const result = discoverAgents("/tmp", "user");
			assert.equal(result.agents.length, 0);
		});

		it("skips agents without required frontmatter", () => {
			const userDir = path.join(tmpHome, ".pi", "agent", "agents");
			fs.mkdirSync(userDir, { recursive: true });
			fs.writeFileSync(path.join(userDir, "incomplete.md"), "---\nname: incomplete\n---\nNo description");

			const result = discoverAgents("/tmp", "user");
			assert.equal(result.agents.length, 0);
		});
	});

	describe("discoverAgents — project scope", () => {
		it("discovers project agents when scope is project", () => {
			const projectDir = path.join("/tmp", "pi-test-project", ".pi", "agents");
			writeAgent(projectDir, "project-agent", "Project-specific");

			const result = discoverAgents("/tmp/pi-test-project", "project");
			assert.equal(result.agents.length, 1);
			assert.equal(result.agents[0].name, "project-agent");
			assert.equal(result.agents[0].source, "project");
		});

		it("does not discover project agents when scope is user", () => {
			const projectDir = path.join("/tmp", "pi-test-project2", ".pi", "agents");
			writeAgent(projectDir, "project-agent2", "Project-specific");

			const result = discoverAgents("/tmp/pi-test-project2", "user");
			assert.equal(result.agents.length, 0);
		});
	});

	describe("discoverAgents — both scope", () => {
		it("discovers both user and project agents, project overrides user", () => {
			const userDir = path.join(tmpHome, ".pi", "agent", "agents");
			writeAgent(userDir, "shared", "User version");

			const projectDir = path.join("/tmp", "pi-test-both", ".pi", "agents");
			writeAgent(projectDir, "shared", "Project version");
			writeAgent(projectDir, "extra", "Extra project agent");

			const result = discoverAgents("/tmp/pi-test-both", "both");
			// "shared" should be overridden by project version
			const shared = result.agents.find((a) => a.name === "shared");
			assert.ok(shared);
			assert.equal(shared.source, "project");
			assert.equal(shared.description, "Project version");

			const extra = result.agents.find((a) => a.name === "extra");
			assert.ok(extra);
			assert.equal(extra.source, "project");
		});
	});

	describe("agent tools and model parsing", () => {
		it("parses tools and model from frontmatter", () => {
			const userDir = path.join(tmpHome, ".pi", "agent", "agents");
			writeAgent(userDir, "custom", "Custom agent", "read, grep, find", "claude-haiku-4-5");

			const result = discoverAgents("/tmp", "user");
			const agent = result.agents.find((a) => a.name === "custom");
			assert.ok(agent);
			assert.deepEqual(agent.tools, ["read", "grep", "find"]);
			assert.equal(agent.model, "claude-haiku-4-5");
		});
	});
});
