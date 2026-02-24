# BrowserOS — Troubleshooting Guide

This document covers real operational failure modes for the Bus and Instance Registry layers. Each entry describes the symptom, the root cause, and the fix or workaround.

---

## Bus

### Messages are not received by other tabs

**Symptom:** `bus.publish('my:topic', data)` runs without error, but subscribers in other tabs never fire.

**Possible causes:**

1. **Different origins.** BroadcastChannel is origin-scoped. Tabs on `https://example.com` and `http://example.com` (different scheme) or `https://sub.example.com` (different subdomain) are different origins and cannot communicate.

   Check: open DevTools → Application → Storage. The origin shown must be identical across all tabs.

2. **Channel name mismatch.** All Bus instances must use the same `CHANNEL_NAME` constant (`bos:bus:v1`). If you have multiple versions of the userscript installed simultaneously (e.g., old + new), they will have different singleton channel names and not see each other.

   Check: `CHANNEL_NAME` in `src/bus/constants.js`.

3. **Bus was never initialized.** If `initBusSystem()` was not called before publishing, `getBusSystem()` throws. Wrap in a try/catch to verify.

4. **Subscriber registered after publish.** `subscribe()` only receives messages published *after* registration. There is no message replay/history.

5. **Browser does not support BroadcastChannel.** Supported since: Chrome 54, Firefox 38, Safari 15.4, iOS Safari 15.4. Check `typeof BroadcastChannel !== 'undefined'` at runtime. Orion on iOS inherits WebKit, so it follows iOS Safari compatibility.

---

### Payload arrives as `undefined` in the handler

**Symptom:** Handler fires correctly but `payload` is always `undefined`.

**Cause:** `bus.publish('topic')` was called without a second argument. `payload` is optional by design — the call is valid. If your handler requires data, check the call site.

---

### DataCloneError when publishing

**Symptom:** `bus.publish(topic, payload)` throws `DataCloneError: The object could not be cloned`.

**Cause:** `BroadcastChannel.postMessage` uses the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm). Values that cannot be structured-cloned will throw:

- Functions (`() => {}`)
- DOM nodes (`document.querySelector(...)`)
- `Symbol` values
- Objects with circular references
- `Error` objects (supported in some browsers, not all)
- Proxies, WeakMaps, WeakSets

**Fix:** Ensure all published payloads are JSON-safe plain objects. If you need to pass non-serializable state, serialize it first (e.g., convert DOM nodes to their CSS selectors).

Note: the local echo path (same-tab delivery) does NOT structured-clone, so a payload with a function will work for same-tab subscribers but throw for cross-tab delivery. This can cause confusing asymmetric behavior — keep all payloads JSON-safe.

---

### Handler fires twice for every publish

**Symptom:** A handler registered on the same Bus instance is called twice per `publish()` call.

**Cause:** You registered the same handler function reference twice via `subscribe()`. Bus uses a `Set` internally, so the same function reference is deduplicated — but two different function instances that do the same thing are not (e.g., two arrow functions `(p) => doSomething(p)` are different objects).

**Fix:** Store the return value of `subscribe()` (the unsub function) and call it before re-registering. Or store the handler in a variable so the same reference is reused.

---

### Handler fires twice: once local, once remote

**Symptom:** You publish from Tab A and have a subscriber in Tab A — it receives the message twice.

**Cause:** This should not happen. Bus delivers locally via `#dispatch()` and then calls `BroadcastChannel.postMessage()`. The sender does not receive its own `postMessage`. If you are seeing double delivery, you have two `Bus` instances open on the same page (same channel name), which means `initBusSystem()` was called twice or the singleton was bypassed with `new Bus(...)` directly.

**Fix:** Always use `initBusSystem()` / `getBusSystem()`. Never call `new Bus()` directly in application code.

---

## Instance Registry

### New tab does not appear in other tabs' registries

**Symptom:** After a tab opens and initializes, `registry.getInstances()` in existing tabs does not include it.

**Cause / Flow:**
- On init, the new tab broadcasts `INSTANCE_JOIN`
- Existing tabs hear this and reply with a heartbeat (welcome-response pattern)
- The new tab hears those replies and adds existing tabs to its registry

If this is not happening:
1. Check that all tabs are on the same origin (see above)
2. Check that all tabs ran `initBusSystem()` — tabs using the Bus passively (only subscribed, never published) will not send welcome responses
3. Check the browser console for `[Bus]` or `[InstanceRegistry]` errors

---

### Instances are being pruned too aggressively (false positives)

**Symptom:** Tabs disappear from the registry even though they are still open and active.

**Cause:** iOS (and sometimes Chrome on Android) aggressively throttles JavaScript timers in background tabs. A tab that is backgrounded may have its `setInterval` heartbeat delayed from 5s to 30s or more. With a timeout of 18s, this causes the tab to be pruned.

**Fix options** (choose based on your requirements):
- Increase `HEARTBEAT_TIMEOUT_MS` in `src/bus/constants.js` to a larger value (e.g., 60_000). This delays dead-tab detection but reduces false positives.
- Use the Page Visibility API in a future enhancement to pause/resume heartbeats: `document.addEventListener('visibilitychange', ...)`.
- Accept that background tabs may be temporarily pruned and re-appear when they resume. The welcome-response pattern means they rejoin automatically once active again.

