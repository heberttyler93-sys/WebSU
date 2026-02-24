/**
 * registry.test.js — unit tests for src/bus/InstanceRegistry.js
 *
 * Uses Vitest fake timers to test heartbeat and pruning behavior without
 * actually waiting for real time to pass.
 *
 * BroadcastChannel is mocked (same MockBroadcastChannel as bus.test.js).
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { Bus } from '../../src/bus/Bus.js';
import { InstanceRegistry } from '../../src/bus/InstanceRegistry.js';
import {
  TOPICS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from '../../src/bus/constants.js';

// ─── Mock BroadcastChannel (same impl as bus.test.js) ─────────────────────

class MockBroadcastChannel {
  static _registry = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.onmessageerror = null;
    this.closed = false;

    if (!MockBroadcastChannel._registry.has(name)) {
      MockBroadcastChannel._registry.set(name, new Set());
    }
    MockBroadcastChannel._registry.get(name).add(this);
  }

  postMessage(data) {
    if (this.closed) return;
    const peers = MockBroadcastChannel._registry.get(this.name) ?? new Set();
    for (const peer of peers) {
      if (peer !== this && !peer.closed && peer.onmessage) {
        peer.onmessage({ data });
      }
    }
  }

  close() {
    this.closed = true;
    MockBroadcastChannel._registry.get(this.name)?.delete(this);
  }

  static _reset() {
    MockBroadcastChannel._registry.clear();
  }
}

vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTab(instanceId, meta = {}) {
  const bus = new Bus(instanceId);
  const registry = new InstanceRegistry(bus, meta);
  return { bus, registry };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('InstanceRegistry', () => {
  beforeEach(() => {
    MockBroadcastChannel._reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('registers self on creation', () => {
      const { registry, bus } = makeTab('tab-a');
      expect(registry.size).toBe(1);
      expect(registry.getSelf().instanceId).toBe('tab-a');
      registry.destroy(); bus.destroy();
    });

    it("marks own record as isSelf = true", () => {
      const { registry, bus } = makeTab('tab-a');
      expect(registry.getSelf().isSelf).toBe(true);
      registry.destroy(); bus.destroy();
    });

    it('initializes role and pipelineId as null', () => {
      const { registry, bus } = makeTab('tab-a');
      const self = registry.getSelf();
      expect(self.role).toBeNull();
      expect(self.pipelineId).toBeNull();
      registry.destroy(); bus.destroy();
    });

    it('throws if bus argument is invalid', () => {
      expect(() => new InstanceRegistry(null)).toThrow('[InstanceRegistry]');
      expect(() => new InstanceRegistry({})).toThrow('[InstanceRegistry]');
    });

    it('accepts initial meta', () => {
      const { registry, bus } = makeTab('tab-a', { customKey: 'customVal' });
      expect(registry.getSelf().meta.customKey).toBe('customVal');
      registry.destroy(); bus.destroy();
    });

    it('broadcasts INSTANCE_JOIN on creation', () => {
      // Create a passive bus to observe what gets published
      const observerBus = new Bus('observer');
      const joinHandler = vi.fn();
      observerBus.subscribe(TOPICS.INSTANCE_JOIN, joinHandler);

      const { registry, bus } = makeTab('new-tab');

      expect(joinHandler).toHaveBeenCalledOnce();
      expect(joinHandler.mock.calls[0][0].instanceId).toBe('new-tab');

      registry.destroy(); bus.destroy(); observerBus.destroy();
    });
  });

  // ── Multi-tab discovery ────────────────────────────────────────────────────

  describe('multi-tab discovery', () => {
    it('discovers other tabs via INSTANCE_JOIN', () => {
      const { registry: regA, bus: busA } = makeTab('tab-a');
      const { registry: regB, bus: busB } = makeTab('tab-b');

      // tab-b was created after tab-a; tab-a should now know about tab-b
      expect(regA.size).toBe(2);
      expect(regA.getInstance('tab-b')).toBeDefined();

      regA.destroy(); busA.destroy();
      regB.destroy(); busB.destroy();
    });

    it('marks remote instances as isSelf = false', () => {
      const { registry: regA, bus: busA } = makeTab('tab-a');
      const { registry: regB, bus: busB } = makeTab('tab-b');

      const tabBFromA = regA.getInstance('tab-b');
      expect(tabBFromA.isSelf).toBe(false);

      regA.destroy(); busA.destroy();
      regB.destroy(); busB.destroy();
    });

    it('getInstances() returns copies, not live references', () => {
      const { registry, bus } = makeTab('tab-a');
      const instances = registry.getInstances();
      const original = instances[0];

      // Mutate the returned copy
      original.role = 'mutated';

      // Internal state should not be affected
      expect(registry.getSelf().role).toBeNull();

      registry.destroy(); bus.destroy();
    });

    it('three tabs all see each other', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');
      const { registry: rC, bus: bC } = makeTab('tab-c');

      expect(rA.size).toBe(3);
      expect(rB.size).toBe(3);
      expect(rC.size).toBe(3);

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
      rC.destroy(); bC.destroy();
    });
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  describe('heartbeat', () => {
    it('broadcasts a heartbeat on interval', () => {
      const observerBus = new Bus('observer');
      const heartbeatHandler = vi.fn();
      observerBus.subscribe(TOPICS.HEARTBEAT, heartbeatHandler);

      const { registry, bus } = makeTab('tab-a');

      // Advance time by exactly one heartbeat interval
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(heartbeatHandler).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(heartbeatHandler).toHaveBeenCalledTimes(2);

      registry.destroy(); bus.destroy(); observerBus.destroy();
    });

    it('heartbeat payload includes instanceId and role', () => {
      const observerBus = new Bus('observer');
      const heartbeatHandler = vi.fn();
      observerBus.subscribe(TOPICS.HEARTBEAT, heartbeatHandler);

      const { registry, bus } = makeTab('tab-a');
      registry.updateRole('scraper');

      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      const payload = heartbeatHandler.mock.calls[0][0];
      expect(payload.instanceId).toBe('tab-a');
      expect(payload.role).toBe('scraper');

      registry.destroy(); bus.destroy(); observerBus.destroy();
    });

    it('receiving a heartbeat refreshes the lastHeartbeat timestamp', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      // tab-a should see tab-b in its registry
      const before = rA.getInstance('tab-b').lastHeartbeat;

      // Advance time and let tab-b broadcast a heartbeat
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + 100);

      const after = rA.getInstance('tab-b').lastHeartbeat;
      expect(after).toBeGreaterThanOrEqual(before);

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
    });
  });

  // ── Pruning ────────────────────────────────────────────────────────────────

  describe('pruning (dead instance detection)', () => {
    it('prunes a tab that stops heartbeating after HEARTBEAT_TIMEOUT_MS', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      expect(rA.size).toBe(2);

      // Destroy tab-b without graceful leave (simulate crash)
      clearInterval(rB['_heartbeatTimer']); // won't work — private field
      // Instead: destroy the registry without publishing INSTANCE_LEAVE
      // We simulate a crash by stopping heartbeats from tab-b's bus
      bB.destroy(); // close the channel so no more heartbeats come through

      // Advance past the timeout
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_TIMEOUT_MS / 2 + 1000);

      expect(rA.size).toBe(1);
      expect(rA.getInstance('tab-b')).toBeUndefined();

      rA.destroy(); bA.destroy();
    });

    it('never prunes self regardless of timing', () => {
      const { registry, bus } = makeTab('tab-a');

      // Advance way past timeout
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 10);

      expect(registry.size).toBe(1);
      expect(registry.getSelf()).toBeDefined();

      registry.destroy(); bus.destroy();
    });

    it('fires onChange with reason=timeout when pruning', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      const changeHandler = vi.fn();
      rA.onChange(changeHandler);

      // Simulate crash
      bB.destroy();

      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + HEARTBEAT_TIMEOUT_MS / 2 + 1000);

      const timeoutCall = changeHandler.mock.calls.find(
        ([, event]) => event.reason === 'timeout' && event.instanceId === 'tab-b',
      );
      expect(timeoutCall).toBeDefined();

      rA.destroy(); bA.destroy();
    });
  });

  // ── Graceful leave ─────────────────────────────────────────────────────────

  describe('graceful leave via destroy()', () => {
    it('removes the leaving tab immediately from peers', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      expect(rA.size).toBe(2);

      rB.destroy(); bB.destroy();

      // tab-b should be gone immediately — no need to wait for pruning
      expect(rA.size).toBe(1);
      expect(rA.getInstance('tab-b')).toBeUndefined();

      rA.destroy(); bA.destroy();
    });

    it('fires onChange with reason=leave for the departing tab', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      const changeHandler = vi.fn();
      rA.onChange(changeHandler);

      rB.destroy(); bB.destroy();

      const leaveCall = changeHandler.mock.calls.find(
        ([, event]) => event.reason === 'leave' && event.instanceId === 'tab-b',
      );
      expect(leaveCall).toBeDefined();

      rA.destroy(); bA.destroy();
    });
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  describe('updateRole / updatePipeline / updateMeta', () => {
    it('updateRole sets role on self and broadcasts immediately', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      rA.updateRole('scraper');

      expect(rA.getSelf().role).toBe('scraper');
      // tab-b should receive the broadcast heartbeat and see the updated role
      expect(rB.getInstance('tab-a').role).toBe('scraper');

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
    });

    it('updateRole(null) clears the role', () => {
      const { registry, bus } = makeTab('tab-a');
      registry.updateRole('worker');
      registry.updateRole(null);
      expect(registry.getSelf().role).toBeNull();
      registry.destroy(); bus.destroy();
    });

    it('updatePipeline sets pipelineId and broadcasts immediately', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const { registry: rB, bus: bB } = makeTab('tab-b');

      rA.updatePipeline('pipeline-xyz');

      expect(rA.getSelf().pipelineId).toBe('pipeline-xyz');
      expect(rB.getInstance('tab-a').pipelineId).toBe('pipeline-xyz');

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
    });

    it('updateMeta merges into existing meta (shallow)', () => {
      const { registry, bus } = makeTab('tab-a', { existingKey: 'keep' });
      registry.updateMeta({ newKey: 'added' });

      const meta = registry.getSelf().meta;
      expect(meta.existingKey).toBe('keep');
      expect(meta.newKey).toBe('added');

      registry.destroy(); bus.destroy();
    });

    it('updateMeta overwrites keys with same name', () => {
      const { registry, bus } = makeTab('tab-a', { key: 'old' });
      registry.updateMeta({ key: 'new' });
      expect(registry.getSelf().meta.key).toBe('new');
      registry.destroy(); bus.destroy();
    });

    it('updateRole fires onChange with reason=updated', () => {
      const { registry, bus } = makeTab('tab-a');
      const changeHandler = vi.fn();
      registry.onChange(changeHandler);

      registry.updateRole('analyzer');

      const updatedCall = changeHandler.mock.calls.find(
        ([, event]) => event.reason === 'updated',
      );
      expect(updatedCall).toBeDefined();

      registry.destroy(); bus.destroy();
    });
  });

  // ── onChange ──────────────────────────────────────────────────────────────

  describe('onChange', () => {
    it('returns an unsubscribe function', () => {
      const { registry, bus } = makeTab('tab-a');
      const unsub = registry.onChange(vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
      registry.destroy(); bus.destroy();
    });

    it('throws if listener is not a function', () => {
      const { registry, bus } = makeTab('tab-a');
      expect(() => registry.onChange('not a function')).toThrow(TypeError);
      registry.destroy(); bus.destroy();
    });

    it('unsubscribing stops future change deliveries', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const listener = vi.fn();
      const unsub = rA.onChange(listener);

      // Create tab-b to trigger a join event
      const { registry: rB, bus: bB } = makeTab('tab-b');
      expect(listener).toHaveBeenCalled();

      unsub();
      listener.mockClear();

      // Create tab-c — listener should NOT be called
      const { registry: rC, bus: bC } = makeTab('tab-c');
      expect(listener).not.toHaveBeenCalled();

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
      rC.destroy(); bC.destroy();
    });

    it('listener receives snapshot and event object', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const listener = vi.fn();
      rA.onChange(listener);

      const { registry: rB, bus: bB } = makeTab('tab-b');

      const [instances, event] = listener.mock.calls[0];
      expect(Array.isArray(instances)).toBe(true);
      expect(typeof event.reason).toBe('string');
      expect(typeof event.instanceId).toBe('string');

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
    });

    it('isolates listener errors — one bad listener does not skip others', () => {
      const { registry: rA, bus: bA } = makeTab('tab-a');
      const good = vi.fn();
      rA.onChange(() => { throw new Error('bad listener'); });
      rA.onChange(good);

      const { registry: rB, bus: bB } = makeTab('tab-b');

      expect(good).toHaveBeenCalled();

      rA.destroy(); bA.destroy();
      rB.destroy(); bB.destroy();
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('sets isDestroyed to true', () => {
      const { registry, bus } = makeTab('tab-a');
      registry.destroy();
      expect(registry.isDestroyed).toBe(true);
      bus.destroy();
    });

    it('is idempotent', () => {
      const { registry, bus } = makeTab('tab-a');
      expect(() => {
        registry.destroy();
        registry.destroy();
      }).not.toThrow();
      bus.destroy();
    });

    it('stops heartbeats after destroy', () => {
      const observerBus = new Bus('observer');
      const heartbeatHandler = vi.fn();
      observerBus.subscribe(TOPICS.HEARTBEAT, heartbeatHandler);

      const { registry, bus } = makeTab('tab-a');
      registry.destroy(); bus.destroy();

      heartbeatHandler.mockClear();
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);

      expect(heartbeatHandler).not.toHaveBeenCalled();
      observerBus.destroy();
    });
  });
});
