# BrowserOS / PipeBuilder

A userscript-based personal middleware system that runs entirely in the browser.

Build visual data pipelines between web pages and services using your authenticated browser sessions as infrastructure. No backend required.

---

## Vision

The web browser is already a powerful runtime with access to authenticated sessions, live DOM data, cross-origin storage, and async APIs. BrowserOS wraps that power with a structured pipeline execution layer — letting you describe automation logic visually, then have it run silently across tabs.

---

## Architecture

| Layer | Module | Status |
|-------|--------|--------|
| Bus + Instance Registry | `src/bus/` | **Complete** |
| Pipeline Store | `src/runtime/` | Planned |
| Runtime Engine | `src/runtime/` | Planned |
| DOM Picker | `src/picker/` | Planned |
| Studio UI | `src/studio/` | Planned |
| Adapters | `src/adapters/` | Planned |
| Kernel | `src/kernel/` | Planned |

---

## Bus Layer

The Bus is the nervous system of BrowserOS. It enables any tab to talk to any other tab on the same origin, and maintains a live manifest of which tabs are active.

### Components

**`Bus`** (`src/bus/Bus.js`)

A thin, testable pub/sub wrapper around the native [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) API.

```js
import { Bus } from './src/bus/Bus.js';

const bus = new Bus('my-instance-uuid');

// Subscribe
const unsub = bus.subscribe('my:topic', (payload, envelope) => {
  console.log(payload);          // your data
  console.log(envelope.instanceId); // which tab sent it
});

// Publish — delivers to local subscribers AND all other tabs
bus.publish('my:topic', { value: 42 });

// Unsubscribe
unsub();

// Teardown
bus.destroy();
```

Key design decisions:
- **Local echo**: `publish()` delivers to same-tab subscribers synchronously, then broadcasts to other tabs via `BroadcastChannel.postMessage`. Without local echo, components in the same tab would need dual registration.
- **Snapshot-before-iterate**: The dispatch loop takes a snapshot of the subscriber set before iterating, so handlers may safely call `unsubscribe()` without disrupting delivery.
- **Handler isolation**: Errors in individual handlers are caught and logged; one bad handler does not block delivery to subsequent handlers.

---

**`InstanceRegistry`** (`src/bus/InstanceRegistry.js`)

Maintains a live manifest of all active BrowserOS tabs on the same origin.

```js
import { Bus } from './src/bus/Bus.js';
import { InstanceRegistry } from './src/bus/InstanceRegistry.js';

const bus = new Bus(myInstanceId);
const registry = new InstanceRegistry(bus, { url: location.href });

// Watch for changes
const unsub = registry.onChange((instances, event) => {
  console.log(`${event.reason}: ${event.instanceId}`);
  console.log('Active tabs:', instances);
});

// Update this tab's identity
registry.updateRole('scraper');
registry.updatePipeline('pipeline-abc123');
registry.updateMeta({ currentUrl: location.href });

// Query the registry
registry.getInstances();   // all known tabs
registry.getSelf();        // this tab's record
registry.getInstance(id);  // one specific tab
registry.size;             // count

// Teardown
registry.destroy();
```

Each `InstanceRecord` has the shape:
```js
{
  instanceId:    string,       // stable UUID for this tab session
  role:          string|null,  // semantic role ('scraper', 'aggregator', etc.)
  pipelineId:    string|null,  // pipeline this tab is currently running
  lastHeartbeat: number,       // local timestamp of last heartbeat received
  isSelf:        boolean,      // true only for the current tab
  meta:          object,       // { url, title, ...custom }
}
```

How it works:
1. On init, the tab registers itself locally and broadcasts `INSTANCE_JOIN`.
2. Every `HEARTBEAT_INTERVAL_MS` (5s), it broadcasts its current record.
3. **Welcome response**: when an existing tab hears a `INSTANCE_JOIN` from a previously-unknown tab, it immediately replies with a heartbeat. This means a newly-opened tab discovers all existing tabs within one message round-trip — no polling, no roster request needed.
4. A pruning loop runs at `HEARTBEAT_TIMEOUT_MS / 2` (9s). Instances whose last heartbeat is older than `HEARTBEAT_TIMEOUT_MS` (18s) are removed.
5. On page unload, `INSTANCE_LEAVE` is broadcast for a clean exit. Tabs that crash are pruned by the timeout mechanism.

Tab cloning is handled automatically: `sessionStorage` is tab-scoped, so cloned tabs start with fresh storage and receive a new UUID.

---

**Singleton factory** (`src/bus/index.js`)

