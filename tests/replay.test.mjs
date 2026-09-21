// The run recorder and the highlight reel it cuts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, makeCanvas, advance, keys, resetClock } from './harness.mjs';

installGlobals();

const { Game } = await import('../js/engine/game.js');
const { Recorder } = await import('../js/engine/recorder.js');
const { PHYSICS } = await import('../js/data/config.js');

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

function boot(level = fixture(), options = {}) {
  resetClock();
  const canvas = makeCanvas({ record: false });
  const events = { win: null, lose: null };
  const recorder = new Recorder();
  const game = new Game(canvas, level, {
    skin: { color: '#06c167', textColor: '#fff' },
    recorder,
    onWin: r => { events.win = r; },
    onLose: r => { events.lose = r; },
    onStats: () => {},
    ...options,
  });
  game.start();
  return { game, canvas, recorder, events };
}

/**
 * Jumps, then jumps again in mid-air. A plain ground jump is deliberately not
 * worth cutting to, so an air jump is the cheapest move that marks a highlight.
 */
function airJump() {
  keys.down('Space');
  advance(8);
  keys.up('Space');
  advance(6);
  keys.down('Space');
  advance(2);
  keys.up('Space');
}

test('a run is recorded frame by frame', () => {
  const { game, recorder } = boot();
  advance(90);
  assert.ok(recorder.frames.length >= 85,
    `expected roughly one frame per step, got ${recorder.frames.length}`);

  const last = recorder.frames.at(-1);
  assert.equal(last.x, game.player.x, 'the recorded position should match the live one');
  assert.equal(last.hasFood, game.player.hasFood);
  game.destroy();
});

test('notable moves are marked, ordinary ones are not', () => {
  const { game, recorder } = boot();
  advance(40);

  // A plain jump is not worth cutting to, and deliberately has no label.
  keys.down('KeyD');
  advance(30);
  keys.down('Space');
  advance(12);
  keys.up('Space');
  advance(6);
  assert.equal(recorder.marks.length, 0, 'a plain jump is not a highlight');

  // An air jump is.
  keys.down('Space');
  advance(2);
  keys.up('Space');
  keys.up('KeyD');

  assert.ok(recorder.marks.length > 0, 'an air jump should have been marked');
  assert.ok(recorder.marks.every(m => m.label), 'every mark carries a caption');
  assert.ok(recorder.marks.every(m => m.frame >= 0 && m.frame < recorder.frames.length + recorder.dropped),
    'every mark should point at a real frame');
  game.destroy();
});

test('the reel is the whole run, start to finish', () => {
  const { game, recorder, events } = boot(fixture({ goalPos: { x: 2400, y: 470 } }));
  keys.down('KeyD');
  for (let i = 0; i < 600 && !events.win; i++) advance(1);
  keys.up('KeyD');
  assert.ok(events.win, 'should have delivered');

  const reel = recorder.build();
  assert.ok(reel, 'there should be a reel');
  assert.equal(reel.clips.length, 1, 'one continuous take, not a montage');
  assert.equal(reel.clips[0].from, 0, 'it starts at the start');
  assert.equal(reel.clips[0].to, reel.frames.length - 1, 'and runs to the end');
  game.destroy();
});

