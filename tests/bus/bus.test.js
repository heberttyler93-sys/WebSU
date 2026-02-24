/**
 * bus.test.js — unit tests for src/bus/Bus.js
 *
 * BroadcastChannel is a browser API not available in Node.js. We replace it
 * with a simple in-memory mock that simulates cross-tab delivery by routing
 * postMessage to all OTHER MockBroadcastChannel instances sharing a channel name.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bus } from '../../src/bus/Bus.js';

// ─── Mock BroadcastChannel ─────────────────────────────────────────────────

class MockBroadcastChannel {
  static _registry = new Map(); // channelName → Set<MockBroadcastChannel>

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
    // Simulate delivery to all OTHER instances on same channel name
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Bus', () => {
  let bus;
  const INSTANCE_ID = 'test-instance-001';

  beforeEach(() => {
    MockBroadcastChannel._reset();
    bus = new Bus(INSTANCE_ID);
  });

  afterEach(() => {
    if (!bus.isDestroyed) bus.destroy();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('requires an instanceId', () => {
      expect(() => new Bus()).toThrow('[Bus] instanceId is required');
      expect(() => new Bus('')).toThrow('[Bus] instanceId is required');
    });

    it('exposes instanceId', () => {
      expect(bus.instanceId).toBe(INSTANCE_ID);
    });

    it('starts with zero subscribers', () => {
      expect(bus.subscriberCount).toBe(0);
    });

    it('is not destroyed on creation', () => {
      expect(bus.isDestroyed).toBe(false);
    });
  });

  // ── subscribe / unsubscribe ────────────────────────────────────────────────

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const unsub = bus.subscribe('test:topic', vi.fn());
      expect(typeof unsub).toBe('function');
    });

    it('throws if handler is not a function', () => {
      expect(() => bus.subscribe('topic', 'not a function')).toThrow(TypeError);
    });

    it('tracks subscriber count', () => {
      const unsub1 = bus.subscribe('a', vi.fn());
      const unsub2 = bus.subscribe('b', vi.fn());
      expect(bus.subscriberCount).toBe(2);

      unsub1();
      expect(bus.subscriberCount).toBe(1);

      unsub2();
      expect(bus.subscriberCount).toBe(0);
    });

    it('supports multiple handlers for the same topic', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe('multi', h1);
      bus.subscribe('multi', h2);

      bus.publish('multi', 'hello');
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('does not allow duplicate handler registration', () => {
      const handler = vi.fn();
      bus.subscribe('dup', handler);
      bus.subscribe('dup', handler); // same reference

      bus.publish('dup', 'x');
      // Should only be called once despite two subscribe() calls
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('stops delivery after calling the returned unsub function', () => {
      const handler = vi.fn();
      const unsub = bus.subscribe('test:topic', handler);

      bus.publish('test:topic', 'first');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      bus.publish('test:topic', 'second');
      expect(handler).toHaveBeenCalledTimes(1); // not called again
    });

    it('bus.unsubscribe() method also removes the handler', () => {
      const handler = vi.fn();
      bus.subscribe('topic', handler);
      bus.unsubscribe('topic', handler);

      bus.publish('topic', 'x');
      expect(handler).not.toHaveBeenCalled();
    });

    it('is idempotent — calling unsub twice does not throw', () => {
      const unsub = bus.subscribe('topic', vi.fn());
      expect(() => {
        unsub();
        unsub();
      }).not.toThrow();
    });

    it('unsubscribing inside a handler does not break delivery to other handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();

      let unsub1;
      // h1 unsubscribes itself during its first invocation
      unsub1 = bus.subscribe('race', () => {
        h1();
        unsub1();
      });
      bus.subscribe('race', h2);

      bus.publish('race', null);
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);

      bus.publish('race', null);
      expect(h1).toHaveBeenCalledTimes(1); // not called again
      expect(h2).toHaveBeenCalledTimes(2);
    });
  });

  // ── publish ────────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('delivers payload to local subscribers synchronously', () => {
      const handler = vi.fn();
      bus.subscribe('greet', handler);

      bus.publish('greet', { msg: 'hello' });

      expect(handler).toHaveBeenCalledOnce();
      const [payload, envelope] = handler.mock.calls[0];
      expect(payload).toEqual({ msg: 'hello' });
      expect(envelope.topic).toBe('greet');
      expect(envelope.instanceId).toBe(INSTANCE_ID);
      expect(typeof envelope.timestamp).toBe('number');
    });

    it('does not deliver to handlers on different topics', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe('topic:a', h1);
      bus.subscribe('topic:b', h2);

      bus.publish('topic:a', 'data');
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).not.toHaveBeenCalled();
    });

    it('delivers to remote tabs via BroadcastChannel', () => {
      const remoteBus = new Bus('remote-instance');
      const remoteHandler = vi.fn();
      remoteBus.subscribe('cross:tab', remoteHandler);

      bus.publish('cross:tab', { value: 42 });

      expect(remoteHandler).toHaveBeenCalledOnce();
      expect(remoteHandler.mock.calls[0][0]).toEqual({ value: 42 });

      remoteBus.destroy();
    });

    it('does NOT deliver to self via BroadcastChannel (only via local echo)', () => {
      // The local echo path fires before postMessage; remote tabs also get it.
      // But the sender should NOT receive its own postMessage() back.
      // We verify the handler is called exactly once (local echo), not twice.
      const handler = vi.fn();
      bus.subscribe('echo:test', handler);

      bus.publish('echo:test', 'ping');

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws after destroy()', () => {
      bus.destroy();
      expect(() => bus.publish('topic', 'x')).toThrow('[Bus] Cannot publish to destroyed bus');
    });

    it('handles undefined payload gracefully', () => {
      const handler = vi.fn();
      bus.subscribe('no-payload', handler);
      expect(() => bus.publish('no-payload')).not.toThrow();
      expect(handler.mock.calls[0][0]).toBeUndefined();
    });

    it('isolates handler errors — one bad handler does not skip others', () => {
      const good = vi.fn();
      bus.subscribe('error:test', () => { throw new Error('bad handler'); });
      bus.subscribe('error:test', good);

      // Should not throw despite the bad handler
      expect(() => bus.publish('error:test', null)).not.toThrow();
      expect(good).toHaveBeenCalledOnce();
    });
  });

  // ── destroy ────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('sets isDestroyed to true', () => {
      bus.destroy();
      expect(bus.isDestroyed).toBe(true);
    });

    it('clears all subscribers', () => {
      bus.subscribe('a', vi.fn());
      bus.subscribe('b', vi.fn());
      expect(bus.subscriberCount).toBe(2);

      bus.destroy();
      expect(bus.subscriberCount).toBe(0);
    });

    it('is idempotent', () => {
      expect(() => {
        bus.destroy();
        bus.destroy();
      }).not.toThrow();
    });

    it('throws on subscribe after destroy', () => {
      bus.destroy();
      expect(() => bus.subscribe('topic', vi.fn())).toThrow(
        '[Bus] Cannot subscribe on destroyed bus',
      );
    });
  });
});