For normal userscript use, call `initBusSystem()` once and `getBusSystem()` everywhere else.

```js
import { initBusSystem, getBusSystem, destroyBusSystem } from './src/bus/index.js';

// In the Kernel (called once at startup):
const { bus, registry, instanceId } = initBusSystem({
  meta: { url: location.href, title: document.title },
});

// Everywhere else:
const { bus, registry } = getBusSystem();
```

---

## Topics

All built-in topics are namespaced under `bos:` to avoid collisions.

| Constant | String | Description |
|----------|--------|-------------|
| `TOPICS.HEARTBEAT` | `bos:heartbeat` | Periodic alive signal with full instance record |
| `TOPICS.INSTANCE_JOIN` | `bos:instance:join` | Tab registered for the first time |
| `TOPICS.INSTANCE_LEAVE` | `bos:instance:leave` | Tab shutting down gracefully |
| `TOPICS.PIPELINE_EVENT` | `bos:pipeline:event` | Runtime execution events (reserved for Runtime layer) |

User-defined topics can be any string; convention is `<namespace>:<action>`.

---

## Project Structure

```
/src
  /utils
    uuid.js              UUID generation (crypto.randomUUID with fallbacks)
  /bus
    constants.js         Topic names, timing config
    Bus.js               BroadcastChannel pub/sub wrapper
    InstanceRegistry.js  Heartbeat-based live tab registry
    index.js             Singleton factory + public API
  /kernel                (planned) Tab identity, lifecycle bootstrapping
  /runtime               (planned) Pipeline store + execution engine
  /adapters              (planned) Source/destination plugins
  /picker                (planned) DOM element selector overlay
  /studio                (planned) Visual pipeline editor panel
/dist                    Bundled .user.js output
/docs                    Extended documentation
/tests
  /bus
    bus.test.js
    registry.test.js
/scripts
  build.js               esbuild bundler
```

---

## Development

```sh
npm install

# Run tests
npm test

# Watch mode
npm run test:watch

# Build userscript (once src/index.js exists)
npm run build
```

### Testing approach

The Bus layer has no external dependencies and is independently testable. `BroadcastChannel` is replaced with an in-memory mock in tests. Vitest fake timers are used to test heartbeat and pruning behavior without real delays.

---

## Known Limitations

### iOS / Mobile Safari

The primary target platform has specific constraints that affect the Bus layer:

**Background throttling** — iOS aggressively throttles JavaScript timers when a tab is in the background. A heartbeat set to fire every 5s may not fire for 30–60s. With the default 18s pruning timeout, background tabs will be removed from other tabs' registries while dormant. They will automatically re-appear once they become active again (the welcome-response pattern handles re-registration). If your use case requires persistent background tracking, increase `HEARTBEAT_TIMEOUT_MS` in `src/bus/constants.js` to 60,000+.

**`beforeunload` unreliability** — iOS Safari often kills pages without firing `beforeunload`. The `INSTANCE_LEAVE` broadcast on tab close is best-effort only. Other tabs will fall back to heartbeat timeout detection (~18s). Do not build logic that requires INSTANCE_LEAVE to be guaranteed.

**`BroadcastChannel` availability** — Requires iOS Safari 15.4+. The userscript will fail silently on older iOS versions unless a fallback is added. A future `Kernel` layer will detect and report this.

**Private Browsing** — `sessionStorage.setItem()` throws `QuotaExceededError` in Private Browsing mode on some browsers. BrowserOS catches this and emits a `console.warn`. The tab will still function correctly for the session but will generate a new UUID on each page load.

### Cross-origin

`BroadcastChannel` is origin-scoped. Tabs on different subdomains, schemes, or ports cannot communicate. All participating tabs must be on the exact same origin. This is a browser security constraint with no workaround.

### Payload serialization

All published payloads must be structured-clone-safe (essentially JSON-serializable). Publishing DOM nodes, functions, Symbols, or circular references will throw a `DataCloneError`. The local-echo path (same-tab delivery) does not use structured clone and will not throw, which can create confusing asymmetric behavior. Keep all payloads as plain JSON objects.

---

## Build target

Single `.user.js` file in `/dist`, consumable by:
- Tampermonkey (Chrome, Firefox)
- Violentmonkey (Chrome, Firefox)
- Userscripts app (iOS Safari)
- Orion browser (iOS/macOS)

Source is written as ES modules and bundled to IIFE via esbuild.

See [`docs/troubleshooting.md`](docs/troubleshooting.md) for detailed diagnosis of common failure modes.
