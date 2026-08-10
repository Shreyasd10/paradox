/**
 * Provider-aware concurrency scheduler with cancellable leases.
 */

export interface SchedulerLimits {
	maxConcurrent: number;
	maxQueued: number;
	/** Per-provider caps; 0 or absent means no provider-specific limit. */
	providerConcurrency: Record<string, number>;
}

export interface ConcurrencyLease {
	/** Idempotent — second call is a no-op. */
	release(): void;
}

interface Waiter {
	provider: string;
	signal: AbortSignal | undefined;
	resolve: (lease: ConcurrencyLease) => void;
	reject: (error: Error) => void;
	onAbort: (() => void) | null;
}

export class ConcurrencyScheduler {
	private active = 0;
	private readonly perProvider = new Map<string, number>();
	private readonly waiters: Waiter[] = [];
	private readonly limits: SchedulerLimits;

	constructor(limits: SchedulerLimits) {
		this.limits = {
			maxConcurrent: limits.maxConcurrent,
			maxQueued: limits.maxQueued,
			providerConcurrency: { ...limits.providerConcurrency },
		};
	}

	get activeCount(): number {
		return this.active;
	}

	get queuedCount(): number {
		return this.waiters.length;
	}

	providerActiveCount(provider: string): number {
		return this.perProvider.get(provider) ?? 0;
	}

	private providerLimit(provider: string): number | undefined {
		const limit = this.limits.providerConcurrency[provider];
		if (limit === undefined || limit === 0) return undefined;
		return limit;
	}

	private canAdmit(provider: string): boolean {
		if (this.active >= this.limits.maxConcurrent) return false;
		const cap = this.providerLimit(provider);
		if (cap !== undefined && this.providerActiveCount(provider) >= cap) return false;
		return true;
	}

	private grant(provider: string): ConcurrencyLease {
		this.active++;
		this.perProvider.set(provider, this.providerActiveCount(provider) + 1);
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				this.active = Math.max(0, this.active - 1);
				const next = this.providerActiveCount(provider) - 1;
				if (next <= 0) this.perProvider.delete(provider);
				else this.perProvider.set(provider, next);
				this.promote();
			},
		};
	}

	private detachWaiter(waiter: Waiter): void {
		const idx = this.waiters.indexOf(waiter);
		if (idx !== -1) this.waiters.splice(idx, 1);
		if (waiter.signal && waiter.onAbort) {
			waiter.signal.removeEventListener("abort", waiter.onAbort);
			waiter.onAbort = null;
		}
	}

	private promote(): void {
		while (this.waiters.length > 0) {
			const idx = this.waiters.findIndex((w) => this.canAdmit(w.provider));
			if (idx === -1) return;
			const waiter = this.waiters[idx]!;
			this.detachWaiter(waiter);
			waiter.resolve(this.grant(waiter.provider));
		}
	}

	acquire(provider: string, signal?: AbortSignal): Promise<ConcurrencyLease> {
		if (signal?.aborted) {
			return Promise.reject(new Error("Concurrency acquire cancelled."));
		}
		if (this.canAdmit(provider)) {
			return Promise.resolve(this.grant(provider));
		}
		if (this.waiters.length >= this.limits.maxQueued) {
			return Promise.reject(
				new Error(
					`Concurrency limit reached: ${this.limits.maxConcurrent} active, ${this.limits.maxQueued} queued.`,
				),
			);
		}
		return new Promise<ConcurrencyLease>((resolve, reject) => {
			const waiter: Waiter = {
				provider,
				signal,
				resolve,
				reject,
				onAbort: null,
			};
			waiter.onAbort = () => {
				this.detachWaiter(waiter);
				reject(new Error("Concurrency acquire cancelled."));
			};
			this.waiters.push(waiter);
			if (signal && waiter.onAbort) {
				signal.addEventListener("abort", waiter.onAbort, { once: true });
			}
		});
	}

	/** Reject every queued waiter. Idempotent. */
	drain(): void {
		const pending = this.waiters.splice(0, this.waiters.length);
		for (const waiter of pending) {
			if (waiter.signal && waiter.onAbort) {
				waiter.signal.removeEventListener("abort", waiter.onAbort);
				waiter.onAbort = null;
			}
			waiter.reject(new Error("Session shutting down."));
		}
	}
}

export const MAX_CONCURRENT = 5;
export const MAX_QUEUED = 8;
