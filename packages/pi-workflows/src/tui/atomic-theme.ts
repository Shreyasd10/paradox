/**
 * Stock `pi` never calls Atomic's `initTheme()`. Stage chat embeds Atomic
 * components (`UsageMeterComponent`, working status, message chrome) that read
 * the global theme proxy and throw "Theme not initialized" otherwise.
 */
import { initTheme } from "@bastani/atomic";

let ensured = false;

/** Idempotent: first call publishes a live Atomic theme; later calls no-op. */
export function ensureAtomicThemeInitialized(themeName?: string): void {
	if (ensured) return;
	initTheme(themeName);
	ensured = true;
}
