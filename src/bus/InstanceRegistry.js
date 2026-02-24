/**
 * InstanceRegistry.js — live manifest of active BrowserOS tabs.
 *
 * Problem this solves:
 *   In a multi-tab automation system, you need to know which tabs exist,
 *   what roles they play, and whether they're still alive. Tabs can be
 *   cloned, navigated, or crash without warning. The registry provides a
 *   continuously-maintained snapshot of reality.
 *
 * How it works:
 *   1. On init, the tab registers itself and broadcasts INSTANCE_JOIN.
 *   2. Every HEARTBEAT_INTERVAL_MS, it broadcasts its current record.
 *   3. The registry listens to heartbeats from all tabs and upserts their records.
 *   4. A pruning loop runs at half the timeout interval. Any instance whose
 *      lastHeartbeat is older than HEARTBEAT_TIMEOUT_MS is removed.
 *   5. On page unload, the tab broadcasts INSTANCE_LEAVE for a clean exit.
 *
 * Tab identity / cloning:
 *   sessionStorage is tab-scoped — when a tab is cloned (Ctrl+D, cmd+T from
 *   address bar, "duplicate tab"), the new tab starts with a fresh empty
 *   sessionStorage. getOrCreateInstanceId() will generate a new UUID for it.
 *   No special cloning detection logic is needed.
 *
 * Usage:
 *   const registry = new InstanceRegistry(bus, { url: location.href });
 *   registry.onChange((instances, event) => console.log(instances));
 *   registry.updateRole('scraper');
 *   registry.destroy(); // on teardown
 */

