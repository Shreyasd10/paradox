// Auto re-applies the pi host "Jump to bottom" patch after `pi update`
// replaces the host files. Idempotent: exits silently when the patch is
// already present. When the host file no longer matches the known anchors
// (a pi version bump that refactored the layout code), it notifies instead
// of clobbering. Intended to be run by the launchd guard
// (scripts/install-pi-host-patch-guard.sh).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const BACKUP_DIR = process.env.PI_PATCH_BACKUP_DIR ?? join(HOME, ".pi", "local", "pi-patch-backup");
const PI_PKG =
	process.env.PI_CODING_AGENT_DIR ??
	join(HOME, ".npm-global", "lib", "node_modules", "@earendil-works", "pi-coding-agent");
const MODE_JS = join(PI_PKG, "dist", "modes", "interactive", "interactive-mode.js");
const COMPONENT_DIR = join(PI_PKG, "dist", "modes", "interactive", "components");
const COMPONENT_JS = join(COMPONENT_DIR, "transcript-follow-indicator.js");
const COMPONENT_SRC = join(SCRIPT_DIR, "transcript-follow-indicator.js");
const LOG = join(BACKUP_DIR, "auto-apply.log");

function log(line) {
	const stamp = new Date().toISOString();
	appendFileSync(LOG, `${stamp} ${line}\n`);
}

function notify(title, message) {
	if (process.platform !== "darwin") return;
	try {
		execFileSync("osascript", ["-e", `display notification "${message}" with title "${title}"`]);
	} catch {
		// Notification is best-effort.
	}
}

if (!existsSync(MODE_JS)) {
	log("SKIP: pi package not found");
	process.exit(0);
}

const src = readFileSync(MODE_JS, "utf8");
if (src.includes("routeJumpToEnd")) {
	process.exit(0);
}

