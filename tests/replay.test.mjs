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

test('the reel ends on the finish', () => {
  // Far enough away that the run is long enough to be worth watching.
  const { game, recorder, events } = boot(fixture({ goalPos: { x: 2400, y: 470 } }));
  keys.down('KeyD');
  for (let i = 0; i < 600 && !events.win; i++) advance(1);
  keys.up('KeyD');
  assert.ok(events.win, 'should have delivered');

  const reel = recorder.build();
  assert.ok(reel, 'there should be a reel');
  assert.equal(reel.clips.at(-1).kind, 'finish', 'the last shot is always the delivery');
  game.destroy();
});

test('clips stay inside the recording and do not overlap the same instant', () => {
  const { game, recorder } = boot();
  keys.down('KeyD');
  for (let i = 0; i < 8; i++) {
    advance(20);
    keys.down('Space'); advance(10); keys.up('Space');
  }
  keys.up('KeyD');

  const reel = recorder.build();
  assert.ok(reel, 'there should be a reel');
  for (const clip of reel.clips) {
    assert.ok(clip.from >= 0, 'a clip cannot start before the recording');
    assert.ok(clip.to < reel.frames.length, 'a clip cannot run past the recording');
    assert.ok(clip.to > clip.from, 'a clip must have length');
  }
  const ats = reel.clips.map(c => c.at).sort((a, b) => a - b);
  for (let i = 1; i < ats.length; i++) {
    assert.ok(ats[i] - ats[i - 1] >= 90, 'clips should not show the same two seconds twice');
  }
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
