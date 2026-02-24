/**
 * Bus.js — pub/sub wrapper around the native BroadcastChannel API.
 *
 * Design goals:
 *  - Topic-based routing so subscribers only receive what they care about
 *  - Transparent local echo: publish() delivers to same-tab subscribers too,
 *    because BroadcastChannel only fires on OTHER tabs. Without local echo,
 *    components in the same tab would need two registration paths.
 *  - Typed envelopes so every message carries consistent metadata (instanceId,
 *    timestamp) regardless of topic.
 *  - Clean teardown via destroy() — important in a userscript that may be
 *    re-injected or navigated away from.
 *
 * Usage:
 *   const bus = new Bus('my-instance-id');
 *   const unsub = bus.subscribe('my:topic', (payload, envelope) => { ... });
 *   bus.publish('my:topic', { data: 42 });
 *   unsub(); // stop receiving
 *   bus.destroy(); // close BroadcastChannel, clear all subscribers
 */

import { CHANNEL_NAME } from './constants.js';

/**
 * @typedef {Object} BusEnvelope
 * @property {string} topic       - the routing topic string
 * @property {*}      payload     - caller-supplied message data
 * @property {string} instanceId  - UUID of the tab that published this message
 * @property {number} timestamp   - Date.now() at publish time
 */

export class Bus {
  /** @type {BroadcastChannel} */
  #channel;

  /**
   * Map of topic → Set of handler functions.
   * Using a Set prevents duplicate handler registration.
   * @type {Map<string, Set<Function>>}
   */
  #subscribers = new Map();

  /** @type {string} */
  #instanceId;

  /** @type {boolean} */
  #destroyed = false;

  /**
   * @param {string} instanceId - stable UUID for this tab, set by the Kernel
   *   (or by getOrCreateInstanceId() when used standalone).
   */
  constructor(instanceId) {
    if (!instanceId) {
      throw new Error('[Bus] instanceId is required');
    }
    this.#instanceId = instanceId;
    this.#channel = new BroadcastChannel(CHANNEL_NAME);

    // All inbound messages from OTHER tabs arrive here
    this.#channel.onmessage = (event) => this.#dispatch(event.data);

    // Surface BroadcastChannel errors (e.g., structured clone failures)
    this.#channel.onmessageerror = (event) => {
      console.error('[Bus] Failed to deserialize incoming message:', event);
    };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Publish a message to all subscribers on the given topic.
   *
   * Delivers to:
   *  1. Remote tabs via BroadcastChannel (async, next tick)
   *  2. Local same-tab subscribers synchronously (local echo)
   *
   * Local echo fires synchronously before the postMessage call returns,
   * which is intentional — it makes call ordering predictable in tests.
   *
   * @param {string} topic
   * @param {*} [payload]
   * @throws {Error} if the bus has been destroyed
   */
  publish(topic, payload) {
    if (this.#destroyed) {
      throw new Error(`[Bus] Cannot publish to destroyed bus (topic: "${topic}")`);
    }
    if (!topic || typeof topic !== 'string') {
      throw new TypeError(`[Bus] publish() topic must be a non-empty string (got: ${JSON.stringify(topic)})`);
    }

    /** @type {BusEnvelope} */
    const envelope = {
      topic,
      payload,
      instanceId: this.#instanceId,
      timestamp: Date.now(),
    };

    // Deliver locally first (synchronous)
    this.#dispatch(envelope);

    // Then broadcast to other tabs (asynchronous, structured clone)
    // postMessage will throw a DataCloneError if payload is not serializable.
    // We let that propagate — callers should ensure payload is JSON-safe.
    this.#channel.postMessage(envelope);
  }

  /**
   * Subscribe to a topic.
   *
   * The handler receives:
   *  - payload  — the data passed to publish()
   *  - envelope — the full BusEnvelope including instanceId and timestamp
   *
   * @param {string}   topic
   * @param {(payload: *, envelope: BusEnvelope) => void} handler
   * @returns {() => void} unsubscribe function — call to stop receiving messages
   */
  subscribe(topic, handler) {
    if (this.#destroyed) {
      throw new Error(`[Bus] Cannot subscribe on destroyed bus (topic: "${topic}")`);
    }
    if (!topic || typeof topic !== 'string') {
      throw new TypeError(`[Bus] subscribe() topic must be a non-empty string (got: ${JSON.stringify(topic)})`);
    }
    if (typeof handler !== 'function') {
      throw new TypeError(`[Bus] subscribe() handler must be a function`);
    }

    if (!this.#subscribers.has(topic)) {
      this.#subscribers.set(topic, new Set());
    }
    this.#subscribers.get(topic).add(handler);

    // Return a one-call unsubscribe closure
    return () => this.#removeHandler(topic, handler);
  }

  /**
   * Remove a specific handler from a topic.
   * Safe to call multiple times (idempotent).
   *
   * @param {string}   topic
   * @param {Function} handler
   */
  unsubscribe(topic, handler) {
    this.#removeHandler(topic, handler);
  }

  /**
   * The number of active subscribers across all topics.
   * Primarily useful for testing and diagnostics.
   *
   * @returns {number}
   */
  get subscriberCount() {
    let count = 0;
    for (const set of this.#subscribers.values()) {
      count += set.size;
    }
    return count;
  }

  /**
   * The instance ID this bus is operating under.
   * @returns {string}
   */
  get instanceId() {
    return this.#instanceId;
  }

  /**
   * Whether destroy() has been called.
   * @returns {boolean}
   */
  get isDestroyed() {
    return this.#destroyed;
  }

  /**
   * Tear down the BroadcastChannel and clear all subscribers.
   *
   * After destroy(), all publish() and subscribe() calls will throw.
   * Safe to call multiple times (idempotent after first call).
   */
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#channel.close();
    this.#subscribers.clear();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Route an envelope to all handlers registered for its topic.
   * Errors in individual handlers are caught and logged so one bad
   * handler doesn't block delivery to subsequent handlers.
   *
   * @param {BusEnvelope} envelope
   */
  #dispatch(envelope) {
    if (!envelope || typeof envelope.topic !== 'string') return;

    const handlers = this.#subscribers.get(envelope.topic);
    if (!handlers || handlers.size === 0) return;

    // Snapshot the set before iteration — handlers may call unsubscribe()
    // during their execution, which would mutate the set mid-loop.
    const snapshot = [...handlers];
    for (const handler of snapshot) {
      try {
        handler(envelope.payload, envelope);
      } catch (err) {
        console.error(
          `[Bus] Uncaught error in handler for topic "${envelope.topic}":`,
          err,
        );
      }
    }
  }

  /**
   * @param {string}   topic
   * @param {Function} handler
   */
  #removeHandler(topic, handler) {
    this.#subscribers.get(topic)?.delete(handler);
  }
}