import { TOPICS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './constants.js';

/**
 * @typedef {Object} InstanceRecord
 * @property {string}      instanceId  - stable UUID for this tab session
 * @property {string|null} role        - semantic role, e.g. 'scraper', 'aggregator', 'ui'
 * @property {string|null} pipelineId  - ID of the pipeline this tab is currently running
 * @property {number}      lastHeartbeat - local clock timestamp of last heartbeat received
 * @property {boolean}     isSelf      - true only for the current tab's own record
 * @property {Object}      meta        - freeform metadata (url, title, user-defined)
 */

/**
 * @typedef {Object} RegistryChangeEvent
 * @property {'join'|'leave'|'timeout'|'discovered'|'updated'} reason
 * @property {string} instanceId - the instance that triggered the change
 */

export class InstanceRegistry {
  /** @type {Map<string, InstanceRecord>} instanceId → record */
  #instances = new Map();

  /** @type {import('./Bus.js').Bus} */
  #bus;

  /** @type {string} */
  #instanceId;

  /** @type {ReturnType<typeof setInterval>|null} */
  #heartbeatTimer = null;

  /** @type {ReturnType<typeof setInterval>|null} */
  #pruneTimer = null;

  /**
   * Cleanup functions returned by bus.subscribe() calls.
   * Stored so we can unsubscribe during destroy().
   * @type {Array<() => void>}
   */
  #unsubs = [];

  /**
   * Listeners for registry change events.
   * @type {Set<(instances: InstanceRecord[], event: RegistryChangeEvent) => void>}
   */
  #changeListeners = new Set();

  /** @type {boolean} */
  #destroyed = false;

  /**
   * @param {import('./Bus.js').Bus} bus - initialized Bus instance
   * @param {Object} [initialMeta={}]   - optional metadata for self (url, title, etc.)
   *   This is kept separate from the constructor signature so callers can pass
   *   browser globals lazily without coupling this module to the browser env.
   */
  constructor(bus, initialMeta = {}) {
    if (!bus || typeof bus.publish !== 'function') {
      throw new TypeError('[InstanceRegistry] bus must be a valid Bus instance');
    }

    this.#bus = bus;
    this.#instanceId = bus.instanceId;

    this.#setupSubscriptions();
    this.#registerSelf(initialMeta);
    this.#startHeartbeat();
    this.#startPruning();

    // Best-effort graceful leave on page unload.
    // Guard for non-browser environments (jsdom, test runners).
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.#onUnload);
    }
  }

  // ─── Private: initialization ───────────────────────────────────────────────

  #setupSubscriptions() {
    // HEARTBEAT: keep all known instances fresh
    this.#unsubs.push(
      this.#bus.subscribe(TOPICS.HEARTBEAT, (payload) => {
        this.#upsertFromPayload(payload, false);
      }),
    );

    // INSTANCE_JOIN: a new tab appeared — record it immediately without
    // waiting for its first heartbeat cycle.
    //
    // Welcome-response pattern: when we hear a JOIN from an instance we don't
    // know yet, we immediately broadcast our own heartbeat. This solves the
    // "missed announcement" problem: Tab-C was created after Tab-A already
    // announced, so Tab-C never heard Tab-A's JOIN. When Tab-A hears Tab-C's
    // JOIN it responds with a heartbeat, which Tab-C receives and uses to
    // discover Tab-A. All existing instances do the same, so a newly-created
    // tab quickly learns about every live peer within one message round-trip.
    this.#unsubs.push(
      this.#bus.subscribe(TOPICS.INSTANCE_JOIN, (payload) => {
        const isNew = !this.#instances.has(payload.instanceId);
        this.#upsertFromPayload(payload, false);

        if (isNew && payload.instanceId !== this.#instanceId) {
          // Reply immediately so the newcomer can discover us
          this.#bus.publish(TOPICS.HEARTBEAT, this.#buildPayload());
        }

        // Only emit 'join' for genuinely new instances; treat duplicate joins
        // (e.g., page refresh with same sessionStorage before it clears) as
        // discovery events
        this.#notifyChange(isNew ? 'join' : 'discovered', payload.instanceId);
      }),
    );

    // INSTANCE_LEAVE: tab is shutting down cleanly
    this.#unsubs.push(
      this.#bus.subscribe(TOPICS.INSTANCE_LEAVE, (payload) => {
        if (this.#instances.has(payload.instanceId)) {
          this.#instances.delete(payload.instanceId);
          this.#notifyChange('leave', payload.instanceId);
        }
      }),
    );
  }

  /**
   * Register this tab in the local map and announce to other tabs.
   * @param {Object} meta
   */
  #registerSelf(meta) {
    const record = {
      instanceId: this.#instanceId,
      role: null,
      pipelineId: null,
      lastHeartbeat: Date.now(),
      isSelf: true,
      meta: {
        url: typeof location !== 'undefined' ? location.href : null,
        title: typeof document !== 'undefined' ? document.title : null,
        ...meta,
      },
    };
    this.#instances.set(this.#instanceId, record);

    // Tell other tabs we exist. They may not know about us yet if they were
    // already running when this tab opened.
    this.#bus.publish(TOPICS.INSTANCE_JOIN, this.#buildPayload());
  }

  // ─── Private: heartbeat ────────────────────────────────────────────────────

  #startHeartbeat() {
    this.#heartbeatTimer = setInterval(() => {
      // Guard: if the underlying bus was destroyed externally (e.g., in tests
      // simulating a tab crash by calling bus.destroy() directly), bail out
      // and clear our own timer to stop further attempts.
      if (this.#destroyed || this.#bus.isDestroyed) {
        clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = null;
        return;
      }

      // Refresh our own lastHeartbeat before broadcasting so our record stays
      // fresh in our own map too (we won't receive our own broadcast)
      const self = this.#instances.get(this.#instanceId);
      if (self) {
        self.lastHeartbeat = Date.now();
      }
      this.#bus.publish(TOPICS.HEARTBEAT, this.#buildPayload());
    }, HEARTBEAT_INTERVAL_MS);
  }

  // ─── Private: pruning ─────────────────────────────────────────────────────

  #startPruning() {
    // Prune at half the timeout interval so we react promptly without
    // excessive checking. E.g. 18s timeout → prune every 9s.
    this.#pruneTimer = setInterval(
      () => this.#pruneDeadInstances(),
      HEARTBEAT_TIMEOUT_MS / 2,
    );
  }

  #pruneDeadInstances() {
    const cutoff = Date.now() - HEARTBEAT_TIMEOUT_MS;

    for (const [id, record] of this.#instances) {
      // Never prune self — we own our own liveness declaration
      if (id === this.#instanceId) continue;

      if (record.lastHeartbeat < cutoff) {
        this.#instances.delete(id);
        this.#notifyChange('timeout', id);
        console.debug(`[InstanceRegistry] Pruned timed-out instance: ${id}`);
      }
    }
  }

  // ─── Private: record management ───────────────────────────────────────────

  /**
   * Insert or update an instance record from a received payload.
   * Always uses local clock for lastHeartbeat (avoids clock skew between tabs).
   *
   * @param {InstanceRecord} payload
   * @param {boolean} notify - whether to fire a change event
   */
  #upsertFromPayload(payload, notify) {
    if (!payload || !payload.instanceId) return;

    const existed = this.#instances.has(payload.instanceId);
    const isSelf = payload.instanceId === this.#instanceId;

    this.#instances.set(payload.instanceId, {
      ...payload,
      lastHeartbeat: Date.now(), // local clock, not sender's
      isSelf,
    });

    if (notify && !existed) {
      this.#notifyChange('discovered', payload.instanceId);
    }
  }

  /**
   * Build a serializable snapshot of self suitable for broadcasting.
   * @returns {InstanceRecord}
   */
  #buildPayload() {
    // Spread to avoid giving subscribers a live reference to internal state
    return { ...this.#instances.get(this.#instanceId) };
  }

  // ─── Private: change notifications ────────────────────────────────────────

  /**
   * @param {RegistryChangeEvent['reason']} reason
   * @param {string} instanceId
   */
  #notifyChange(reason, instanceId) {
    if (this.#changeListeners.size === 0) return;

    const snapshot = this.getInstances();
    const event = { reason, instanceId };

    for (const listener of this.#changeListeners) {
      try {
        listener(snapshot, event);
      } catch (err) {
        console.error('[InstanceRegistry] Error in change listener:', err);
      }
    }
  }

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
  #onUnload = () => {
    // Guard: bus may have been destroyed by another beforeunload handler
    // or by explicit cleanup that ran before this fires.
    if (this.#destroyed || this.#bus.isDestroyed) return;
    try {
      this.#bus.publish(TOPICS.INSTANCE_LEAVE, { instanceId: this.#instanceId });
    } catch {
      // Swallow — unload path, nothing meaningful we can do
    }
  };

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Get a snapshot array of all currently known active instances.
   * Returns copies of records so callers cannot accidentally mutate registry state.
   *
   * @returns {InstanceRecord[]}
   */
  getInstances() {
    return Array.from(this.#instances.values()).map((r) => ({ ...r }));
  }

  /**
   * Get this tab's own registry record.
   * Returns a copy.
   *
   * @returns {InstanceRecord}
   */
  getSelf() {
    return { ...this.#instances.get(this.#instanceId) };
  }

  /**
   * Get an instance record by ID, or undefined if not known.
   * Returns a copy.
   *
   * @param {string} instanceId
   * @returns {InstanceRecord|undefined}
   */
  getInstance(instanceId) {
    const record = this.#instances.get(instanceId);
    return record ? { ...record } : undefined;
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
    this.#mutateSelf((self) => { self.role = role; });
  }

  /**
   * Associate this tab with a running pipeline.
   * Pass null to clear the association.
   *
   * @param {string|null} pipelineId
   */
  updatePipeline(pipelineId) {
    this.#mutateSelf((self) => { self.pipelineId = pipelineId; });
  }

  /**
   * Merge additional metadata into this instance's meta object.
   * Shallow merge — nested objects are replaced, not merged.
   *
   * @param {Object} meta
   */
  updateMeta(meta) {
    this.#mutateSelf((self) => { self.meta = { ...self.meta, ...meta }; });
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
    if (typeof listener !== 'function') {
      throw new TypeError('[InstanceRegistry] onChange listener must be a function');
    }
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  /**
   * Number of instances currently in the registry (including self).
   * @returns {number}
   */
  get size() {
    return this.#instances.size;
  }

  /**
   * Whether destroy() has been called.
   * @returns {boolean}
   */
  get isDestroyed() {
    return this.#destroyed;
  }

  /**
   * Tear down all timers, event listeners, and bus subscriptions.
   *
   * Announces departure to other tabs before closing.
   * Safe to call multiple times.
   */
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;

    // Announce graceful exit
    try {
      this.#bus.publish(TOPICS.INSTANCE_LEAVE, { instanceId: this.#instanceId });
    } catch {
      // Bus may already be destroyed; ignore
    }

    clearInterval(this.#heartbeatTimer);
    clearInterval(this.#pruneTimer);

    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.#onUnload);
    }

    this.#unsubs.forEach((unsub) => unsub());
    this.#unsubs = [];

    this.#changeListeners.clear();
    this.#instances.clear();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Apply a mutation to self's record, then broadcast the update.
   * All public mutation methods (updateRole, updatePipeline, updateMeta)
   * go through here for consistency.
   *
   * @param {(self: InstanceRecord) => void} mutator
   * @throws {Error} if the registry has been destroyed
   */
  #mutateSelf(mutator) {
    if (this.#destroyed) {
      throw new Error('[InstanceRegistry] Cannot mutate a destroyed registry');
    }
    const self = this.#instances.get(this.#instanceId);
    if (!self) return;

    mutator(self);
    self.lastHeartbeat = Date.now();

    // Immediate broadcast so peers don't have to wait for next heartbeat
    this.#bus.publish(TOPICS.HEARTBEAT, this.#buildPayload());
    this.#notifyChange('updated', this.#instanceId);
  }
}
