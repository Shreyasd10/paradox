import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyScheduler, type ConcurrencyLease } from "../src/concurrency.ts";

function makeScheduler(partial: {
	maxConcurrent?: number;
	maxQueued?: number;
	providerConcurrency?: Record<string, number>;
} = {}): ConcurrencyScheduler {
	return new ConcurrencyScheduler({
		maxConcurrent: partial.maxConcurrent ?? 5,
		maxQueued: partial.maxQueued ?? 8,
		providerConcurrency: partial.providerConcurrency ?? {},
	});
}

describe("concurrency", () => {
	describe("ConcurrencyScheduler", () => {
		let scheduler: ConcurrencyScheduler;

		beforeEach(() => {
			scheduler = makeScheduler();
		});

		it("acquires five leases immediately when capacity allows", async () => {
			const leases: ConcurrencyLease[] = [];
			for (let i = 0; i < 5; i++) {
				leases.push(await scheduler.acquire(`p${i}`));
			}
			assert.equal(scheduler.activeCount, 5);
			assert.equal(scheduler.queuedCount, 0);
			for (const lease of leases) lease.release();
			assert.equal(scheduler.activeCount, 0);
		});

		it("queues when global capacity is exhausted without granting a lease", async () => {
			scheduler = makeScheduler({ maxConcurrent: 2 });
			const a = await scheduler.acquire("a");
			const b = await scheduler.acquire("b");
			let granted = false;
			const pending = scheduler.acquire("c").then((lease) => {
				granted = true;
				return lease;
			});
			await new Promise((r) => setTimeout(r, 10));
			assert.equal(granted, false);
			assert.equal(scheduler.activeCount, 2);
			assert.equal(scheduler.queuedCount, 1);
			a.release();
			const c = await pending;
			assert.equal(granted, true);
			assert.equal(scheduler.activeCount, 2);
			b.release();
			c.release();
		});

		it("queues same-provider work while allowing other providers", async () => {
			scheduler = makeScheduler({
				maxConcurrent: 5,
				providerConcurrency: { openai: 1 },
			});
			const first = await scheduler.acquire("openai");
			let secondGranted = false;
			const second = scheduler.acquire("openai").then((lease) => {
				secondGranted = true;
				return lease;
			});
			const other = await scheduler.acquire("anthropic");
			await new Promise((r) => setTimeout(r, 10));
			assert.equal(secondGranted, false);
			assert.equal(scheduler.activeCount, 2);
			assert.equal(scheduler.queuedCount, 1);
			first.release();
			const secondLease = await second;
			assert.equal(secondGranted, true);
			secondLease.release();
			other.release();
		});

		it("rejects when the queue is full with a stable capacity error", async () => {
			scheduler = makeScheduler({ maxConcurrent: 1, maxQueued: 2 });
			await scheduler.acquire("a");
			scheduler.acquire("b");
			scheduler.acquire("c");
			await new Promise((r) => setTimeout(r, 10));
			assert.equal(scheduler.queuedCount, 2);
			await assert.rejects(scheduler.acquire("d"), /Concurrency limit reached/);
		});

		it("cancels a queued waiter without consuming a slot", async () => {
			scheduler = makeScheduler({ maxConcurrent: 1 });
			const held = await scheduler.acquire("a");
			const ac = new AbortController();
			const pending = scheduler.acquire("b", ac.signal);
			assert.equal(scheduler.queuedCount, 1);
			ac.abort();
			await assert.rejects(pending, /cancel|abort/i);
			assert.equal(scheduler.queuedCount, 0);
			assert.equal(scheduler.activeCount, 1);
			held.release();
			assert.equal(scheduler.activeCount, 0);
		});

		it("treats double release as a no-op", async () => {
			const lease = await scheduler.acquire("a");
			lease.release();
			lease.release();
			assert.equal(scheduler.activeCount, 0);
			const next = await scheduler.acquire("b");
			assert.equal(scheduler.activeCount, 1);
			next.release();
		});

		it("drain rejects queued waiters and prevents promotion", async () => {
			scheduler = makeScheduler({ maxConcurrent: 1 });
			const held = await scheduler.acquire("a");
			const pending = scheduler.acquire("b");
			assert.equal(scheduler.queuedCount, 1);
			scheduler.drain();
			await assert.rejects(pending, /shutting down/i);
			assert.equal(scheduler.queuedCount, 0);
			held.release();
			assert.equal(scheduler.activeCount, 0);
			// After drain, new acquires may still work for a fresh session path —
			// but queued promotion must not happen from drained waiters (already rejected).
		});

		it("promotes the oldest eligible waiter fairly", async () => {
			scheduler = makeScheduler({
				maxConcurrent: 2,
				providerConcurrency: { openai: 1 },
			});
			const o1 = await scheduler.acquire("openai");
			const a1 = await scheduler.acquire("anthropic");
			const order: string[] = [];
			const q1 = scheduler.acquire("openai").then((l) => {
				order.push("openai");
				return l;
			});
			const q2 = scheduler.acquire("anthropic").then((l) => {
				order.push("anthropic");
				return l;
			});
			await new Promise((r) => setTimeout(r, 10));
			assert.equal(scheduler.queuedCount, 2);
			// Free anthropic slot + global: oldest eligible is anthropic waiter (openai still capped)
			a1.release();
			const a2 = await q2;
			assert.deepEqual(order, ["anthropic"]);
			assert.equal(scheduler.queuedCount, 1);
			o1.release();
			const o2 = await q1;
			assert.deepEqual(order, ["anthropic", "openai"]);
			a2.release();
			o2.release();
		});

		it("treats provider limit zero as disabled", async () => {
			scheduler = makeScheduler({
				maxConcurrent: 3,
				providerConcurrency: { openai: 0 },
			});
			const leases = await Promise.all([
				scheduler.acquire("openai"),
				scheduler.acquire("openai"),
				scheduler.acquire("openai"),
			]);
			assert.equal(scheduler.activeCount, 3);
			for (const l of leases) l.release();
		});
	});
});
