// Headless smoke test for the pi i-have-adhd extension: drives the factory
// with a fake API surface and asserts the opt-out toggle/stop/re-inject
// state machine (mirrors @bastani/i-have-adhd semantics).
import assert from "node:assert/strict";
import { default as iHaveAdhd } from "../index.ts";

const messages = [];
const entries = [];
const statuses = new Map();
const notifications = [];
const flags = { "no-adhd": false };
let seq = 0;

const makeEntry = (type, extra) => {
	const id = `e${++seq}`;
	const entry = { type, id, parentId: seq > 1 ? `e${seq - 1}` : null, timestamp: new Date(seq).toISOString(), ...extra };
	entries.push(entry);
	return entry;
};

const stateEntries = () => entries.filter((e) => e.type === "custom");

const sessionManager = {
	getBranch: () => stateEntries(),
	getEntries: () => entries,
	getLeafId: () => entries.at(-1)?.id ?? null,
};

const ctx = {
	hasUI: true,
	sessionManager,
	ui: {
		notify: (m, t) => notifications.push([m, t]),
		setStatus: (k, v) => statuses.set(k, v),
	},
};

const handlers = {};
const commands = {};
const api = {
	appendEntry: (customType, data) => makeEntry("custom", { customType, data }),
	getFlag: (name) => flags[name],
	registerCommand: (name, opts) => {
		commands[name] = opts.handler;
	},
	registerFlag: (name, opts) => {
		flags[name] = opts.default ?? false;
	},
	sendMessage: (msg, opts) => {
		messages.push({ msg, opts });
		// Custom messages become session entries, which the context-sync logic reads.
		makeEntry("custom_message", { customType: msg.customType, content: msg.content });
	},
	on: (event, handler) => {
		handlers[event] = handler;
	},
};

iHaveAdhd(api);

const toggle = (args) => commands["i-have-adhd"](args, ctx);

// Opt-out default: no saved state + no flag → enabled, rules injected at start
await handlers.session_start({}, ctx);
assert.match(statuses.get("i-have-adhd"), /ADHD Mode/);
assert.equal(messages.at(-1).msg.customType, "i-have-adhd-rules");
assert.match(messages.at(-1).msg.content, /ADHD MODE ACTIVE/);

// /i-have-adhd → toggle off: entry + disabled notice + status cleared
await toggle("");
assert.equal(stateEntries().at(-1).data.enabled, false);
assert.equal(messages.at(-1).msg.customType, "i-have-adhd-disabled");
assert.equal(statuses.get("i-have-adhd"), undefined);
assert.deepEqual(notifications.at(-1), ["ADHD mode disabled", "info"]);

// /i-have-adhd on → enabled again
await toggle("on");
assert.equal(stateEntries().at(-1).data.enabled, true);
assert.match(statuses.get("i-have-adhd"), /ADHD Mode/);

// phrase stop disables
await handlers.input({ text: "stop adhd mode" }, ctx);
assert.equal(stateEntries().at(-1).data.enabled, false);
assert.equal(statuses.get("i-have-adhd"), undefined);

// compaction drops summarized entries; the rules marker falls out and must be re-injected
await toggle("on");
messages.length = 0;
const surviving = entries.filter((e) => e.type !== "custom_message");
entries.length = 0;
entries.push(...surviving);
await handlers.session_compact({}, ctx);
assert.equal(messages.at(-1)?.msg.customType, "i-have-adhd-rules");

// saved state restores on session start
await handlers.session_start({}, ctx);
assert.equal(stateEntries().at(-1).data.enabled, true);

// --no-adhd flag applies when there is no saved state (fresh session)
entries.length = 0;
seq = 0;
flags["no-adhd"] = true;
await handlers.session_tree({}, ctx);
assert.equal(statuses.get("i-have-adhd"), undefined);

// saved session state wins over the flag at startup
makeEntry("custom", { customType: "i-have-adhd-state", data: { enabled: true } });
await handlers.session_start({}, ctx);
assert.match(statuses.get("i-have-adhd"), /ADHD Mode/);

console.log("adhd extension: all assertions passed");
