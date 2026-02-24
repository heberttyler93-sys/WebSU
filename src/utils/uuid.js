/**
 * uuid.js — UUID generation utility.
 *
 * Provides a reliable UUID v4 generator that works across all target
 * environments: modern desktop browsers, iOS Safari 14+, and Node.js
 * (for test environments). Falls back to a Math.random-based v4
 * implementation when crypto.randomUUID is unavailable.
 *
 * The Kernel is responsible for tab identity management, but this
 * utility is placed in /utils because both the Bus (pre-Kernel) and
 * the Kernel itself depend on it.
 */

/**
 * Generate a UUID v4 string.
 *
 * Preference order:
 *  1. crypto.randomUUID()  — available in all modern browsers + Node 14.17+
 *  2. crypto.getRandomValues() — available in older browsers / webviews
 *  3. Math.random() fallback — last resort, not cryptographically secure
 *
 * @returns {string} A UUID v4 string, e.g. "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateUUID() {
  // Path 1: native crypto.randomUUID (fastest, most correct)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Path 2: crypto.getRandomValues for older Safari / iOS webviews
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version bits (version 4)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant bits (variant 1)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }

  // Path 3: Math.random fallback — not cryptographically secure, but
  // sufficient for tab identity (no security requirement here)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create a persistent tab-scoped instance ID.
 *
 * sessionStorage is tab-isolated: cloned tabs start with a fresh
 * sessionStorage, so they naturally receive a new UUID without any
 * special handling. This is the intended behavior — each tab should
 * have a unique identity.
 *
 * @param {string} [storageKey='bos:instanceId'] - sessionStorage key to use
 * @returns {string} UUID stable for the lifetime of this tab session
 */
export function getOrCreateInstanceId(storageKey = 'bos:instanceId') {
  // Guard for non-browser environments (e.g., test runners without jsdom)
  if (typeof sessionStorage === 'undefined') {
    return generateUUID();
  }

  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = generateUUID();
    try {
      sessionStorage.setItem(storageKey, id);
    } catch (err) {
      // sessionStorage.setItem throws QuotaExceededError in two cases:
      //  1. Private/incognito browsing mode on some browsers (storage quota = 0)
      //  2. Storage is genuinely full
      // In either case, fall back to an in-memory ID. The tab will still work
      // correctly for this session; it just won't survive a page refresh.
      console.warn(
        '[BrowserOS] Could not persist instanceId to sessionStorage ' +
        `(${err.name}: ${err.message}). ` +
        'Tab identity will not survive a page refresh.',
      );
    }
  }
  return id;
}
