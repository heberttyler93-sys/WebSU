/**
 * src/bus/index.js — public API for the Bus layer.
 *
 * This module provides both the raw classes (for testing and advanced use)
 * and a singleton factory (initBusSystem / getBusSystem) for the normal
 * runtime path where exactly one Bus and one InstanceRegistry exist per tab.
 *
 * Singleton rationale:
 *   BroadcastChannel resources are per-name per-origin. Creating multiple
 *   Bus instances with the same channel name works (each gets its own
 *   channel handle) but is wasteful and confusing — every publish() would
 *   be received multiple times by same-tab subscribers. The singleton
 *   pattern enforces that the whole userscript shares one Bus.
 *
 * Initialization order:
 *   The Kernel calls initBusSystem() as its first act after assigning the
 *   instanceId. All other modules call getBusSystem() and can assume it's
 *   ready. During testing, initBusSystem() is called with a synthetic id.
 */

export { Bus } from './Bus.js';
export { InstanceRegistry } from './InstanceRegistry.js';
export {
  TOPICS,
  CHANNEL_NAME,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from './constants.js';

import { Bus } from './Bus.js';
import { InstanceRegistry } from './InstanceRegistry.js';
import { getOrCreateInstanceId } from '../utils/uuid.js';

/** @type {Bus|null} */
let _bus = null;

/** @type {InstanceRegistry|null} */
let _registry = null;

/**
 * @typedef {Object} BusSystem
 * @property {Bus}              bus      - the shared Bus instance
 * @property {InstanceRegistry} registry - the live instance registry
 * @property {string}           instanceId - this tab's UUID
 */

/**
 * Initialize the Bus system for this tab.
 *
 * Creates a Bus and an InstanceRegistry, registers this tab, and begins
 * heartbeat broadcasting. Calling this more than once returns the existing
 * system without re-initializing (idempotent).
 *
 * @param {Object} [options={}]
 * @param {string} [options.instanceId]   - override instance ID (useful for tests)
 * @param {Object} [options.meta={}]      - initial metadata for the self record
 * @param {string} [options.storageKey]   - sessionStorage key for instance ID
 * @returns {BusSystem}
 */
export function initBusSystem(options = {}) {
  if (_bus) {
    // Already initialized — return existing system
    return getBusSystem();
  }

  const instanceId =
    options.instanceId ?? getOrCreateInstanceId(options.storageKey);

  _bus = new Bus(instanceId);
  _registry = new InstanceRegistry(_bus, options.meta ?? {});

  return { bus: _bus, registry: _registry, instanceId };
}

/**
 * Get the already-initialized Bus system.
 *
 * @returns {BusSystem}
 * @throws {Error} if initBusSystem() has not been called yet
 */
export function getBusSystem() {
  if (!_bus || !_registry) {
    throw new Error(
      '[Bus] Bus system not initialized. Call initBusSystem() before getBusSystem().',
    );
  }
  return { bus: _bus, registry: _registry, instanceId: _bus.instanceId };
}

/**
 * Tear down the singleton Bus system.
 *
 * Calls destroy() on both the registry and the bus, then resets the module
 * state so initBusSystem() can be called again. Useful for hot-reloading
 * in development and for test teardown.
 */
export function destroyBusSystem() {
  if (_registry) {
    _registry.destroy();
    _registry = null;
  }
  if (_bus) {
    _bus.destroy();
    _bus = null;
  }
}

/**
 * True if the Bus system has been initialized and not yet destroyed.
 * @returns {boolean}
 */
export function isBusSystemActive() {
  return _bus !== null && !_bus.isDestroyed;
}
