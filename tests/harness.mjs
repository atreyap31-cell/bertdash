// Headless harness: stubs just enough browser surface for the engine to run
// under `node --test`, and lets a test advance the loop frame by frame.

let now = 0;
let pendingFrame = null;

const noop = () => {};

// Long fuzz runs render tens of millions of canvas calls. Keeping them all
// exhausts memory and takes the whole process down, so the log is a bounded
// ring: recent calls for debugging, a total count for assertions.
const MAX_RECORDED_CALLS = 2000;

function makeContext() {
  // Ring buffer, not a growing array with shift(): a long fuzz run makes tens
  // of millions of draw calls, so both unbounded growth and an O(n) shift per
  // call are enough to take the process down.
  const calls = new Array(MAX_RECORDED_CALLS);
  const counts = new Map();
  let cursor = 0;
  let total = 0;
  const record = name => (...args) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    calls[cursor] = [name, args];
    cursor = (cursor + 1) % MAX_RECORDED_CALLS;
    total++;
  };
  const ctx = {
    counts,                              // name -> total times called
    get callCount() { return total; },   // total draw calls made
    /** The most recent calls, oldest first. */
    recentCalls() {
      return [...calls.slice(cursor), ...calls.slice(0, cursor)].filter(Boolean);
    },
    canvas: { width: 800, height: 600 },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
    save: record('save'), restore: record('restore'),
    translate: record('translate'), rotate: record('rotate'), scale: record('scale'),
    setTransform: record('setTransform'), ellipse: record('ellipse'),
    fillRect: record('fillRect'), strokeRect: record('strokeRect'), clearRect: record('clearRect'),
    beginPath: record('beginPath'), closePath: record('closePath'),
    moveTo: record('moveTo'), lineTo: record('lineTo'), arc: record('arc'), rect: record('rect'),
    fill: record('fill'), stroke: record('stroke'), clip: record('clip'),
    fillText: record('fillText'), setLineDash: record('setLineDash'),
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return ctx;
}

/**
 * A canvas stub.
 *
 * `record: false` returns a context whose methods do nothing at all. Long fuzz
 * runs make tens of millions of draw calls, and even bookkeeping that cheap
 * dominates the run — the invariants being checked never look at the drawing.
 */
export function makeCanvas({ record = true } = {}) {
  const listeners = new Map();
  return {
    width: 800,
    height: 600,
    _ctx: null,
    getContext() { this._ctx ??= (record ? makeContext() : makeNullContext()); return this._ctx; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    addEventListener: (type, fn) => { listeners.set(type, fn); },
    removeEventListener: type => { listeners.delete(type); },
    setPointerCapture: noop,
    releasePointerCapture: noop,
    hasPointerCapture: () => false,
    focus: noop,
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
  };
}

/** Installs the globals the engine touches. Call once per test file. */
function makeNullContext() {
  const ctx = {
    canvas: { width: 800, height: 600 },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  for (const name of [
    'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'ellipse',
    'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath',
    'moveTo', 'lineTo', 'arc', 'rect', 'fill', 'stroke', 'clip',
    'fillText', 'setLineDash',
  ]) ctx[name] = noop;
  return ctx;
}

export function installGlobals() {
  const windowListeners = new Map();
  const store = new Map();

  globalThis.performance ??= { now: () => now };
  globalThis.performance.now = () => now;

  globalThis.requestAnimationFrame = fn => { pendingFrame = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { pendingFrame = null; };

  globalThis.addEventListener = (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type).add(fn);
  };
  globalThis.removeEventListener = (type, fn) => windowListeners.get(type)?.delete(fn);
  globalThis.dispatchWindow = (type, event) =>
    windowListeners.get(type)?.forEach(fn => fn(event));

  // Enumeration matters: code that evicts old entries to make room walks the
  // keys, and a stub without length/key would let that go untested.
  globalThis.localStorage = {
    get length() { return store.size; },
    key: i => [...store.keys()][i] ?? null,
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem(key, value) {
      const text = String(value);
      if (globalThis.__storageQuota != null) {
        let used = text.length;
        for (const [k, v] of store) if (k !== key) used += v.length;
        if (used > globalThis.__storageQuota) {
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
      }
      store.set(key, text);
    },
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
  };

  globalThis.document = {
    visibilityState: 'visible',
    createElement: () => makeCanvas(),
    addEventListener: noop,
    activeElement: null,
    querySelector: () => null,
  };

  globalThis.location = { hostname: 'test' };
  globalThis.AudioContext = undefined;       // audio service degrades to silence
  globalThis.webkitAudioContext = undefined;
}

export const keys = {
  down: code => globalThis.dispatchWindow('keydown', { code, repeat: false, preventDefault: noop }),
  up: code => globalThis.dispatchWindow('keyup', { code, preventDefault: noop }),
};

/** Runs the game loop for `frames` display frames at a fixed 60Hz. */
export function advance(frames = 1, msPerFrame = 1000 / 60) {
  for (let i = 0; i < frames; i++) {
    now += msPerFrame;
    const fn = pendingFrame;
    pendingFrame = null;
    if (!fn) return i;
    fn(now);
  }
  return frames;
}

export function resetClock() {
  now = 0;
  pendingFrame = null;
}
