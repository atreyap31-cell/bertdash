// The best-run ghost: how a run is packed down to something that fits in
// storage, and how it plays back beside you.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, makeCanvas, advance, keys, resetClock } from './harness.mjs';

installGlobals();

const { Game } = await import('../js/engine/game.js');
const { Recorder } = await import('../js/engine/recorder.js');
const {
  encodeGhost, decodeGhost, saveGhost, loadGhost, hasGhost, clearGhosts, GHOST_RATE,
  listGhosts, ghostToReel,
} = await import('../js/services/ghost.js');

const FLOOR_Y = 500;

function fixture(overrides = {}) {
  return {
    id: 'test', title: 'Test', width: 4000, height: 700, background: '#101010',
    theme: 'horizontal', startPos: { x: 200, y: 400 }, goalPos: { x: 3800, y: 470 },
    foodPos: { x: 240, y: 400 }, physics: {}, vehicles: [], powerups: [], hints: [],
    platforms: [{ x: 0, y: FLOOR_Y, width: 4000, height: 200, type: 'static' }],
    ...overrides,
  };
}

function boot(options = {}) {
  resetClock();
  const recorder = new Recorder();
  const game = new Game(makeCanvas({ record: false }), fixture(), {
    skin: { color: '#06c167', textColor: '#fff' },
    recorder,
    onWin: () => {}, onLose: () => {}, onStats: () => {},
    ...options,
  });
  game.start();
  return { game, recorder };
}

/** Runs right for `frames` and returns the recording. */
function record(frames = 240) {
  const { game, recorder } = boot();
  keys.down('KeyD');
  advance(frames);
  keys.up('KeyD');
  game.destroy();
  return recorder;
}

// --- encoding --------------------------------------------------------------

test('a run survives a round trip through the packed format', () => {
  const recorder = record();
  const bytes = encodeGhost(recorder.frames, recorder.dropped);
  assert.ok(bytes, 'the run should encode');

  const ghost = decodeGhost(bytes);
  assert.equal(ghost.rate, GHOST_RATE);
  assert.ok(ghost.samples.length > 10, `expected samples, got ${ghost.samples.length}`);

  // Positions are stored as whole pixels, so allow a pixel of rounding.
  const first = ghost.samples[0];
  assert.ok(Math.abs(first.x - recorder.frames[0].x) <= 1,
    `first sample ${first.x} should match the run's start ${recorder.frames[0].x}`);
  assert.equal(first.hasFood, recorder.frames[0].hasFood);
});

test('packing a run is drastically smaller than keeping the frames', () => {
  const recorder = record(600);
  const bytes = encodeGhost(recorder.frames, recorder.dropped);
  const asJson = JSON.stringify(recorder.frames).length;
  assert.ok(bytes.length * 12 < asJson,
    `packed ${bytes.length}B should be far under JSON's ${asJson}B`);
});

test('the clock, not the frame count, drives the ghost', () => {
  // The timer does not start until the first input, so a run that sat still
  // for a while must not have that time baked into the ghost.
  const { game, recorder } = boot();
  advance(120);                       // two seconds of reading the level
  assert.equal(game.elapsed, 0, 'the clock should not have started');
  keys.down('KeyD');
  advance(120);
  keys.up('KeyD');
  game.destroy();

  const ghost = decodeGhost(encodeGhost(recorder.frames, recorder.dropped));
  // Two seconds of standing still collapse to the opening samples, so the
  // ghost should be moving well before sample 60.
  const moved = ghost.samples.findIndex(s => s.x > ghost.samples[0].x + 20);
  assert.ok(moved >= 0 && moved < 30,
    `the ghost should set off promptly, first moved at sample ${moved}`);
});

test('a run whose start was dropped is refused rather than saved misaligned', () => {
  const recorder = record(120);
  assert.equal(encodeGhost(recorder.frames, 500), null,
    'a recording missing its opening cannot be replayed from the start');
  assert.equal(encodeGhost([], 0), null);
  assert.equal(decodeGhost(new Uint8Array(2)), null);
});

// --- storage ---------------------------------------------------------------

