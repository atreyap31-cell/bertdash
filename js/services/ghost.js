// The ghost of your best run on a level.
//
// A recorded run is far too big to sit in the profile blob: that blob is
// rewritten every time the engine bumps a stat, so putting a few thousand
// frames in it would mean re-serialising megabytes many times a second. Ghosts
// therefore live in their own localStorage key per level, written only when a
// best time actually changes.
//
// They are stored as packed bytes rather than JSON for the same reason of
// size. A minute of running is about 1,800 samples; as JSON that is a few
// hundred kilobytes, and as nine bytes a sample it is sixteen.

/** Samples a second. Playback interpolates, so this does not have to be 60. */
export const GHOST_RATE = 30;

const KEY_PREFIX = 'bertdash.ghost.v1.';
const BYTES_PER_SAMPLE = 9;
const HEADER_BYTES = 4;
const FORMAT = 1;

/** Beyond this a run is long enough that the recording has dropped its start. */
const MAX_SAMPLES = 60 * GHOST_RATE * 8;   // eight minutes

// Flags packed into the sample's last byte.
const FACING = 1 << 0;
const SLIDING = 1 << 1;
const DIVING = 1 << 2;
const WALL = 1 << 3;
const WALL_RIGHT = 1 << 4;
const HAS_FOOD = 1 << 5;
const FOOD_AIR = 1 << 6;

/**
 * Positions are stored as int16. Levels are a few thousand pixels at most, but
 * a thrown bag can sail well outside one, and a value that wrapped would put
 * the ghost's bag on the opposite side of the level.
 */
const clampInt16 = n => Math.max(-32768, Math.min(32767, Math.round(n || 0)));

/**
 * Turns a recorder's frames into evenly spaced samples.
 *
 * Frames are walked by their recorded elapsed time rather than by index,
 * because the clock does not start until the first input — every frame spent
 * reading the level shares a timestamp of zero and must collapse to one
 * sample, or the ghost would run late by however long you hesitated.
 *
 * @returns {Uint8Array|null} null when the run cannot be represented honestly
 */
export function encodeGhost(frames, dropped = 0) {
  // A run long enough to have lost its opening frames cannot be replayed from
  // the start, and a ghost that begins in the middle is worse than none.
  if (dropped > 0 || !frames?.length) return null;

  const step = 1000 / GHOST_RATE;
  const samples = [];
  let cursor = 0;

  for (let want = 0; want < MAX_SAMPLES; want++) {
    const at = want * step;
    while (cursor + 1 < frames.length && frames[cursor + 1].t <= at) cursor++;
    samples.push(frames[cursor]);
    if (cursor >= frames.length - 1) break;
  }
  if (samples.length < 2) return null;

  const bytes = new Uint8Array(HEADER_BYTES + samples.length * BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  bytes[0] = FORMAT;
  bytes[1] = GHOST_RATE;
  view.setUint16(2, samples.length, true);

  samples.forEach((f, i) => {
    const at = HEADER_BYTES + i * BYTES_PER_SAMPLE;
    view.setInt16(at, clampInt16(f.x), true);
    view.setInt16(at + 2, clampInt16(f.y), true);
    view.setInt16(at + 4, clampInt16(f.fx), true);
    view.setInt16(at + 6, clampInt16(f.fy), true);
    view.setUint8(at + 8,
      (f.face ? FACING : 0)
      | (f.slide ? SLIDING : 0)
      | (f.dive ? DIVING : 0)
      | (f.wall ? WALL : 0)
      | (f.wallDir > 0 ? WALL_RIGHT : 0)
      | (f.hasFood ? HAS_FOOD : 0)
      | (f.fair ? FOOD_AIR : 0));
  });
  return bytes;
}

/** @returns {{rate:number, samples:Array}|null} */
export function decodeGhost(bytes) {
  if (!bytes || bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== FORMAT) return null;

  const rate = view.getUint8(1) || GHOST_RATE;
  const count = view.getUint16(2, true);
  if (bytes.length < HEADER_BYTES + count * BYTES_PER_SAMPLE) return null;

  const samples = new Array(count);
  for (let i = 0; i < count; i++) {
    const at = HEADER_BYTES + i * BYTES_PER_SAMPLE;
    const flags = view.getUint8(at + 8);
    samples[i] = {
      x: view.getInt16(at, true),
      y: view.getInt16(at + 2, true),
      fx: view.getInt16(at + 4, true),
      fy: view.getInt16(at + 6, true),
      face: (flags & FACING) !== 0,
      slide: (flags & SLIDING) !== 0,
      dive: (flags & DIVING) !== 0,
      wall: (flags & WALL) !== 0,
      wallDir: (flags & WALL_RIGHT) !== 0 ? 1 : -1,
      hasFood: (flags & HAS_FOOD) !== 0,
      fair: (flags & FOOD_AIR) !== 0,
    };
  }
  return { rate, samples };
}

// --- storage ---------------------------------------------------------------

const toBase64 = bytes => {
  // String.fromCharCode(...bytes) overflows the argument limit on anything
  // this size, so build it in chunks.
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(out);
};

const fromBase64 = text => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const keyFor = levelId => KEY_PREFIX + String(levelId);

/**
 * Stores a ghost, evicting other levels' ghosts if the quota is reached.
 *
 * A ghost is a luxury: losing one matters far less than failing to save a best
 * time, so every failure here is swallowed.
 *
 * @returns {boolean} whether it was stored
 */
export function saveGhost(levelId, bytes) {
  if (!bytes) return false;
  const encoded = toBase64(bytes);

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(keyFor(levelId), encoded);
      return true;
    } catch {
      // Almost certainly the quota. Drop the biggest ghost that is not this
      // level's and try again.
      if (!evictLargestGhost(keyFor(levelId))) return false;
    }
  }
  return false;
}

