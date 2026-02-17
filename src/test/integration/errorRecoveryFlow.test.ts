import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentFactory } from "../../execution/agents/agentFactory";
import {
  AgentFallbackCoordinator,
  RateLimitQueue,
  ExecutionStateManager,
} from "../../utils/errorRecovery";
import {
  AllAgentsExhaustedError,
  RateLimitError,
  StatePersistenceError,
} from "../../utils/errors";
import {
  makeMockSessionManager,
  makeTask,
  makePlan,
  makeContextSubset,
  makeMockStateStore,
  makeAgentExecutionResult,
} from "../fixtures";

// ---------------------------------------------------------------------------
// Error Recovery Flow Integration
//
// Composes AgentFallbackCoordinator, RateLimitQueue, and
// ExecutionStateManager with mock infrastructure.
// ---------------------------------------------------------------------------

describe("Error Recovery Flow Integration", () => {
  // ---- Agent Fallback Chain ----

  describe("agent fallback chain", () => {
    it("primary agent succeeds → no fallback", async () => {
      const { sessionManager } = makeMockSessionManager(["Generated output."]);
      const factory = new AgentFactory(sessionManager);
      const coordinator = new AgentFallbackCoordinator(factory);

      const task = makeTask({ id: "t1", agent: "claude" });
      const context = makeContextSubset({ taskId: "t1" });

      const result = await coordinator.executeWithFallback(task, context, "claude");
      expect(result.output.taskId).toBe("t1");
      expect(result.sessionStatus.state).toBe("completed");
    });

    it("claude fails → copilot succeeds", async () => {
      const { sessionManager } = makeMockSessionManager(["Output from fallback."]);
      const factory = new AgentFactory(sessionManager);

      // Make the first agent (claude) throw, copilot succeeds
      let callCount = 0;
      const originalCreate = factory.create.bind(factory);
      vi.spyOn(factory, "create").mockImplementation((role) => {
        const agent = originalCreate(role);
        if (role === "claude") {
          const originalExecute = agent.execute.bind(agent);
          agent.execute = async () => {
            callCount++;
            throw {
              code: "session-failed" as const,
              message: "Claude failed",
              taskId: "t1",
              agent: "claude" as const,
              sessionStatus: null,
            };
          };
        }
        return agent;
      });

      const coordinator = new AgentFallbackCoordinator(factory);
      const task = makeTask({ id: "t1", agent: "claude" });
      const context = makeContextSubset({ taskId: "t1" });

      const result = await coordinator.executeWithFallback(task, context, "claude");
      expect(callCount).toBe(1); // claude was tried
      expect(result.sessionStatus.state).toBe("completed");
    });

    it("all agents fail → AllAgentsExhaustedError", async () => {
      const { sessionManager } = makeMockSessionManager(["Output."]);
      const factory = new AgentFactory(sessionManager);

      // All agents throw
      vi.spyOn(factory, "create").mockImplementation((role) => {
        return {
          execute: async () => {
            throw {
              code: "session-failed" as const,
              message: `${role} failed`,
              taskId: "t1",
              agent: role,
              sessionStatus: null,
            };
          },
        } as ReturnType<typeof factory.create>;
      });

      const coordinator = new AgentFallbackCoordinator(factory);
      const task = makeTask({ id: "t1" });
      const context = makeContextSubset({ taskId: "t1" });

      await expect(
        coordinator.executeWithFallback(task, context, "claude")
      ).rejects.toBeInstanceOf(AllAgentsExhaustedError);
    });

    it("cancelled session → no fallback, immediate failure", async () => {
      const { sessionManager } = makeMockSessionManager(["Output."]);
      const factory = new AgentFactory(sessionManager);

      vi.spyOn(factory, "create").mockImplementation((role) => {
        return {
          execute: async () => {
            throw {
              code: "session-cancelled" as const,
              message: "User cancelled",
              taskId: "t1",
              agent: role,
              sessionStatus: null,
            };
          },
        } as ReturnType<typeof factory.create>;
      });

      const coordinator = new AgentFallbackCoordinator(factory);
      const task = makeTask({ id: "t1" });
      const context = makeContextSubset({ taskId: "t1" });

      await expect(
        coordinator.executeWithFallback(task, context, "claude")
      ).rejects.toThrow("User cancelled");
    });

    it("successful fallback returns a valid AgentExecutionResult", async () => {
      const { sessionManager } = makeMockSessionManager(["Fallback output."]);
      const factory = new AgentFactory(sessionManager);

      let attempt = 0;
      const originalCreate = factory.create.bind(factory);
      vi.spyOn(factory, "create").mockImplementation((role) => {
        attempt++;
        if (attempt === 1) {
          return {
            execute: async () => {
              throw {
                code: "empty-output" as const,
                message: "No output",
                taskId: "t1",
                agent: "claude" as const,
                sessionStatus: null,
              };
            },
          } as ReturnType<typeof factory.create>;
        }
        return originalCreate(role);
      });

      const coordinator = new AgentFallbackCoordinator(factory);
      const task = makeTask({ id: "t1" });
      const context = makeContextSubset({ taskId: "t1" });

      const result = await coordinator.executeWithFallback(task, context, "claude");
      expect(result.output).toBeDefined();
      expect(result.output.taskId).toBe("t1");
      expect(result.sessionStatus).toBeDefined();
    });
  });

  // ---- Rate Limit Queueing ----

  describe("rate limit queueing", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("queues tasks and drains in FIFO order", async () => {
      const queue = new RateLimitQueue({ maxSize: 5, drainIntervalMs: 100 });
      const order: string[] = [];

      const p1 = queue.enqueue("t1", async () => {
        order.push("t1");
        return makeAgentExecutionResult({ output: { taskId: "t1", agent: "claude", output: "r1" } });
      });
      const p2 = queue.enqueue("t2", async () => {
        order.push("t2");
        return makeAgentExecutionResult({ output: { taskId: "t2", agent: "copilot", output: "r2" } });
      });

      expect(queue.getQueueDepth()).toBe(2);

      // Drain first
      await vi.advanceTimersByTimeAsync(100);
      const r1 = await p1;
      expect(r1.output.taskId).toBe("t1");

      // Drain second
      await vi.advanceTimersByTimeAsync(100);
      const r2 = await p2;
      expect(r2.output.taskId).toBe("t2");

      expect(order).toEqual(["t1", "t2"]);
      queue.dispose();
    });

    it("rejects when queue is full", () => {
      const queue = new RateLimitQueue({ maxSize: 1 });
      const p = queue.enqueue("t1", async () => makeAgentExecutionResult());
      expect(() =>
        queue.enqueue("t2", async () => makeAgentExecutionResult())
      ).toThrow(RateLimitError);

      queue.dispose();
      // Catch the rejection from dispose
      p.catch(() => {});
    });

    it("dispose rejects all pending entries", async () => {
      const queue = new RateLimitQueue({ maxSize: 5 });
      const p1 = queue.enqueue("t1", async () => makeAgentExecutionResult());
      const p2 = queue.enqueue("t2", async () => makeAgentExecutionResult());

      queue.dispose();

      await expect(p1).rejects.toBeInstanceOf(RateLimitError);
      await expect(p2).rejects.toBeInstanceOf(RateLimitError);
    });
  });

  // ---- State Checkpoint & Resume ----

  describe("state checkpoint and resume", () => {
    it("checkpoint saves plan, loadCheckpoint restores it", async () => {
      const store = makeMockStateStore();
      const manager = new ExecutionStateManager(store);

      const plan = makePlan({ templateName: "test-checkpoint" });
      await manager.checkpoint("plan-1", plan);
      expect(store.saveFn).toHaveBeenCalledWith("plan-plan-1", plan);

      const loaded = await manager.loadCheckpoint("plan-1");
      expect(loaded).toEqual(plan);
    });

    it("clearCheckpoint removes saved state", async () => {
      const store = makeMockStateStore();
      const manager = new ExecutionStateManager(store);

      const plan = makePlan();
      await manager.checkpoint("plan-1", plan);
      await manager.clearCheckpoint("plan-1");

      const loaded = await manager.loadCheckpoint("plan-1");
      expect(loaded).toBeNull();
    });

    it("autosave fires periodically and persists plan", async () => {
      vi.useFakeTimers();
      const store = makeMockStateStore();
      const manager = new ExecutionStateManager(store, 500);

      const plan = makePlan({ templateName: "autosaved-plan" });
      manager.startAutosave("plan-1", () => plan);

      // No save yet
      expect(store.saveFn).not.toHaveBeenCalled();

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(600);
      expect(store.saveFn).toHaveBeenCalledWith("plan-plan-1", plan);

      // Advance another interval — saved again
      await vi.advanceTimersByTimeAsync(600);
      expect(store.saveFn).toHaveBeenCalledTimes(2);

      manager.dispose();
      vi.useRealTimers();
    });

    it("corrupted store throws StatePersistenceError", async () => {
      const store = makeMockStateStore();
      store.saveFn.mockRejectedValueOnce(new Error("Disk full"));

      const manager = new ExecutionStateManager(store);

      await expect(
        manager.checkpoint("plan-1", makePlan())
      ).rejects.toBeInstanceOf(StatePersistenceError);
    });
  });
});