test('a ghost can be stored and read back per level', () => {
  clearGhosts();
  const recorder = record();
  const bytes = encodeGhost(recorder.frames, recorder.dropped);

  assert.equal(hasGhost(7), false);
  assert.ok(saveGhost(7, bytes));
  assert.ok(hasGhost(7));

  const loaded = loadGhost(7);
  assert.ok(loaded);
  assert.equal(loaded.samples.length, decodeGhost(bytes).samples.length);
  assert.equal(loadGhost(8), null, 'other levels are unaffected');
  clearGhosts();
});

test('a full quota evicts another level rather than losing the new ghost', () => {
  clearGhosts();
  const bytes = encodeGhost(record(300).frames, 0);
  assert.ok(saveGhost(1, bytes));
  assert.ok(saveGhost(2, bytes));

  // Only room for about one ghost from here on.
  const stored = localStorage.getItem('bertdash.ghost.v1.1').length;
  globalThis.__storageQuota = Math.floor(stored * 1.5);
  try {
    assert.ok(saveGhost(3, bytes), 'the new ghost should be stored');
    assert.ok(hasGhost(3));
    const survivors = [1, 2].filter(hasGhost).length;
    assert.ok(survivors < 2, 'an older ghost should have been evicted to make room');
  } finally {
    globalThis.__storageQuota = null;
    clearGhosts();
  }
});

test('storage failures never throw at the caller', () => {
  clearGhosts();
  globalThis.__storageQuota = 1;      // nothing at all fits
  try {
    assert.equal(saveGhost(4, encodeGhost(record(120).frames, 0)), false);
    assert.equal(hasGhost(4), false);
  } finally {
    globalThis.__storageQuota = null;
  }

  localStorage.setItem('bertdash.ghost.v1.5', 'not base64 at all!!');
  assert.equal(loadGhost(5), null, 'a corrupt ghost reads as no ghost');
  clearGhosts();
});

// --- playback --------------------------------------------------------------

test('the ghost tracks the clock and holds its finish', () => {
  const recorder = record(300);
  const ghost = decodeGhost(encodeGhost(recorder.frames, recorder.dropped));

  const { game } = boot({ ghost, recorder: null });
  // Standing still: the clock is held, so the ghost must be at its start.
  advance(10);
  // ghostLead is how far ahead you are, so level with it reads as about zero.
  // Positions are stored whole, hence the pixel of slack.
  assert.ok(Math.abs(game.getHudState().ghostLead) <= 1,
    `before the clock starts the ghost sits on its opening sample, got ${game.getHudState().ghostLead}`);

  // Let time run without moving: the ghost pulls away.
  keys.down('KeyD');
  advance(2);
  keys.up('KeyD');
  advance(200);
  assert.ok(game.getHudState().ghostLead < -100,
    'standing still should leave you well behind a ghost that ran');

  // Past the end of the recording it holds the final pose rather than looping.
  advance(1200);
  const a = game.getHudState().ghostLead;
  advance(120);
  assert.equal(game.getHudState().ghostLead, a, 'a finished ghost should stop');
  game.destroy();
});

test('the ghost is decoration: it cannot touch the simulation', () => {
  const recorder = record(300);
  const ghost = decodeGhost(encodeGhost(recorder.frames, recorder.dropped));

  const withGhost = boot({ ghost, recorder: null });
  keys.down('KeyD');
  advance(150);
  keys.up('KeyD');
  const withPos = { x: withGhost.game.player.x, y: withGhost.game.player.y };
  withGhost.game.destroy();

  const without = boot({ ghost: null, recorder: null });
  keys.down('KeyD');
  advance(150);
  keys.up('KeyD');
  const withoutPos = { x: without.game.player.x, y: without.game.player.y };
  without.game.destroy();

  assert.deepEqual(withPos, withoutPos,
    'the same inputs must produce the same run whether or not a ghost is shown');
});

test('no ghost means no readout rather than a zero', () => {
  const { game } = boot({ ghost: null, recorder: null });
  advance(30);
  assert.equal(game.getHudState().ghostLead, null);
  game.destroy();
});

// --- watching a saved run --------------------------------------------------

