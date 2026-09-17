// Headless harness: stubs just enough browser surface for the engine to run
// under `node --test`, and lets a test advance the loop frame by frame.

let now = 0;
let pendingFrame = null;

const noop = () => {};

function makeContext() {
  // Every canvas call the renderer makes, collected so a test can assert on
  // draw activity without needing a real 2D context.
  const calls = [];
  const record = name => (...args) => { calls.push([name, args]); };
  const ctx = {
    calls,
    canvas: { width: 800, height: 600 },
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0,
    save: record('save'), restore: record('restore'),
    translate: record('translate'), rotate: record('rotate'), scale: record('scale'),
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

export function makeCanvas() {
  const listeners = new Map();
  return {
    width: 800,
    height: 600,
    _ctx: null,
    getContext() { this._ctx ??= makeContext(); return this._ctx; },
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

  globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
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