Current timing defaults:

| Constant | Value | Meaning |
|----------|-------|---------|
| `HEARTBEAT_INTERVAL_MS` | 5,000ms | How often each tab announces itself |
| `HEARTBEAT_TIMEOUT_MS` | 18,000ms | After this without a heartbeat, the instance is removed |
| Prune check interval | 9,000ms | How often the pruning loop runs (½ × timeout) |

---

### Registry shows stale data (role, pipelineId, url)

**Symptom:** `registry.getInstance(id)` returns an outdated record for a peer tab.

**Cause:** Registry updates propagate only on heartbeat or on explicit `updateRole/updatePipeline/updateMeta` calls. If a peer updates its URL by navigating (which triggers a full page reload), the old tab's instance is removed and a new one is created. The registry record for the new instance will populate within one heartbeat cycle (~5s) or immediately on its `INSTANCE_JOIN` broadcast.

If a peer's metadata (like `document.title`) changes without a full navigation, the registry will not auto-detect this. The peer must call `registry.updateMeta({ title: document.title })` explicitly.

---

### `updateRole()` throws after the pipeline tears down

**Symptom:** `registry.updateRole('idle')` throws `[InstanceRegistry] Cannot mutate a destroyed registry`.

**Cause:** `registry.destroy()` was called before the `updateRole()` call. The registry protects against post-destroy mutation so it does not silently fail in an inconsistent state.

**Fix:** Check `registry.isDestroyed` before calling mutation methods, or structure teardown so mutations complete before `destroy()`.

---

### INSTANCE_LEAVE is not received by other tabs on page close

**Symptom:** A tab closes but peers still show it as alive until the heartbeat timeout prunes it.

**Cause:** `INSTANCE_LEAVE` is sent in a `beforeunload` handler. On iOS Safari, `beforeunload` is frequently suppressed — the page is killed by the OS without firing JavaScript. This is expected and by design: the heartbeat timeout serves as the fallback for ungraceful exits. See [MDN `beforeunload` notes](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event).

This is not a bug — it is a fundamental constraint of the browser environment. Do not build logic that requires INSTANCE_LEAVE to be reliable. Use the heartbeat timeout as the source of truth for liveness.

---

### Tab ID changes unexpectedly between page loads

**Symptom:** After refreshing a tab, the same tab appears with a new UUID.

**Cause:** This is intentional. `getOrCreateInstanceId()` stores the UUID in `sessionStorage`, which survives page refreshes within the same tab session but is cleared when the tab is closed and reopened. After a refresh, the same UUID is reused. After close+reopen, a new UUID is generated.

If the UUID changes on *refresh* (not close+reopen), the most likely cause is private/incognito mode, where `sessionStorage.setItem()` fails silently (or with a `QuotaExceededError` that is caught and warned), leaving the ID in memory only. In this case, each page load gets a fresh UUID. A `console.warn` is emitted when this happens — check the console.

---

### Multiple userscript versions running simultaneously

**Symptom:** Unexpected duplicate messages, inconsistent registry state, tabs appearing multiple times.

**Cause:** If both an old and new version of the userscript are active (e.g., Tampermonkey/Violentmonkey has both enabled), two Bus singletons are running in the same tab on the same channel. They will both receive all messages and both maintain separate instance registries.

**Fix:** Disable all but one version of the userscript in your userscript manager. Check for duplicate entries in the extensions/userscripts settings panel.

---

## Environment / Browser Compatibility

| Feature | Chrome | Firefox | Safari | iOS Safari | Orion (iOS) |
|---------|--------|---------|--------|------------|-------------|
| `BroadcastChannel` | 54+ | 38+ | 15.4+ | 15.4+ | Yes (WebKit) |
| `crypto.randomUUID` | 92+ | 95+ | 15.4+ | 15.4+ | Yes |
| `crypto.getRandomValues` | 37+ | 26+ | 7+ | 7+ | Yes |
| `sessionStorage` | All | All | All | All | Yes |
| `beforeunload` reliable | Yes | Yes | Partial | No | No |
| Background timer throttling | Mild | Mild | Aggressive | Very aggressive | Aggressive |

---

## Debugging Tips

**Log all bus traffic** for a session:
```js
const { bus } = getBusSystem();
const unsub = bus.subscribe('*', (payload, envelope) => {
  // Note: '*' is not a wildcard — this only fires for the literal topic '*'
});
// Instead, to observe ALL topics, patch bus temporarily:
const original = bus.publish.bind(bus);
bus.publish = (topic, payload) => {
  console.debug('[BUS]', topic, payload);
  return original(topic, payload);
};
```

**Inspect the live registry** from DevTools console:
```js
// After initBusSystem() has run:
const { registry } = BrowserOS.getBusSystem(); // if built as IIFE
console.table(registry.getInstances());
```

**Check heartbeat timing** — if you suspect background throttling:
```js
const { bus } = getBusSystem();
bus.subscribe('bos:heartbeat', (payload, envelope) => {
  const lag = Date.now() - envelope.timestamp;
  if (lag > 10_000) {
    console.warn(`[BOS] Heartbeat lag: ${lag}ms from ${payload.instanceId}`);
  }
});
```