test('a reel plays back the recorded positions exactly', () => {
  const { game, recorder } = boot();
  keys.down('KeyD');
  advance(60);
  keys.down('Space'); advance(12); keys.up('Space');
  advance(40);
  keys.up('KeyD');
  const reel = recorder.build();
  assert.ok(reel);
  game.destroy();

  // Play it back and check the player lands on the recorded track.
  resetClock();
  let ended = false;
  const playback = new Game(makeCanvas({ record: false }), fixture(), {
    skin: { color: '#06c167', textColor: '#fff' },
    replay: { ...reel, index: 0 },
    onReplayEnd: () => { ended = true; },
    onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  playback.start();
  advance(1);

  const clip = reel.clips[0];
  const expected = reel.frames[clip.from];
  assert.ok(Math.abs(playback.player.x - expected.x) < 12,
    `playback should start on the recorded track, got ${playback.player.x} vs ${expected.x}`);

  // It should reach the end rather than running forever.
  for (let i = 0; i < 4000 && !ended; i++) advance(1);
  assert.ok(ended, 'the reel should finish');
  playback.destroy();
});

test('a replay never simulates: physics do not advance', () => {
  const { recorder } = boot();
  keys.down('KeyD');
  advance(80);
  keys.up('KeyD');
  const reel = recorder.build();
  assert.ok(reel);

  resetClock();
  const playback = new Game(makeCanvas({ record: false }), fixture(), {
    skin: { color: '#06c167', textColor: '#fff' },
    replay: { ...reel, index: 0 },
    onReplayEnd: () => {}, onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  playback.start();

  // Hold a key: it must have no effect at all during playback.
  keys.down('KeyA');
  const before = playback.player.x;
  advance(20);
  keys.up('KeyA');
  const track = reel.frames.slice(reel.clips[0].from, reel.clips[0].to + 1);
  assert.ok(track.some(f => Math.abs(f.x - playback.player.x) < 12),
    'the player should be somewhere on the recorded track, not simulated');
  void before;
  playback.destroy();
});

test('a run too short to be worth watching produces no reel', () => {
  const { game, recorder } = boot();
  advance(5);
  assert.equal(recorder.build(), null, 'five frames is not a highlight reel');
  game.destroy();
});

test('a very long run keeps its most recent frames', () => {
  const { game, recorder } = boot();
  // Push past the recorder's cap without running the sim for an hour.
  recorder.frames.length = 0;
  for (let i = 0; i < 14100; i++) {
    recorder.record(game);
  }
  assert.ok(recorder.frames.length <= 14000, 'the buffer should be capped');
  assert.ok(recorder.dropped > 0, 'and the overflow counted');
  game.destroy();
});


// --- smoothness ------------------------------------------------------------
// Slow motion used to round the frame index, so the same recorded position was
// shown three or four times and then jumped. These pin that it interpolates.

/** Records a short run and returns a reel plus a fresh playback game. */
function playback(options = {}) {
  const { recorder } = boot();
  keys.down('KeyD');
  advance(200);
  keys.up('KeyD');
  const reel = recorder.build();
  assert.ok(reel, 'the run should produce a reel');

  resetClock();
  const game = new Game(makeCanvas({ record: false }), fixture(), {
    skin: { color: '#06c167', textColor: '#fff' },
    replay: { ...reel, index: 0 },
    onReplayEnd: () => {}, onWin: () => {}, onLose: () => {}, onStats: () => {},
    ...options,
  });
  game.start();
  return { game, reel };
}

test('slow motion moves a little every frame instead of holding and jumping', () => {
  const { game } = playback();
  game.replaySpeed = 0.28;

  const xs = [];
  for (let i = 0; i < 40; i++) { advance(1); xs.push(game.player.x); }
  game.destroy();

  const steps = xs.slice(1).map((x, i) => Math.abs(x - xs[i]));
  const moving = steps.filter(d => d > 1e-9);
  assert.ok(moving.length > steps.length * 0.9,
    `slow motion should advance nearly every frame, only ${moving.length}/${steps.length} did`);

  // Rounding produced a run of identical frames and then one step four times
  // the size. Interpolating should keep every step about the same size.
  const largest = Math.max(...steps);
  const typical = steps.reduce((a, b) => a + b, 0) / steps.length;
  assert.ok(largest < typical * 2.5,
    `no frame should lurch: largest step ${largest.toFixed(3)} vs typical ${typical.toFixed(3)}`);
});

test('playing at full speed still lands exactly on the recorded frames', () => {
  const { game, reel } = playback();
  game.replaySpeed = 1;
  const clip = reel.clips[0];
  for (let i = 1; i <= 12; i++) {
    advance(1);
    const expected = reel.frames[clip.from + i];
    if (!expected) break;
    assert.ok(Math.abs(game.player.x - expected.x) < 1e-6,
      `frame ${i} should be exact, got ${game.player.x} vs ${expected.x}`);
  }
  game.destroy();
});

test('the camera keeps the player on screen for the whole replay', () => {
  const { game } = playback();
  game.replaySpeed = 1;

  let worst = 0;
  for (let i = 0; i < 400; i++) {
    advance(1);
    const dx = (game.player.x + game.player.width / 2) - (game.camera.x + 400);
    const dy = (game.player.y + game.player.height / 2) - (game.camera.y + 300);
    worst = Math.max(worst, Math.abs(dx), Math.abs(dy));
  }
  game.destroy();
  assert.ok(worst < 360, `the player should stay framed, drifted ${worst.toFixed(0)}px off centre`);
});

test('the camera leans towards the bag while it is loose', () => {
  const { game } = playback();
  game.replaySpeed = 1;
  advance(30);

  // Put the bag well off to one side and let the camera settle.
  const p = game.player;
  p.hasFood = false;
  game.food.airborne = true;
  const centred = game.camera.x;
  game.food.x = p.x + 600;
  game.food.y = p.y;
  for (let i = 0; i < 40; i++) {
    game.food.x = p.x + 600;      // hold it there against the recording
    game.food.y = p.y;
    game.food.airborne = true;
    p.hasFood = false;
    advance(1);
  }
  const leaned = game.camera.x;
  game.destroy();
  assert.ok(leaned > centred,
    `the camera should drift towards a loose bag (${centred.toFixed(0)} -> ${leaned.toFixed(0)})`);
});

test('a replay runs at normal speed and normal zoom', () => {
  const { game } = playback();
  assert.equal(game.replayZoom, 1, 'no push-in');
  advance(10);
  assert.equal(game.replayZoom, 1, 'and it stays that way');
  game.destroy();
});

test('the canvas is drawn at the display density, not a fixed 800x600', () => {
  const original = globalThis.devicePixelRatio;
  try {
    globalThis.devicePixelRatio = 2;
    const { game, canvas } = boot();
    advance(1);
    assert.equal(canvas.width, 1600, 'the backing store should follow the pixel ratio');
    assert.equal(canvas.height, 1200);
    assert.equal(game.renderScale, 2);
    game.destroy();

    // Absurd ratios are capped rather than allocating an enormous buffer.
    globalThis.devicePixelRatio = 8;
    const huge = boot();
    advance(1);
    assert.equal(huge.game.renderScale, 3);
    huge.game.destroy();
  } finally {
    globalThis.devicePixelRatio = original;
  }
});