const edits = [
	{
		name: "import",
		marker: 'from "./components/transcript-follow-indicator.js";',
		old: 'import { formatKeyText, keyDisplayText, keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.js";',
		new: 'import { formatKeyText, keyDisplayText, keyHint, keyText, rawKeyHint } from "./components/keybinding-hints.js";\nimport { TranscriptFollowIndicator, TRANSCRIPT_JUMP_TO_END_URL } from "./components/transcript-follow-indicator.js";',
	},
	{
		name: "createInteractiveTui openUrl interception",
		marker: "options.onJumpToEnd?.(tui);",
		old: `export function createInteractiveTui(options) {
    const terminal = options.terminal ?? new ProcessTerminal();
    if (options.tuiMode === "fullscreen") {
        return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
            openUrl: openBrowser,
            onRightClickPaste: options.onRightClickPaste,
        });
    }
    return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}`,
		new: `export function createInteractiveTui(options) {
    const terminal = options.terminal ?? new ProcessTerminal();
    if (options.tuiMode === "fullscreen") {
        const tui = new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
            openUrl: openBrowser,
            onRightClickPaste: options.onRightClickPaste,
        });
        const hostOpenUrl = tui.openUrl ?? openBrowser;
        tui.openUrl = (url) => {
            if (url === TRANSCRIPT_JUMP_TO_END_URL) {
                options.onJumpToEnd?.(tui);
                return;
            }
            hostOpenUrl(url);
        };
        return tui;
    }
    return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}`,
	},
	{
		name: "indicator in init() dock",
		marker: "this.transcriptFollowIndicator = new TranscriptFollowIndicator({",
		old: `            scrollbarStyle: (text) => theme.bg("scrollbarThumb", text),
        });
        const dock = new TuiLayouts.VStack([
            { component: this.pendingMessagesContainer, shrink: 1, minSize: 0 },`,
		new: `            scrollbarStyle: (text) => theme.bg("scrollbarThumb", text),
        });
        this.transcriptFollowIndicator = new TranscriptFollowIndicator({
            isFollowing: () => this.transcriptScrollView?.isFollowingEnd ?? true,
            keyLabel: () => keyText("tui.altScreen.bottom"),
        });
        const dock = new TuiLayouts.VStack([
            { component: this.transcriptFollowIndicator, shrink: 1, minSize: 0 },
            { component: this.pendingMessagesContainer, shrink: 1, minSize: 0 },`,
	},
	{
		name: "constructor call site",
		marker: "onJumpToEnd: (tui) => this.routeJumpToEnd(tui),\n        });\n        this.ui = createInteractiveTuiReference(() => this.renderer);",
		old: `            onRightClickPaste: this.onRightClickPaste,
        });
        this.ui = createInteractiveTuiReference(() => this.renderer);`,
		new: `            onRightClickPaste: this.onRightClickPaste,
            onJumpToEnd: (tui) => this.routeJumpToEnd(tui),
        });
        this.ui = createInteractiveTuiReference(() => this.renderer);`,
	},
	{
		name: "remount call site",
		marker: "onJumpToEnd: (tui) => this.routeJumpToEnd(tui),\n        });\n        nextUi.setClearOnShrink(clearOnShrink);",
		old: `            onRightClickPaste: this.onRightClickPaste,
        });
        nextUi.setClearOnShrink(clearOnShrink);`,
		new: `            onRightClickPaste: this.onRightClickPaste,
            onJumpToEnd: (tui) => this.routeJumpToEnd(tui),
        });
        nextUi.setClearOnShrink(clearOnShrink);`,
	},
	{
		name: "routeJumpToEnd method",
		marker: "routeJumpToEnd(tui) {",
		old: `    mountInteractiveTui(tui, components) {`,
		new: `    /**
     * Patched pi: route a "Jump to bottom" activation. A focused overlay (e.g.
     * the workflows stage chat) owns the jump; otherwise scroll the main
     * transcript to its live end.
     */
    routeJumpToEnd(tui) {
        const focused = tui.getFocusedComponent?.();
        const isOverlay = focused && tui.overlayStack?.some((entry) => entry.component === focused);
        if (isOverlay && typeof focused.handleInput === "function") {
            focused.handleInput(TRANSCRIPT_JUMP_TO_END_URL);
            return;
        }
        this.transcriptScrollView?.scrollToEnd();
    }
    mountInteractiveTui(tui, components) {`,
	},
];

let out = src;
let applied = 0;
const failures = [];
for (const edit of edits) {
	if (out.includes(edit.marker)) continue;
	if (!out.includes(edit.old)) {
		failures.push(edit.name);
		continue;
	}
	out = out.replace(edit.old, edit.new);
	applied += 1;
}

if (failures.length > 0) {
	log(`FAIL: anchors missing for ${failures.join(", ")} — manual re-baselining needed`);
	notify(
		"pi host patch needs attention",
		"pi was updated but the jump-to-bottom patch anchors no longer match. Ask an agent to re-baseline scripts/auto-apply-pi-host-patch.mjs.",
	);
	process.exit(1);
}

// The npm install may still be finishing; give it one retry window.
let syntaxOk = false;
for (let attempt = 0; attempt < 3 && !syntaxOk; attempt += 1) {
	try {
		writeFileSync(MODE_JS, out);
		mkdirSync(COMPONENT_DIR, { recursive: true });
		copyFileSync(COMPONENT_SRC, COMPONENT_JS);
		execFileSync(process.execPath, ["--check", MODE_JS], { stdio: "pipe" });
		syntaxOk = true;
	} catch {
		if (attempt < 2) execFileSync("sleep", ["2"]);
	}
}

if (!syntaxOk) {
	log("FAIL: syntax check failed after 3 attempts — manual re-baselining needed");
	notify("pi host patch needs attention", "The re-applied host file failed its syntax check. Ask an agent to look at ~/.pi/local/pi-patch-backup/auto-apply.log.");
	process.exit(1);
}

log(`OK: re-applied ${applied} edits after host update`);
notify("pi host patch re-applied", "pi was updated; the jump-to-bottom patch is back in place. Restart pi to use it.");
