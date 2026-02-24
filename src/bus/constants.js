/**
 * constants.js — shared configuration and topic names for the Bus layer.
 *
 * All cross-tab message topics are defined here so they act as a contract
 * between publishers and subscribers. Changing a topic string here is the
 * only place it needs to change.
 */

/**
 * The BroadcastChannel name shared across all BrowserOS tabs on the same origin.
 * Using a namespaced name avoids collisions with other userscripts or site code.
 *
 * @type {string}
 */
export const CHANNEL_NAME = 'bos:bus:v1';

/**
 * How often each tab broadcasts its heartbeat to prove it's alive (ms).
 * Lower = faster detection of new tabs, higher CPU cost.
 *
 * @type {number}
 */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * After this duration without a heartbeat, a tab is considered dead and
 * pruned from the instance registry (ms).
 *
 * Must be significantly larger than HEARTBEAT_INTERVAL_MS to allow for
 * momentary browser jank or tab backgrounding throttling.
 * Rule of thumb: at least 3× HEARTBEAT_INTERVAL_MS.
 *
 * @type {number}
 */
export const HEARTBEAT_TIMEOUT_MS = 18_000;

/**
 * Topic namespace prefix. All internal Bus topics use this prefix so they
 * can be filtered separately from user-defined pipeline topics.
 *
 * @type {string}
 */
export const TOPIC_PREFIX = 'bos:';

/**
 * Built-in Bus topic names.
 *
 * HEARTBEAT     — periodic alive signal, carries the full instance record
 * INSTANCE_JOIN — broadcast when a tab first registers with the system
 * INSTANCE_LEAVE — broadcast when a tab gracefully shuts down
 * PIPELINE_EVENT — emitted by the Runtime Engine to report execution state
 *
 * @enum {string}
 */
export const TOPICS = {
  HEARTBEAT:      `${TOPIC_PREFIX}heartbeat`,
  INSTANCE_JOIN:  `${TOPIC_PREFIX}instance:join`,
  INSTANCE_LEAVE: `${TOPIC_PREFIX}instance:leave`,
  PIPELINE_EVENT: `${TOPIC_PREFIX}pipeline:event`,
};