test('a saved best run lists itself and converts to something playable', () => {
  clearGhosts();
  const recorder = record(300);
  assert.ok(saveGhost(12, encodeGhost(recorder.frames, recorder.dropped)));
  assert.ok(saveGhost('t-air', encodeGhost(recorder.frames, recorder.dropped)));

  const listed = listGhosts().sort();
  assert.deepEqual(listed, ['12', 't-air'], 'both saved runs should be offered');

  const reel = ghostToReel(loadGhost(12));
  assert.ok(reel, 'a saved run should convert');
  assert.equal(reel.clips.length, 1, 'one continuous take');
  assert.equal(reel.clips[0].from, 0);
  assert.equal(reel.clips[0].to, reel.frames.length - 1);
  assert.equal(reel.rate, GHOST_RATE, 'the rate has to travel with it, or it plays at double speed');
  clearGhosts();
});

test('a converted run carries everything the player needs to draw', () => {
  clearGhosts();
  const recorder = record(200);
  const reel = ghostToReel(decodeGhost(encodeGhost(recorder.frames, recorder.dropped)));

  for (const key of ['x', 'y', 'w', 'h', 'face', 'slide', 'dive', 'wall', 'wallDir',
    'vx', 'vy', 'hasFood', 'fx', 'fy', 'fair', 't', 'flow']) {
    assert.ok(key in reel.frames[0], `a replay frame needs ${key}`);
  }
  // Height follows from sliding rather than being stored.
  const sliding = reel.frames.find(f => f.slide);
  if (sliding) assert.ok(sliding.h < 48, 'a sliding frame should be short');
  assert.equal(reel.frames[0].h, 48, 'a standing frame should be full height');

  // The clock has to advance, or the replay never moves.
  assert.ok(reel.frames[1].t > reel.frames[0].t);
  clearGhosts();
});

test('an unreadable or missing run converts to nothing rather than throwing', () => {
  assert.equal(ghostToReel(null), null);
  assert.equal(ghostToReel({ samples: [] }), null);
  assert.equal(ghostToReel(undefined), null);
});

test('a replay carries speed and whatever you were riding', async () => {
  const { GHOST_RATE: rate } = await import('../js/services/ghost.js');
  // A run that moves, on a bike.
  const frames = [];
  for (let i = 0; i < 200; i++) {
    frames.push({
      x: 100 + i * 6, y: 400, fx: 130 + i * 6, fy: 384,
      face: true, slide: false, dive: i > 60 && i < 90, wall: false, wallDir: 1,
      hasFood: true, fair: false, veh: i > 100 ? 'bike' : null, t: i * (1000 / 60),
    });
  }
  const reel = ghostToReel(decodeGhost(encodeGhost(frames, 0)));

  // Velocity is reconstructed from the gap to the next sample, not stored.
  const moving = reel.frames[5];
  assert.ok(moving.vx > 0, `a moving frame should carry speed, got ${moving.vx}`);
  assert.ok(Math.abs(moving.vx - 6) < 2,
    `reconstructed speed should be about the real 6px/frame, got ${moving.vx.toFixed(1)}`);

  // The vehicle survives the round trip.
  assert.equal(reel.frames[2].veh, null, 'on foot at the start');
  assert.ok(reel.frames.some(f => f.veh === 'bike'), 'the bike has to come back');
  assert.equal(rate, 30);
});

test('a ghost saved in the old format still plays', () => {
  // Format 1 had no vehicle byte. Those saves must not be thrown away.
  const recorder = record(200);
  const bytes = encodeGhost(recorder.frames, recorder.dropped);
  const v1 = new Uint8Array(4 + ((bytes.length - 4) / 10) * 9);
  v1.set(bytes.subarray(0, 4));
  v1[0] = 1;
  const count = new DataView(bytes.buffer).getUint16(2, true);
  for (let i = 0; i < count; i++) {
    v1.set(bytes.subarray(4 + i * 10, 4 + i * 10 + 9), 4 + i * 9);
  }
  const old = decodeGhost(v1);
  assert.ok(old, 'an old save should still decode');
  assert.equal(old.samples.length, count);
  assert.equal(old.samples[0].veh, null, 'with no vehicle, which is how it always played');
  assert.ok(ghostToReel(old), 'and still convert to a replay');
});