export function loadGhost(levelId) {
  try {
    const raw = localStorage.getItem(keyFor(levelId));
    return raw ? decodeGhost(fromBase64(raw)) : null;
  } catch {
    return null;   // corrupt or unreadable: behave as if there is no ghost
  }
}

export function hasGhost(levelId) {
  try {
    return localStorage.getItem(keyFor(levelId)) != null;
  } catch {
    return false;
  }
}

/** Every level with a saved best run, as its level id. */
export function listGhosts() {
  return ghostKeys().map(key => key.slice(KEY_PREFIX.length));
}

/**
 * Turns a saved best run into something the replay player can show.
 *
 * The ghost track already holds everything a replay needs to draw — where you
 * and the bag were, which way you faced, whether you were sliding, diving or
 * on a wall — so best runs are stored once and used for both. The fields the
 * ghost leaves out are either derivable (the player's height follows from
 * sliding) or purely cosmetic (buffs, flow), and a replay is decoration.
 *
 * @returns {{frames: Array, clips: Array, marks: Array, rate: number}|null}
 */
export function ghostToReel(ghost) {
  if (!ghost?.samples?.length) return null;
  const step = 1000 / ghost.rate;

  const frames = ghost.samples.map((s, i) => ({
    x: s.x, y: s.y, w: 32, h: s.slide ? 26 : 48,
    face: s.face, slide: s.slide, dive: s.dive, wall: s.wall, wallDir: s.wallDir,
    // Velocity only feeds the dive trail, and the recording does not carry it.
    vx: 0, vy: 0, veh: null,
    shield: false, magnet: false, speed: false, jump: false,
    hasFood: s.hasFood,
    fx: s.fx, fy: s.fy, fair: s.fair,
    t: i * step, flow: 0,
  }));

  return {
    frames,
    dropped: 0,
    marks: [],
    rate: ghost.rate,
    clips: [{ label: '', kind: 'run', at: 0, from: 0, to: frames.length - 1 }],
  };
}

export function clearGhosts() {
  try {
    for (const key of ghostKeys()) localStorage.removeItem(key);
  } catch { /* nothing worth reporting */ }
}

function ghostKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) keys.push(key);
  }
  return keys;
}

function evictLargestGhost(except) {
  let biggest = null;
  let size = 0;
  for (const key of ghostKeys()) {
    if (key === except) continue;
    const length = localStorage.getItem(key)?.length ?? 0;
    if (length > size) { size = length; biggest = key; }
  }
  if (!biggest) return false;
  localStorage.removeItem(biggest);
  return true;
}
