// ==UserScript==
// @name         BrowserOS
// @namespace    https://github.com/heberttyler93/WebSU
// @version      0.1.0
// @description  Personal browser middleware — visual pipeline builder using authenticated sessions
// @author       heberttyler93
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

var BrowserOS = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __accessCheck = (obj, member, msg) => {
    if (!member.has(obj))
      throw TypeError("Cannot " + msg);
  };
  var __privateGet = (obj, member, getter) => {
    __accessCheck(obj, member, "read from private field");
    return getter ? getter.call(obj) : member.get(obj);
  };
  var __privateAdd = (obj, member, value) => {
    if (member.has(obj))
      throw TypeError("Cannot add the same private member more than once");
    member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  };
  var __privateSet = (obj, member, value, setter) => {
    __accessCheck(obj, member, "write to private field");
    setter ? setter.call(obj, value) : member.set(obj, value);
    return value;
  };
  var __privateMethod = (obj, member, method) => {
    __accessCheck(obj, member, "access private method");
    return method;
  };

  // src/index.js
  var src_exports = {};
  __export(src_exports, {
    bus: () => bus,
    instanceId: () => instanceId,
    registry: () => registry
  });

  // src/bus/constants.js
  var CHANNEL_NAME = "bos:bus:v1";
  var HEARTBEAT_INTERVAL_MS = 5e3;
  var HEARTBEAT_TIMEOUT_MS = 18e3;
  var TOPIC_PREFIX = "bos:";
  var TOPICS = {
    HEARTBEAT: `${TOPIC_PREFIX}heartbeat`,
    INSTANCE_JOIN: `${TOPIC_PREFIX}instance:join`,
    INSTANCE_LEAVE: `${TOPIC_PREFIX}instance:leave`,
    PIPELINE_EVENT: `${TOPIC_PREFIX}pipeline:event`
  };

  // src/bus/Bus.js
  var _channel, _subscribers, _instanceId, _destroyed, _dispatch, dispatch_fn, _removeHandler, removeHandler_fn;
  var Bus = class {
    /**
     * @param {string} instanceId - stable UUID for this tab, set by the Kernel
     *   (or by getOrCreateInstanceId() when used standalone).
     */
    constructor(instanceId2) {
      // ─── Private ───────────────────────────────────────────────────────────────
      /**
       * Route an envelope to all handlers registered for its topic.
       * Errors in individual handlers are caught and logged so one bad
       * handler doesn't block delivery to subsequent handlers.
       *
       * @param {BusEnvelope} envelope
       */
      __privateAdd(this, _dispatch);
      /**
       * @param {string}   topic
       * @param {Function} handler
       */
      __privateAdd(this, _removeHandler);
      /** @type {BroadcastChannel} */
      __privateAdd(this, _channel, void 0);
      /**
       * Map of topic → Set of handler functions.
       * Using a Set prevents duplicate handler registration.
       * @type {Map<string, Set<Function>>}
       */
      __privateAdd(this, _subscribers, /* @__PURE__ */ new Map());
      /** @type {string} */
      __privateAdd(this, _instanceId, void 0);
      /** @type {boolean} */
      __privateAdd(this, _destroyed, false);
      if (!instanceId2) {
        throw new Error("[Bus] instanceId is required");
      }
      __privateSet(this, _instanceId, instanceId2);
      __privateSet(this, _channel, new BroadcastChannel(CHANNEL_NAME));
      __privateGet(this, _channel).onmessage = (event) => __privateMethod(this, _dispatch, dispatch_fn).call(this, event.data);
      __privateGet(this, _channel).onmessageerror = (event) => {
        console.error("[Bus] Failed to deserialize incoming message:", event);
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
      if (__privateGet(this, _destroyed)) {
        throw new Error(`[Bus] Cannot publish to destroyed bus (topic: "${topic}")`);
      }
      if (!topic || typeof topic !== "string") {
        throw new TypeError(`[Bus] publish() topic must be a non-empty string (got: ${JSON.stringify(topic)})`);
      }
      const envelope = {
        topic,
        payload,
        instanceId: __privateGet(this, _instanceId),
        timestamp: Date.now()
      };
      __privateMethod(this, _dispatch, dispatch_fn).call(this, envelope);
      __privateGet(this, _channel).postMessage(envelope);
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
      if (__privateGet(this, _destroyed)) {
        throw new Error(`[Bus] Cannot subscribe on destroyed bus (topic: "${topic}")`);
      }
      if (!topic || typeof topic !== "string") {
        throw new TypeError(`[Bus] subscribe() topic must be a non-empty string (got: ${JSON.stringify(topic)})`);
      }
      if (typeof handler !== "function") {
        throw new TypeError(`[Bus] subscribe() handler must be a function`);
      }
      if (!__privateGet(this, _subscribers).has(topic)) {
        __privateGet(this, _subscribers).set(topic, /* @__PURE__ */ new Set());
      }
      __privateGet(this, _subscribers).get(topic).add(handler);
      return () => __privateMethod(this, _removeHandler, removeHandler_fn).call(this, topic, handler);
    }
    /**
     * Remove a specific handler from a topic.
     * Safe to call multiple times (idempotent).
     *
     * @param {string}   topic
     * @param {Function} handler
     */
    unsubscribe(topic, handler) {
      __privateMethod(this, _removeHandler, removeHandler_fn).call(this, topic, handler);
    }
    /**
     * The number of active subscribers across all topics.
     * Primarily useful for testing and diagnostics.
     *
     * @returns {number}
     */
    get subscriberCount() {
      let count = 0;
      for (const set of __privateGet(this, _subscribers).values()) {
        count += set.size;
      }
      return count;
    }
    /**
     * The instance ID this bus is operating under.
     * @returns {string}
     */
    get instanceId() {
      return __privateGet(this, _instanceId);
    }
    /**
     * Whether destroy() has been called.
     * @returns {boolean}
     */
    get isDestroyed() {
      return __privateGet(this, _destroyed);
    }
    /**
     * Tear down the BroadcastChannel and clear all subscribers.
     *
     * After destroy(), all publish() and subscribe() calls will throw.
     * Safe to call multiple times (idempotent after first call).
     */
    destroy() {
      if (__privateGet(this, _destroyed))
        return;
      __privateSet(this, _destroyed, true);
      __privateGet(this, _channel).close();
      __privateGet(this, _subscribers).clear();
    }
  };
  _channel = new WeakMap();
  _subscribers = new WeakMap();
  _instanceId = new WeakMap();
  _destroyed = new WeakMap();
  _dispatch = new WeakSet();
  dispatch_fn = function(envelope) {
    if (!envelope || typeof envelope.topic !== "string")
      return;
    const handlers = __privateGet(this, _subscribers).get(envelope.topic);
    if (!handlers || handlers.size === 0)
      return;
    const snapshot = [...handlers];
    for (const handler of snapshot) {
      try {
        handler(envelope.payload, envelope);
      } catch (err) {
        console.error(
          `[Bus] Uncaught error in handler for topic "${envelope.topic}":`,
          err
        );
      }
    }
  };
  _removeHandler = new WeakSet();
  removeHandler_fn = function(topic, handler) {
    var _a;
    (_a = __privateGet(this, _subscribers).get(topic)) == null ? void 0 : _a.delete(handler);
  };

  // src/bus/InstanceRegistry.js
  var _instances, _bus, _instanceId2, _heartbeatTimer, _pruneTimer, _unsubs, _changeListeners, _destroyed2, _setupSubscriptions, setupSubscriptions_fn, _registerSelf, registerSelf_fn, _startHeartbeat, startHeartbeat_fn, _startPruning, startPruning_fn, _pruneDeadInstances, pruneDeadInstances_fn, _upsertFromPayload, upsertFromPayload_fn, _buildPayload, buildPayload_fn, _notifyChange, notifyChange_fn, _onUnload, _mutateSelf, mutateSelf_fn;
  var InstanceRegistry = class {
    /**
     * @param {import('./Bus.js').Bus} bus - initialized Bus instance
     * @param {Object} [initialMeta={}]   - optional metadata for self (url, title, etc.)
     *   This is kept separate from the constructor signature so callers can pass
     *   browser globals lazily without coupling this module to the browser env.
     */
    constructor(bus2, initialMeta = {}) {
      // ─── Private: initialization ───────────────────────────────────────────────
      __privateAdd(this, _setupSubscriptions);
      /**
       * Register this tab in the local map and announce to other tabs.
       * @param {Object} meta
       */
      __privateAdd(this, _registerSelf);
      // ─── Private: heartbeat ────────────────────────────────────────────────────
      __privateAdd(this, _startHeartbeat);
      // ─── Private: pruning ─────────────────────────────────────────────────────
      __privateAdd(this, _startPruning);
      __privateAdd(this, _pruneDeadInstances);
      // ─── Private: record management ───────────────────────────────────────────
      /**
       * Insert or update an instance record from a received payload.
       * Always uses local clock for lastHeartbeat (avoids clock skew between tabs).
       *
       * @param {InstanceRecord} payload
       * @param {boolean} notify - whether to fire a change event
       */
      __privateAdd(this, _upsertFromPayload);
      /**
       * Build a serializable snapshot of self suitable for broadcasting.
       * @returns {InstanceRecord}
       */
      __privateAdd(this, _buildPayload);
      // ─── Private: change notifications ────────────────────────────────────────
      /**
       * @param {RegistryChangeEvent['reason']} reason
       * @param {string} instanceId
       */
      __privateAdd(this, _notifyChange);
      // ─── Private helpers ──────────────────────────────────────────────────────
      /**
       * Apply a mutation to self's record, then broadcast the update.
       * All public mutation methods (updateRole, updatePipeline, updateMeta)
       * go through here for consistency.
       *
       * @param {(self: InstanceRecord) => void} mutator
       * @throws {Error} if the registry has been destroyed
       */
      __privateAdd(this, _mutateSelf);
      /** @type {Map<string, InstanceRecord>} instanceId → record */
      __privateAdd(this, _instances, /* @__PURE__ */ new Map());
      /** @type {import('./Bus.js').Bus} */
      __privateAdd(this, _bus, void 0);
      /** @type {string} */
      __privateAdd(this, _instanceId2, void 0);
      /** @type {ReturnType<typeof setInterval>|null} */
      __privateAdd(this, _heartbeatTimer, null);
      /** @type {ReturnType<typeof setInterval>|null} */
      __privateAdd(this, _pruneTimer, null);
      /**
       * Cleanup functions returned by bus.subscribe() calls.
       * Stored so we can unsubscribe during destroy().
       * @type {Array<() => void>}
       */
      __privateAdd(this, _unsubs, []);
      /**
       * Listeners for registry change events.
       * @type {Set<(instances: InstanceRecord[], event: RegistryChangeEvent) => void>}
       */
      __privateAdd(this, _changeListeners, /* @__PURE__ */ new Set());
      /** @type {boolean} */
      __privateAdd(this, _destroyed2, false);
      // ─── Private: lifecycle ────────────────────────────────────────────────────
      /**
       * Synchronous broadcast on page unload.
       *
       * Best-effort: BroadcastChannel.postMessage is synchronous so it typically
       * succeeds, but the browser may suppress it if the page is being killed
       * (especially on iOS Safari). Other tabs will eventually prune this instance
       * via the heartbeat timeout if the leave message is lost.
       *
       * NOTE: beforeunload is unreliable on iOS Safari — the page can be
       * suspended or terminated without firing it. Do not rely on INSTANCE_LEAVE
       * for correctness; it is an optimisation to speed up peer detection only.
       */
      __privateAdd(this, _onUnload, () => {
        if (__privateGet(this, _destroyed2) || __privateGet(this, _bus).isDestroyed)
          return;
        try {
          __privateGet(this, _bus).publish(TOPICS.INSTANCE_LEAVE, { instanceId: __privateGet(this, _instanceId2) });
        } catch {
        }
      });
      if (!bus2 || typeof bus2.publish !== "function") {
        throw new TypeError("[InstanceRegistry] bus must be a valid Bus instance");
      }
      __privateSet(this, _bus, bus2);
      __privateSet(this, _instanceId2, bus2.instanceId);
      __privateMethod(this, _setupSubscriptions, setupSubscriptions_fn).call(this);
      __privateMethod(this, _registerSelf, registerSelf_fn).call(this, initialMeta);
      __privateMethod(this, _startHeartbeat, startHeartbeat_fn).call(this);
      __privateMethod(this, _startPruning, startPruning_fn).call(this);
      if (typeof window !== "undefined") {
        window.addEventListener("beforeunload", __privateGet(this, _onUnload));
      }
    }
    // ─── Public API ────────────────────────────────────────────────────────────
    /**
     * Get a snapshot array of all currently known active instances.
     * Returns copies of records so callers cannot accidentally mutate registry state.
     *
     * @returns {InstanceRecord[]}
     */
    getInstances() {
      return Array.from(__privateGet(this, _instances).values()).map((r) => ({ ...r }));
    }
    /**
     * Get this tab's own registry record.
     * Returns a copy.
     *
     * @returns {InstanceRecord}
     */
    getSelf() {
      return { ...__privateGet(this, _instances).get(__privateGet(this, _instanceId2)) };
    }
    /**
     * Get an instance record by ID, or undefined if not known.
     * Returns a copy.
     *
     * @param {string} instanceId
     * @returns {InstanceRecord|undefined}
     */
    getInstance(instanceId2) {
      const record = __privateGet(this, _instances).get(instanceId2);
      return record ? { ...record } : void 0;
    }
    /**
     * Assign a semantic role to this tab.
     *
     * Roles are user-defined strings that the pipeline system uses to route
     * work. E.g. 'scraper', 'aggregator', 'renderer', 'controller'.
     *
     * Broadcasting immediately (not waiting for next heartbeat) ensures other
     * tabs see the updated role as fast as possible.
     *
     * @param {string|null} role
     */
    updateRole(role) {
      __privateMethod(this, _mutateSelf, mutateSelf_fn).call(this, (self) => {
        self.role = role;
      });
    }
    /**
     * Associate this tab with a running pipeline.
     * Pass null to clear the association.
     *
     * @param {string|null} pipelineId
     */
    updatePipeline(pipelineId) {
      __privateMethod(this, _mutateSelf, mutateSelf_fn).call(this, (self) => {
        self.pipelineId = pipelineId;
      });
    }
    /**
     * Merge additional metadata into this instance's meta object.
     * Shallow merge — nested objects are replaced, not merged.
     *
     * @param {Object} meta
     */
    updateMeta(meta) {
      __privateMethod(this, _mutateSelf, mutateSelf_fn).call(this, (self) => {
        self.meta = { ...self.meta, ...meta };
      });
    }
    /**
     * Subscribe to registry change events.
     *
     * The listener is called with:
     *  - instances: full snapshot of all current instances after the change
     *  - event:     { reason, instanceId } describing what changed
     *
     * @param {(instances: InstanceRecord[], event: RegistryChangeEvent) => void} listener
     * @returns {() => void} unsubscribe function
     */
    onChange(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("[InstanceRegistry] onChange listener must be a function");
      }
      __privateGet(this, _changeListeners).add(listener);
      return () => __privateGet(this, _changeListeners).delete(listener);
    }
    /**
     * Number of instances currently in the registry (including self).
     * @returns {number}
     */
    get size() {
      return __privateGet(this, _instances).size;
    }
    /**
     * Whether destroy() has been called.
     * @returns {boolean}
     */
    get isDestroyed() {
      return __privateGet(this, _destroyed2);
    }
    /**
     * Tear down all timers, event listeners, and bus subscriptions.
     *
     * Announces departure to other tabs before closing.
     * Safe to call multiple times.
     */
    destroy() {
      if (__privateGet(this, _destroyed2))
        return;
      __privateSet(this, _destroyed2, true);
      try {
        __privateGet(this, _bus).publish(TOPICS.INSTANCE_LEAVE, { instanceId: __privateGet(this, _instanceId2) });
      } catch {
      }
      clearInterval(__privateGet(this, _heartbeatTimer));
      clearInterval(__privateGet(this, _pruneTimer));
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", __privateGet(this, _onUnload));
      }
      __privateGet(this, _unsubs).forEach((unsub) => unsub());
      __privateSet(this, _unsubs, []);
      __privateGet(this, _changeListeners).clear();
      __privateGet(this, _instances).clear();
    }
  };
  _instances = new WeakMap();
  _bus = new WeakMap();
  _instanceId2 = new WeakMap();
  _heartbeatTimer = new WeakMap();
  _pruneTimer = new WeakMap();
  _unsubs = new WeakMap();
  _changeListeners = new WeakMap();
  _destroyed2 = new WeakMap();
  _setupSubscriptions = new WeakSet();
  setupSubscriptions_fn = function() {
    __privateGet(this, _unsubs).push(
      __privateGet(this, _bus).subscribe(TOPICS.HEARTBEAT, (payload) => {
        __privateMethod(this, _upsertFromPayload, upsertFromPayload_fn).call(this, payload, false);
      })
    );
    __privateGet(this, _unsubs).push(
      __privateGet(this, _bus).subscribe(TOPICS.INSTANCE_JOIN, (payload) => {
        const isNew = !__privateGet(this, _instances).has(payload.instanceId);
        __privateMethod(this, _upsertFromPayload, upsertFromPayload_fn).call(this, payload, false);
        if (isNew && payload.instanceId !== __privateGet(this, _instanceId2)) {
          __privateGet(this, _bus).publish(TOPICS.HEARTBEAT, __privateMethod(this, _buildPayload, buildPayload_fn).call(this));
        }
        __privateMethod(this, _notifyChange, notifyChange_fn).call(this, isNew ? "join" : "discovered", payload.instanceId);
      })
    );
    __privateGet(this, _unsubs).push(
      __privateGet(this, _bus).subscribe(TOPICS.INSTANCE_LEAVE, (payload) => {
        if (__privateGet(this, _instances).has(payload.instanceId)) {
          __privateGet(this, _instances).delete(payload.instanceId);
          __privateMethod(this, _notifyChange, notifyChange_fn).call(this, "leave", payload.instanceId);
        }
      })
    );
  };
  _registerSelf = new WeakSet();
  registerSelf_fn = function(meta) {
    const record = {
      instanceId: __privateGet(this, _instanceId2),
      role: null,
      pipelineId: null,
      lastHeartbeat: Date.now(),
      isSelf: true,
      meta: {
        url: typeof location !== "undefined" ? location.href : null,
        title: typeof document !== "undefined" ? document.title : null,
        ...meta
      }
    };
    __privateGet(this, _instances).set(__privateGet(this, _instanceId2), record);
    __privateGet(this, _bus).publish(TOPICS.INSTANCE_JOIN, __privateMethod(this, _buildPayload, buildPayload_fn).call(this));
  };
  _startHeartbeat = new WeakSet();
  startHeartbeat_fn = function() {
    __privateSet(this, _heartbeatTimer, setInterval(() => {
      if (__privateGet(this, _destroyed2) || __privateGet(this, _bus).isDestroyed) {
        clearInterval(__privateGet(this, _heartbeatTimer));
        __privateSet(this, _heartbeatTimer, null);
        return;
      }
      const self = __privateGet(this, _instances).get(__privateGet(this, _instanceId2));
      if (self) {
        self.lastHeartbeat = Date.now();
      }
      __privateGet(this, _bus).publish(TOPICS.HEARTBEAT, __privateMethod(this, _buildPayload, buildPayload_fn).call(this));
    }, HEARTBEAT_INTERVAL_MS));
  };
  _startPruning = new WeakSet();
  startPruning_fn = function() {
    __privateSet(this, _pruneTimer, setInterval(
      () => __privateMethod(this, _pruneDeadInstances, pruneDeadInstances_fn).call(this),
      HEARTBEAT_TIMEOUT_MS / 2
    ));
  };
  _pruneDeadInstances = new WeakSet();
  pruneDeadInstances_fn = function() {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;
    for (const [id, record] of __privateGet(this, _instances)) {
      if (id === __privateGet(this, _instanceId2))
        continue;
      if (record.lastHeartbeat < cutoff) {
        __privateGet(this, _instances).delete(id);
        __privateMethod(this, _notifyChange, notifyChange_fn).call(this, "timeout", id);
        console.debug(`[InstanceRegistry] Pruned timed-out instance: ${id}`);
      }
    }
  };
  _upsertFromPayload = new WeakSet();
  upsertFromPayload_fn = function(payload, notify) {
    if (!payload || !payload.instanceId)
      return;
    const existed = __privateGet(this, _instances).has(payload.instanceId);
    const isSelf = payload.instanceId === __privateGet(this, _instanceId2);
    __privateGet(this, _instances).set(payload.instanceId, {
      ...payload,
      lastHeartbeat: Date.now(),
      // local clock, not sender's
      isSelf
    });
    if (notify && !existed) {
      __privateMethod(this, _notifyChange, notifyChange_fn).call(this, "discovered", payload.instanceId);
    }
  };
  _buildPayload = new WeakSet();
  buildPayload_fn = function() {
    return { ...__privateGet(this, _instances).get(__privateGet(this, _instanceId2)) };
  };
  _notifyChange = new WeakSet();
  notifyChange_fn = function(reason, instanceId2) {
    if (__privateGet(this, _changeListeners).size === 0)
      return;
    const snapshot = this.getInstances();
    const event = { reason, instanceId: instanceId2 };
    for (const listener of __privateGet(this, _changeListeners)) {
      try {
        listener(snapshot, event);
      } catch (err) {
        console.error("[InstanceRegistry] Error in change listener:", err);
      }
    }
  };
  _onUnload = new WeakMap();
  _mutateSelf = new WeakSet();
  mutateSelf_fn = function(mutator) {
    if (__privateGet(this, _destroyed2)) {
      throw new Error("[InstanceRegistry] Cannot mutate a destroyed registry");
    }
    const self = __privateGet(this, _instances).get(__privateGet(this, _instanceId2));
    if (!self)
      return;
    mutator(self);
    self.lastHeartbeat = Date.now();
    __privateGet(this, _bus).publish(TOPICS.HEARTBEAT, __privateMethod(this, _buildPayload, buildPayload_fn).call(this));
    __privateMethod(this, _notifyChange, notifyChange_fn).call(this, "updated", __privateGet(this, _instanceId2));
  };

  // src/utils/uuid.js
  function generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = bytes[6] & 15 | 64;
      bytes[8] = bytes[8] & 63 | 128;
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0"));
      return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join("")
      ].join("-");
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  function getOrCreateInstanceId(storageKey = "bos:instanceId") {
    if (typeof sessionStorage === "undefined") {
      return generateUUID();
    }
    let id = sessionStorage.getItem(storageKey);
    if (!id) {
      id = generateUUID();
      try {
        sessionStorage.setItem(storageKey, id);
      } catch (err) {
        console.warn(
          `[BrowserOS] Could not persist instanceId to sessionStorage (${err.name}: ${err.message}). Tab identity will not survive a page refresh.`
        );
      }
    }
    return id;
  }

  // src/bus/index.js
  var _bus2 = null;
  var _registry = null;
  function initBusSystem(options = {}) {
    if (_bus2) {
      return getBusSystem();
    }
    const instanceId2 = options.instanceId ?? getOrCreateInstanceId(options.storageKey);
    _bus2 = new Bus(instanceId2);
    _registry = new InstanceRegistry(_bus2, options.meta ?? {});
    return { bus: _bus2, registry: _registry, instanceId: instanceId2 };
  }
  function getBusSystem() {
    if (!_bus2 || !_registry) {
      throw new Error(
        "[Bus] Bus system not initialized. Call initBusSystem() before getBusSystem()."
      );
    }
    return { bus: _bus2, registry: _registry, instanceId: _bus2.instanceId };
  }

  // src/index.js
  if (typeof BroadcastChannel === "undefined") {
    console.warn(
      "[BrowserOS] BroadcastChannel is not supported in this browser. Cross-tab communication will not work. Requires Safari 15.4+, Chrome 54+, or Firefox 38+."
    );
  }
  var { bus, registry, instanceId } = initBusSystem({
    meta: {
      url: location.href,
      title: document.title
    }
  });
  console.info(
    `[BrowserOS] Bus layer active.
  Instance ID : ${instanceId}
  Origin      : ${location.origin}
  Channel     : bos:bus:v1`
  );
  var badge = document.createElement("div");
  badge.id = "bos-badge";
  badge.title = "BrowserOS \u2014 tap for registry info";
  Object.assign(badge.style, {
    position: "fixed",
    bottom: "12px",
    right: "12px",
    zIndex: "2147483647",
    // maximum z-index
    background: "rgba(0,0,0,0.75)",
    color: "#7fff7f",
    fontFamily: "monospace",
    fontSize: "11px",
    padding: "4px 8px",
    borderRadius: "6px",
    cursor: "pointer",
    userSelect: "none",
    pointerEvents: "all",
    backdropFilter: "blur(4px)",
    lineHeight: "1.4",
    maxWidth: "200px",
    wordBreak: "break-all"
  });
  function renderBadge() {
    const instances = registry.getInstances();
    badge.textContent = `BOS \u2713  ${instanceId.slice(0, 8)}\u2026  [${instances.length} tab${instances.length !== 1 ? "s" : ""}]`;
  }
  renderBadge();
  registry.onChange(() => renderBadge());
  badge.addEventListener("click", () => {
    const instances = registry.getInstances();
    const lines = instances.map(
      (r) => {
        var _a;
        return `${r.isSelf ? "\u2192" : " "} ${r.instanceId.slice(0, 8)}  role:${r.role ?? "none"}  ${((_a = r.meta) == null ? void 0 : _a.url) ?? ""}`;
      }
    );
    console.info("[BrowserOS] Registry snapshot:\n" + lines.join("\n"));
    alert("[BrowserOS] Registry (" + instances.length + " tab" + (instances.length !== 1 ? "s" : "") + "):\n\n" + lines.join("\n"));
  });
  if (document.body) {
    document.body.appendChild(badge);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(badge));
  }
  return __toCommonJS(src_exports);
})();
