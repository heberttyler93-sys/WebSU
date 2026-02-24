/**
 * src/index.js — BrowserOS userscript entry point.
 *
 * This is what gets bundled into dist/browseros.user.js.
 *
 * Current state: Bus + Instance Registry layer only.
 * Runtime, Studio, DOM Picker, and Adapters are not yet built.
 *
 * What this does right now:
 *  - Assigns a stable UUID to this tab via sessionStorage
 *  - Starts the Bus (BroadcastChannel pub/sub)
 *  - Registers this tab in the Instance Registry
 *  - Begins heartbeat broadcasting to other tabs
 *  - Shows a small diagnostic badge so you can confirm it's running on device
 */

import { initBusSystem } from './bus/index.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// Check for BroadcastChannel support before doing anything — iOS Safari < 15.4
// and some older WebViews don't have it.
if (typeof BroadcastChannel === 'undefined') {
  console.warn(
    '[BrowserOS] BroadcastChannel is not supported in this browser. ' +
    'Cross-tab communication will not work. ' +
    'Requires Safari 15.4+, Chrome 54+, or Firefox 38+.',
  );
}

const { bus, registry, instanceId } = initBusSystem({
  meta: {
    url: location.href,
    title: document.title,
  },
});

console.info(
  `[BrowserOS] Bus layer active.\n` +
  `  Instance ID : ${instanceId}\n` +
  `  Origin      : ${location.origin}\n` +
  `  Channel     : bos:bus:v1`,
);

// ─── Diagnostic badge ────────────────────────────────────────────────────────
//
// A small fixed badge confirms the script is running on-device where DevTools
// may not be available (e.g., iOS Safari). Tap to see the current registry.
// Removed once Studio UI is built.

const badge = document.createElement('div');
badge.id = 'bos-badge';
badge.title = 'BrowserOS — tap for registry info';

Object.assign(badge.style, {
  position:        'fixed',
  bottom:          '12px',
  right:           '12px',
  zIndex:          '2147483647',      // maximum z-index
  background:      'rgba(0,0,0,0.75)',
  color:           '#7fff7f',
  fontFamily:      'monospace',
  fontSize:        '11px',
  padding:         '4px 8px',
  borderRadius:    '6px',
  cursor:          'pointer',
  userSelect:      'none',
  pointerEvents:   'all',
  backdropFilter:  'blur(4px)',
  lineHeight:      '1.4',
  maxWidth:        '200px',
  wordBreak:       'break-all',
});

function renderBadge() {
  const instances = registry.getInstances();
  badge.textContent = `BOS ✓  ${instanceId.slice(0, 8)}…  [${instances.length} tab${instances.length !== 1 ? 's' : ''}]`;
}

renderBadge();
registry.onChange(() => renderBadge());

badge.addEventListener('click', () => {
  const instances = registry.getInstances();
  const lines = instances.map((r) =>
    `${r.isSelf ? '→' : ' '} ${r.instanceId.slice(0, 8)}  role:${r.role ?? 'none'}  ${r.meta?.url ?? ''}`
  );
  console.info('[BrowserOS] Registry snapshot:\n' + lines.join('\n'));
  alert('[BrowserOS] Registry (' + instances.length + ' tab' + (instances.length !== 1 ? 's' : '') + '):\n\n' + lines.join('\n'));
});

// Inject only after DOM is ready
if (document.body) {
  document.body.appendChild(badge);
} else {
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(badge));
}

// ─── Exports (available as BrowserOS.* when loaded as IIFE) ──────────────────

export { bus, registry, instanceId };
