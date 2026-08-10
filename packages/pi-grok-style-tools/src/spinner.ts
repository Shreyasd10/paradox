import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Loader } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// Patch built-in Loader with Grok Build braille glyphs (xai-grok-pager).
// Frames: ⠋⠙⠹⠸⠼⠴⠦⠧ — ~133ms cadence for in-UI loader.
// ---------------------------------------------------------------------------

const RAW_ANSI_RE = /\x1b\[[0-9;]*m/;
const RESET = "\x1b[0m";

// GrokNight magenta (#bb9af7) / muted (#6c6c6c) defaults
let ACCENT_FG = "\x1b[38;2;187;154;247m";
let STATUS_DIM = "\x1b[38;2;108;108;108m";

let _spinnerSettingsCache: { value: { adaptive: boolean; verbColor: string; statusColor: string }; expires: number } | null = null;
const SPINNER_SETTINGS_TTL_MS = 1_000;
const SPINNER_BUST_KEY = Symbol.for("pi-grok-style-tools:spinner-settings-bust");
let _spinnerLastBust = 0;

function readSpinnerSettings(): { adaptive: boolean; verbColor: string; statusColor: string } {
	const now = Date.now();
	const bust = ((globalThis as any)[SPINNER_BUST_KEY] as number | undefined) ?? 0;
	if (bust !== _spinnerLastBust) {
		_spinnerLastBust = bust;
		_spinnerSettingsCache = null;
	}
	if (_spinnerSettingsCache && _spinnerSettingsCache.expires > now) {
		return _spinnerSettingsCache.value;
	}
	let adaptive = true;
	let verbColor = "accent";
	let statusColor = "muted";
	const paths = [
		join(process.cwd(), CONFIG_DIR_NAME, "settings.json"),
		join(getAgentDir(), "settings.json"),
	];
	for (const p of paths) {
		try {
			if (!p || !existsSync(p)) continue;
			const raw = JSON.parse(readFileSync(p, "utf8"));
			if (raw && typeof raw === "object") {
				if (raw.themeAdaptive === false) adaptive = false;
				if (typeof raw.spinnerVerbColor === "string" && raw.spinnerVerbColor.length > 0) verbColor = raw.spinnerVerbColor;
				if (typeof raw.spinnerStatusColor === "string" && raw.spinnerStatusColor.length > 0) statusColor = raw.spinnerStatusColor;
			}
		} catch { /* ignore */ }
	}
	const value = { adaptive, verbColor, statusColor };
	_spinnerSettingsCache = { value, expires: now + SPINNER_SETTINGS_TTL_MS };
	return value;
}

const _DEFAULT_ACCENT = "\x1b[38;2;187;154;247m";
const _DEFAULT_STATUS_DIM = "\x1b[38;2;108;108;108m";

let _themeColorsCacheTheme: unknown = null;
let _themeColorsLastAdaptive: boolean | null = null;
let _themeColorsLastVerbKey: string | null = null;
let _themeColorsLastStatusKey: string | null = null;

function resolveThemeColor(theme: any, key: string, fallbackKey: string): string | null {
	if (!theme || typeof theme.getFgAnsi !== "function") return null;
	try {
		const v = theme.getFgAnsi(key);
		if (typeof v === "string" && v.length > 0) return v;
	} catch { /* ignore */ }
	if (fallbackKey !== key) {
		try {
			const v = theme.getFgAnsi(fallbackKey);
			if (typeof v === "string" && v.length > 0) return v;
		} catch { /* ignore */ }
	}
	return null;
}

function applyThemeColors(theme: any): void {
	const { adaptive, verbColor, statusColor } = readSpinnerSettings();
	const settingsChanged = _themeColorsLastAdaptive !== adaptive
		|| _themeColorsLastVerbKey !== verbColor
		|| _themeColorsLastStatusKey !== statusColor;
	if (settingsChanged) {
		_themeColorsLastAdaptive = adaptive;
		_themeColorsLastVerbKey = verbColor;
		_themeColorsLastStatusKey = statusColor;
		_themeColorsCacheTheme = null;
		if (!adaptive) {
			ACCENT_FG = _DEFAULT_ACCENT;
			STATUS_DIM = _DEFAULT_STATUS_DIM;
		}
	}
	if (!theme || !adaptive) return;
	if (_themeColorsCacheTheme === theme) return;
	_themeColorsCacheTheme = theme;
	const verb = resolveThemeColor(theme, verbColor, "accent");
	if (verb) ACCENT_FG = verb;
	const status = resolveThemeColor(theme, statusColor, "muted");
	if (status) STATUS_DIM = status;
}

/** Grok braille frames from xai-grok-pager TITLE_SPINNER / turn_status */
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
const LOADER_INTERVAL_MS = 133;
const TITLE_INTERVAL_MS = 264;

const LOADER_LAST_TEXT = Symbol.for("pi-grok-style-tools:loader-last-text");
const LOADER_ACTIVE = Symbol.for("pi-grok-style-tools:loader-active");
const LOADER_GENERATION = Symbol.for("pi-grok-style-tools:loader-generation");
const ACTIVE_UI_SYMBOL = Symbol.for("pi-grok-style-tools:active-ui");

function unrefTimer(timer: ReturnType<typeof setTimeout> | null | undefined): void {
	(timer as any)?.unref?.();
}

function stopLoaderIfUiStopped(loader: any): boolean {
	if (!loader?.ui || !(loader.ui as any).stopped) return false;
	loader.stop?.();
	return true;
}

(Loader.prototype as any).updateDisplay = function patchedUpdateDisplay() {
	if (stopLoaderIfUiStopped(this)) return;
	const frame = BRAILLE_FRAMES[this.currentFrame % BRAILLE_FRAMES.length];
	const message = typeof this.message === "string" && RAW_ANSI_RE.test(this.message)
		? this.message
		: this.messageColorFn(this.message);
	const nextText = `${this.spinnerColorFn(frame)} ${message}`;
	if ((this as any)[LOADER_LAST_TEXT] === nextText) return;
	(this as any)[LOADER_LAST_TEXT] = nextText;
	this.setText(nextText);
	if (this.ui && !(this.ui as any).stopped) {
		(globalThis as any)[ACTIVE_UI_SYMBOL] = this.ui;
		this.ui.requestRender();
	}
};

Loader.prototype.start = function patchedStart() {
	this.stop();
	(this as any)[LOADER_ACTIVE] = true;
	const generation = ((this as any)[LOADER_GENERATION] ?? 0) + 1;
	(this as any)[LOADER_GENERATION] = generation;
	delete (this as any)[LOADER_LAST_TEXT];
	(this as any).updateDisplay();
	if (BRAILLE_FRAMES.length <= 1 || stopLoaderIfUiStopped(this)) return;
	const scheduleNext = () => {
		if ((this as any)[LOADER_ACTIVE] !== true || (this as any)[LOADER_GENERATION] !== generation || stopLoaderIfUiStopped(this)) return;
		const timer = setTimeout(() => {
			(this as any).intervalId = null;
			if ((this as any)[LOADER_ACTIVE] !== true || (this as any)[LOADER_GENERATION] !== generation || stopLoaderIfUiStopped(this)) return;
			(this as any).currentFrame = ((this as any).currentFrame + 1) % BRAILLE_FRAMES.length;
			(this as any).updateDisplay();
			scheduleNext();
		}, LOADER_INTERVAL_MS);
		unrefTimer(timer);
		(this as any).intervalId = timer;
	};
	scheduleNext();
};

Loader.prototype.stop = function patchedStop() {
	(this as any)[LOADER_ACTIVE] = false;
	(this as any)[LOADER_GENERATION] = ((this as any)[LOADER_GENERATION] ?? 0) + 1;
	if ((this as any).intervalId) {
		clearTimeout((this as any).intervalId);
		(this as any).intervalId = null;
	}
};

// Grok status vocabulary (turn_status.rs) — not whimsical Claude verbs
type ActivityKind = "Thinking" | "Responding" | "Running" | "Waiting" | "Compacting";

function formatDuration(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	if (totalSec < 10 && ms > 0) {
		const tenths = Math.floor((ms % 1000) / 100);
		return tenths > 0 ? `${totalSec}.${tenths}s` : `${Math.max(0, totalSec)}s`;
	}
	return `${s}s`;
}

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function estimateResponseLength(message: any): number {
	if (!Array.isArray(message?.content)) return 0;
	return message.content.reduce((sum: number, block: any) =>
		sum + (block?.type === "text" && typeof block.text === "string" ? block.text.length : 0), 0);
}

function textBlockLengths(message: any): number[] {
	if (!Array.isArray(message?.content)) return [];
	const lengths: number[] = [];
	for (let i = 0; i < message.content.length; i++) {
		const block = message.content[i];
		if (block?.type === "text" && typeof block.text === "string") {
			lengths[i] = block.text.length;
		}
	}
	return lengths;
}

function statusText(text: string): string {
	return `${STATUS_DIM}${text}${RESET}`;
}

function sanitizeTitle(title: string): string {
	return title.replace(/[\x00-\x1f\x7f]/g, "").trim();
}

const SHOW_TIMER_AFTER_MS = 0; // Grok shows elapsed early
const THOUGHT_DISPLAY_MS = 3_500;
const MIN_THINKING_SHOW_MS = 100;
const WORKING_MESSAGE_INTERVAL_MS = 1_000;
const TURN_COMPLETION_MS = 2_500;

export default function (pi: ExtensionAPI) {
	let agentStartTime = 0;
	let turnStartTime = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let completionTimer: ReturnType<typeof setTimeout> | null = null;
	let thoughtStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let titleTimer: ReturnType<typeof setTimeout> | null = null;
	let titleFrame = 0;
	let lastTitle = "";
	let idleTitle = "";
	let activity: ActivityKind = "Thinking";
	let responseLength = 0;
	let responseTextBlockLengths: number[] = [];
	let thinkingStatus: "thinking" | number | null = null;
	let thinkingStartTime = 0;
	let thoughtForSetAt = 0;
	let activeTurnId = 0;
	let turnActive = false;
	let lastWorkingMessage: string | null = null;
	let activeCtx: { ui: any; hasUI: boolean } | null = null;

	function cwdLabel(): string {
		try {
			return basename(process.cwd()) || "pi";
		} catch {
			return "pi";
		}
	}

	function ensureIdleTitle(): void {
		if (!idleTitle) idleTitle = `pi - ${cwdLabel()}`;
	}

	function setTitleSafe(title: string): void {
		const next = sanitizeTitle(title);
		if (!next || next === lastTitle) return;
		lastTitle = next;
		try {
			activeCtx?.ui?.setTitle?.(next);
		} catch { /* noop */ }
	}

	function buildTitleString(): string {
		const frame = BRAILLE_FRAMES[titleFrame % BRAILLE_FRAMES.length];
		const label = activity === "Thinking" && thinkingStatus === "thinking"
			? "Thinking"
			: activity;
		return `${frame} ${label} - ${cwdLabel()} - grok`;
	}

	function stopTitleSpinner(restore = true): void {
		if (titleTimer) {
			clearTimeout(titleTimer);
			titleTimer = null;
		}
		if (restore) {
			ensureIdleTitle();
			setTitleSafe(idleTitle);
		}
	}

	function tickTitle(): void {
		if (!turnActive || !activeCtx?.hasUI) {
			stopTitleSpinner(true);
			return;
		}
		titleFrame = (titleFrame + 1) % BRAILLE_FRAMES.length;
		setTitleSafe(buildTitleString());
		titleTimer = setTimeout(tickTitle, TITLE_INTERVAL_MS);
		unrefTimer(titleTimer);
	}

	function startTitleSpinner(): void {
		if (!activeCtx?.hasUI) return;
		ensureIdleTitle();
		if (!titleTimer) {
			titleFrame = 0;
			setTitleSafe(buildTitleString());
			titleTimer = setTimeout(tickTitle, TITLE_INTERVAL_MS);
			unrefTimer(titleTimer);
		}
	}

	/**
	 * Grok turn-status layout (turn_status.rs):
	 * `Thinking… 0.5s                              1m49s ⇣12.6k · Ctrl+C`
	 * Loader prepends the braille spinner; we supply the rest.
	 */
	function buildWorkingMessage(): string {
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		const phaseMs =
			thinkingStatus === "thinking"
				? Date.now() - thinkingStartTime
				: typeof thinkingStatus === "number"
					? thinkingStatus
					: 0;
		const tokenCount = Math.max(0, Math.round(responseLength / 4));

		let leftLabel: string;
		if (thinkingStatus === "thinking") {
			activity = "Thinking";
			leftLabel = `Thinking… ${formatDuration(phaseMs)}`;
		} else if (typeof thinkingStatus === "number") {
			leftLabel = `Thought for ${Math.max(1, Math.round(thinkingStatus / 1000))}s`;
		} else if (activity === "Running") {
			leftLabel = "Running…";
		} else if (tokenCount > 0) {
			activity = "Responding";
			leftLabel = "Responding…";
		} else {
			activity = "Thinking";
			leftLabel = "Thinking…";
		}

		const rightParts: string[] = [];
		if (elapsed >= SHOW_TIMER_AFTER_MS) rightParts.push(formatDuration(elapsed));
		if (tokenCount > 0) rightParts.push(`⇣${formatCount(tokenCount)}`);
		rightParts.push("Ctrl+C");

		const cols = Math.max(40, Number(process.stdout?.columns) || 80);
		// Loader adds `⠋ ` (~2 cols); leave room for that.
		const usable = Math.max(20, cols - 4);
		const rightPlain = rightParts.join(" · ");
		const leftPlainLen = leftLabel.length;
		const rightPlainLen = rightPlain.length;
		const gap = Math.max(1, usable - leftPlainLen - rightPlainLen);
		// Plain text only: omp's loading/status path mangles embedded truecolor
		// SGR (e.g. leaves `154;247mThinking...` from `#bb9af7`). Loader colors
		// the whole message via messageColorFn / spinnerColorFn instead.
		return `${leftLabel}${" ".repeat(gap)}${rightPlain}`;
	}

	function setResponseTextBlockLength(index: number, length: number): void {
		const previous = responseTextBlockLengths[index] ?? 0;
		responseTextBlockLengths[index] = Math.max(0, length);
		responseLength = Math.max(0, responseLength + responseTextBlockLengths[index] - previous);
	}

	function resetResponseTracking(message?: any): void {
		responseTextBlockLengths = message ? textBlockLengths(message) : [];
		responseLength = message ? estimateResponseLength(message) : 0;
	}

	function syncWorkingMessage(force = false): void {
		if (!activeCtx?.hasUI) return;
		applyThemeColors(activeCtx.ui?.theme);
		const nextMessage = buildWorkingMessage();
		if (!force && nextMessage === lastWorkingMessage) return;
		lastWorkingMessage = nextMessage;
		try {
			activeCtx.ui.setWorkingMessage(nextMessage);
		} catch { /* noop */ }
	}

	function restoreDefaultWorkingMessage(): void {
		lastWorkingMessage = null;
		if (!activeCtx?.hasUI) return;
		try {
			activeCtx.ui.setWorkingMessage();
		} catch { /* noop */ }
	}

	function getWorkingMessageIntervalMs(): number {
		return Math.max(250, WORKING_MESSAGE_INTERVAL_MS);
	}

	function scheduleRefreshTick(): void {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		if (!turnActive) return;
		const intervalMs = getWorkingMessageIntervalMs();
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			syncWorkingMessage();
			scheduleRefreshTick();
		}, intervalMs);
		unrefTimer(refreshTimer);
	}

	function startRefreshLoop(): void {
		syncWorkingMessage(true);
		scheduleRefreshTick();
		startTitleSpinner();
	}

	function rescheduleRefreshLoop(): void {
		scheduleRefreshTick();
	}

	function stopRefreshLoop(): void {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	}

	function clearCompletionTimer(): void {
		if (completionTimer) {
			clearTimeout(completionTimer);
			completionTimer = null;
		}
	}

	function clearThoughtStatusTimer(): void {
		if (thoughtStatusTimer) {
			clearTimeout(thoughtStatusTimer);
			thoughtStatusTimer = null;
		}
	}

	function scheduleThoughtStatusClear(): void {
		clearThoughtStatusTimer();
		const remaining = Math.max(0, THOUGHT_DISPLAY_MS - (Date.now() - thoughtForSetAt));
		thoughtStatusTimer = setTimeout(() => {
			thoughtStatusTimer = null;
			if (typeof thinkingStatus === "number") {
				thinkingStatus = null;
				if (turnActive) syncWorkingMessage(true);
				else if (!completionTimer) restoreDefaultWorkingMessage();
			}
		}, remaining);
		unrefTimer(thoughtStatusTimer);
	}

	function clearDisplay(): void {
		stopRefreshLoop();
		clearCompletionTimer();
		clearThoughtStatusTimer();
		stopTitleSpinner(true);
		restoreDefaultWorkingMessage();
	}

	function onThinkingEnd(): void {
		const duration = Date.now() - thinkingStartTime;
		if (duration < MIN_THINKING_SHOW_MS) {
			thinkingStatus = null;
			return;
		}
		thinkingStatus = duration;
		thoughtForSetAt = Date.now();
		scheduleThoughtStatusClear();
	}

	pi.on("before_agent_start", async () => {
		if (!agentStartTime) agentStartTime = Date.now();
	});

	pi.on("agent_start", async () => {
		if (!agentStartTime) agentStartTime = Date.now();
	});

	pi.on("session_start", async (_event, ctx) => {
		activeCtx = ctx;
		ensureIdleTitle();
		setTitleSafe(idleTitle || `pi - ${cwdLabel()}`);
	});

	pi.on("turn_start", async (_event, ctx) => {
		activeTurnId++;
		turnActive = true;
		activeCtx = ctx;
		applyThemeColors(ctx.ui?.theme);
		turnStartTime = Date.now();
		if (!agentStartTime) agentStartTime = turnStartTime;
		activity = "Thinking";
		resetResponseTracking();
		clearCompletionTimer();
		if (typeof thinkingStatus !== "number" || Date.now() - thoughtForSetAt >= THOUGHT_DISPLAY_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
		} else {
			scheduleThoughtStatusClear();
		}
		startRefreshLoop();
	});

	pi.on("message_update", async (event, ctx) => {
		activeCtx = ctx;
		applyThemeColors(ctx.ui?.theme);
		const evt = event.assistantMessageEvent;
		let statusChanged = false;
		const previousTokenCount = Math.max(0, Math.round(responseLength / 4));

		if (evt.type === "start") {
			resetResponseTracking();
		} else if (evt.type === "text_start") {
			setResponseTextBlockLength(evt.contentIndex, 0);
			activity = "Responding";
		} else if (evt.type === "text_delta") {
			const previous = responseTextBlockLengths[evt.contentIndex] ?? 0;
			setResponseTextBlockLength(evt.contentIndex, previous + (typeof evt.delta === "string" ? evt.delta.length : 0));
			activity = "Responding";
		} else if (evt.type === "text_end") {
			setResponseTextBlockLength(evt.contentIndex, typeof evt.content === "string" ? evt.content.length : 0);
		} else if (evt.type === "done") {
			resetResponseTracking(evt.message);
		} else if (evt.type === "error") {
			resetResponseTracking(evt.error);
		}

		if (evt.type === "thinking_start") {
			clearThoughtStatusTimer();
			thinkingStatus = "thinking";
			thinkingStartTime = Date.now();
			activity = "Thinking";
			statusChanged = true;
		}
		if (evt.type === "thinking_end") {
			onThinkingEnd();
			statusChanged = true;
		}

		if (evt.type === "toolcall_start") {
			activity = "Running";
			statusChanged = true;
		}

		if (statusChanged) {
			syncWorkingMessage(true);
			rescheduleRefreshLoop();
			const timer = setTimeout(() => syncWorkingMessage(true), 0);
			unrefTimer(timer);
			return;
		}

		const nextTokenCount = Math.max(0, Math.round(responseLength / 4));
		if (previousTokenCount === 0 && nextTokenCount > 0) {
			rescheduleRefreshLoop();
		}
	});

	pi.on("tool_execution_start", async () => {
		activity = "Running";
		if (turnActive) syncWorkingMessage(true);
	});

	pi.on("turn_end", async (_event, ctx) => {
		turnActive = false;
		activeCtx = ctx;
		applyThemeColors(ctx.ui?.theme);
		const turnId = activeTurnId;
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		stopRefreshLoop();
		stopTitleSpinner(true);
		clearCompletionTimer();

		if (typeof thinkingStatus === "number" && Date.now() - thoughtForSetAt >= THOUGHT_DISPLAY_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
		}

		if (activeCtx?.hasUI) {
			const message = `◆ Turn took ${formatDuration(elapsed)}`;
			lastWorkingMessage = message;
			try {
				activeCtx.ui.setWorkingMessage(message);
			} catch { /* noop */ }
			completionTimer = setTimeout(() => {
				completionTimer = null;
				if (activeTurnId !== turnId) return;
				restoreDefaultWorkingMessage();
			}, TURN_COMPLETION_MS);
			unrefTimer(completionTimer);
		} else if (typeof thinkingStatus !== "number") {
			restoreDefaultWorkingMessage();
		}

		responseLength = 0;
		responseTextBlockLengths = [];
	});

	pi.on("agent_end", async () => {
		turnActive = false;
		agentStartTime = 0;
		stopTitleSpinner(true);
		if (completionTimer) return;
		clearDisplay();
	});

	pi.on("session_shutdown", async () => {
		turnActive = false;
		clearDisplay();
		activeCtx = null;
	});
}
