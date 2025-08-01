/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "assert";
import Sinon from "sinon";
import { ThrottlingError } from "@fluidframework/server-services-core";
import { TestThrottlerHelper } from "@fluidframework/server-test-utils";
import { HybridThrottler, type ILocalThrottleConfig } from "../hybridThrottler";
import { createFromGlobalLimits, createForLowLatency } from "../localThrottleConfigBuilder";

describe("HybridThrottler", () => {
	beforeEach(() => {
		Sinon.useFakeTimers();
	});

	afterEach(() => {
		Sinon.restore();
	});

	describe("Local Throttling", () => {
		it("allows operations within local rate limit", () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 10,
				localBurstCapacity: 10,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000); // Very high global limit
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Should allow operations up to local burst capacity
			for (let i = 0; i < 10; i++) {
				assert.doesNotThrow(
					() => {
						hybridThrottler.incrementCount(id, 1);
					},
					`Operation ${i + 1} should not be throttled`,
				);
			}
		});

		it("throttles operations exceeding local rate limit", () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 5,
				localBurstCapacity: 5,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000); // Very high global limit
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Use up the burst capacity
			for (let i = 0; i < 5; i++) {
				hybridThrottler.incrementCount(id, 1);
			}

			// Next operation should be throttled locally
			assert.throws(
				() => {
					hybridThrottler.incrementCount(id, 1);
				},
				ThrottlingError,
				"6th operation should be throttled by local limits",
			);
		});

		it("replenishes tokens after time passes", async () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 10,
				localBurstCapacity: 5,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000);
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Use up burst capacity
			for (let i = 0; i < 5; i++) {
				hybridThrottler.incrementCount(id, 1);
			}

			// Should be throttled
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 1);
			}, ThrottlingError);

			// Advance time by 200ms (2 replenish cycles)
			Sinon.clock.tick(200);

			// Should be able to make 2 more operations (1 token per 100ms, 10 ops/sec = 1 op per 100ms)
			assert.doesNotThrow(() => {
				hybridThrottler.incrementCount(id, 1);
			});
			assert.doesNotThrow(() => {
				hybridThrottler.incrementCount(id, 1);
			});

			// 3rd operation should be throttled
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 1);
			}, ThrottlingError);
		});

		it("handles decrementCount by adding tokens back", () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 5,
				localBurstCapacity: 5,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000);
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Use up burst capacity
			for (let i = 0; i < 5; i++) {
				hybridThrottler.incrementCount(id, 1);
			}

			// Should be throttled
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 1);
			}, ThrottlingError);

			// Decrement count (simulate operation completion)
			hybridThrottler.decrementCount(id, 2);

			// Should now be able to make 2 more operations
			assert.doesNotThrow(() => {
				hybridThrottler.incrementCount(id, 1);
			});
			assert.doesNotThrow(() => {
				hybridThrottler.incrementCount(id, 1);
			});

			// 3rd operation should be throttled again
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 1);
			}, ThrottlingError);
		});
	});

	describe("Distributed Throttling Integration", () => {
		it("uses distributed throttler for background sync", async () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 100, // High local limit
				localBurstCapacity: 100,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000); // High global limit
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 100); // Short sync interval
			const id = "test-id";

			// Make operations that should trigger background sync
			hybridThrottler.incrementCount(id, 1);

			// Advance time to trigger sync
			Sinon.clock.tick(101);

			// Make another operation to trigger the sync
			hybridThrottler.incrementCount(id, 1);

			// Wait for async operations
			await Sinon.clock.nextAsync();

			// Verify that operations completed successfully (no throwing)
			// This tests that the integration works without errors
			assert.doesNotThrow(() => {
				hybridThrottler.incrementCount(id, 1);
			}, "Integration should work without errors");
		});
	});

	describe("Configuration Validation", () => {
		it("throws error for invalid local config", () => {
			const throttlerHelper = new TestThrottlerHelper(1000);

			assert.throws(
				() => {
					new HybridThrottler(
						throttlerHelper,
						{
							maxLocalOpsPerSecond: 0, // Invalid
							localBurstCapacity: 10,
							localReplenishIntervalMs: 100,
						},
						60000,
					);
				},
				Error,
				"Should throw for maxLocalOpsPerSecond <= 0",
			);

			assert.throws(
				() => {
					new HybridThrottler(
						throttlerHelper,
						{
							maxLocalOpsPerSecond: 10,
							localBurstCapacity: 10,
							localReplenishIntervalMs: 0, // Invalid
						},
						60000,
					);
				},
				Error,
				"Should throw for localReplenishIntervalMs <= 0",
			);
		});
	});

	describe("Configuration Builder Integration", () => {
		it("creates working throttler from global limits", () => {
			const throttlerHelper = new TestThrottlerHelper(1000);
			const localConfig = createFromGlobalLimits(100, 10, 0.8, 2); // 100 ops/sec, 10 instances
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Should allow some operations (local limit should be ~8 ops/sec with burst of ~16)
			for (let i = 0; i < 16; i++) {
				assert.doesNotThrow(
					() => {
						hybridThrottler.incrementCount(id, 1);
					},
					`Operation ${i + 1} should not be throttled`,
				);
			}

			// Should throttle after burst capacity
			assert.throws(
				() => {
					hybridThrottler.incrementCount(id, 1);
				},
				ThrottlingError,
				"Should be throttled after burst capacity",
			);
		});

		it("creates working throttler for low latency scenarios", () => {
			const throttlerHelper = new TestThrottlerHelper(1000);
			const localConfig = createForLowLatency(20); // 20 ops/sec
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Should allow burst up to 20 operations
			for (let i = 0; i < 20; i++) {
				assert.doesNotThrow(() => {
					hybridThrottler.incrementCount(id, 1);
				});
			}

			// Should throttle after burst
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 1);
			}, ThrottlingError);
		});
	});

	describe("Multiple IDs", () => {
		it("throttles different IDs independently", () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 5,
				localBurstCapacity: 3,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000);
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);

			// Use up capacity for first ID
			for (let i = 0; i < 3; i++) {
				hybridThrottler.incrementCount("id1", 1);
			}

			// First ID should be throttled
			assert.throws(() => {
				hybridThrottler.incrementCount("id1", 1);
			}, ThrottlingError);

			// Second ID should still work
			for (let i = 0; i < 3; i++) {
				assert.doesNotThrow(() => {
					hybridThrottler.incrementCount("id2", 1);
				});
			}

			// Second ID should now be throttled too
			assert.throws(() => {
				hybridThrottler.incrementCount("id2", 1);
			}, ThrottlingError);
		});
	});

	describe("Weight Handling", () => {
		it("handles weighted operations correctly", () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 10,
				localBurstCapacity: 10,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000);
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Single operation with weight 5 should consume 5 tokens
			hybridThrottler.incrementCount(id, 5);

			// Should be able to do 5 more weight-1 operations
			for (let i = 0; i < 5; i++) {
				assert.doesNotThrow(() => {
					hybridThrottler.incrementCount(id, 1);
				});
			}

			// Next operation should be throttled
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 1);
			}, ThrottlingError);
		});

		it("throttles operations that exceed remaining capacity", () => {
			const localConfig: ILocalThrottleConfig = {
				maxLocalOpsPerSecond: 10,
				localBurstCapacity: 10,
				localReplenishIntervalMs: 100,
			};
			const throttlerHelper = new TestThrottlerHelper(1000);
			const hybridThrottler = new HybridThrottler(throttlerHelper, localConfig, 60000);
			const id = "test-id";

			// Use 8 tokens
			hybridThrottler.incrementCount(id, 8);

			// Operation with weight 5 should be throttled (needs 5 but only 2 available)
			assert.throws(() => {
				hybridThrottler.incrementCount(id, 5);
			}, ThrottlingError);

			// But weight 2 should still work
			assert.doesNotThrow(() => {
				hybridThrottler.incrementCount(id, 2);
			});
		});
	});
});
