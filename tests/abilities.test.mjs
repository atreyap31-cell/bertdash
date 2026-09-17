// One test per amplified ability, pinning both that it works and that it
// cannot be abused (no infinite air jumps, no free shields, no stuck crouch).

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, makeCanvas, advance, keys, resetClock } from './harness.mjs';

installGlobals();

const { Game } = await import('../js/engine/game.js');
const { PHYSICS } = await import('../js/data/config.js');

const FLOOR_Y = 500;

function fixture(overrides = {}) {
  return {
    id: 'test', title: 'Test', width: 3000, height: 700, background: '#101010',
    theme: 'horizontal', startPos: { x: 200, y: 400 }, goalPos: { x: 2900, y: 470 },
    foodPos: { x: 240, y: 400 }, physics: {}, vehicles: [], powerups: [],
    platforms: [{ x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' }],
    ...overrides,
  };
}

function boot(level = fixture()) {
  resetClock();
  const canvas = makeCanvas();
  const events = { win: null, lose: null, stats: new Map() };
  const game = new Game(canvas, level, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: r => { events.win = r; },
    onLose: r => { events.lose = r; },
    onStats: batch => batch.forEach((n, k) => events.stats.set(k, (events.stats.get(k) ?? 0) + n)),
  });
  game.start();
  return { game, canvas, events };
}

/** Taps a key for a single simulation step. */
function tap(code) {
  keys.down(code);
  advance(1);
  keys.up(code);
}

/** Holds jump for `frames` so variable jump height does not cut the arc short. */
function jump(frames = 12) {
  keys.down('Space');
  advance(frames);
  keys.up('Space');
}

/**
 * Stat counters are batched inside the engine and only handed to onStats once
 * a second, so close the game before reading them.
 */
function finalStats(game, events) {
  game.destroy();
  return events.stats;
}

// --- air jump --------------------------------------------------------------

test('air jump gives a second boost mid-flight, but only one', () => {
  const { game } = boot();
  advance(60);
  assert.equal(game.player.grounded, true);

  jump(12);
  advance(10);                       // past the apex, still well off the ground
  assert.equal(game.player.grounded, false, 'should be airborne');
  assert.equal(game.player.airJumps, PHYSICS.airJumps, 'air jump should still be banked');

  const vyBefore = game.player.vy;
  tap('Space');
  assert.ok(game.player.vy < vyBefore, 'air jump should push the player back up');
  assert.equal(game.player.airJumps, 0, 'the air jump is now spent');

  const vyAfter = game.player.vy;
  advance(3);
  tap('Space');
  assert.ok(game.player.airJumps === 0 && game.player.vy > vyAfter,
    'a second air jump must not fire');
});

test('landing refills the air jump', () => {
  const { game } = boot();
  advance(60);
  jump(12);
  advance(10);
  tap('Space');                      // spend it
  assert.equal(game.player.airJumps, 0);

  advance(140);                      // fall back down
  assert.equal(game.player.grounded, true);
  assert.equal(game.player.airJumps, PHYSICS.airJumps, 'landing should refill it');
});

// --- wall work -------------------------------------------------------------

const WALL_LEVEL = fixture({
  platforms: [
    { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
    { x: 400, y: 100, width: 40, height: 400, type: 'static' },
  ],
  startPos: { x: 300, y: 200 },
});

test('wall sliding engages without holding into the wall', () => {
  const { game } = boot(WALL_LEVEL);
  // Drift into the wall, then release everything.
  keys.down('KeyD');
  advance(24);
  keys.up('KeyD');
  advance(6);
  assert.equal(game.player.wallSliding, true, 'should cling with no key held');
  assert.ok(game.player.vy <= PHYSICS.wallSlideSpeed + 0.01, 'fall speed should be capped');
});

test('pushing away from a wall lets go of it', () => {
  const { game } = boot(WALL_LEVEL);
  keys.down('KeyD');
  advance(24);
  keys.up('KeyD');
  advance(4);
  assert.equal(game.player.wallSliding, true);

  keys.down('KeyA');                 // push away
  advance(3);
  keys.up('KeyA');
  assert.equal(game.player.wallSliding, false, 'should release the wall');
});

test('a wall kick launches away from the wall and refunds the air jump', () => {
  const { game } = boot(WALL_LEVEL);
  keys.down('KeyD');
  advance(24);
  assert.equal(game.player.grounded, false);

  // Spend the air jump first so the refund is observable.
  game.player.airJumps = 0;
  advance(4);
  assert.equal(game.player.wallSliding, true);

  tap('Space');
  assert.ok(game.player.vy < 0, 'wall kick should send the player up');
  assert.ok(game.player.vx < 0, 'and away from the wall');
  assert.equal(game.player.airJumps, PHYSICS.airJumps, 'wall kick refunds the air jump');
  keys.up('KeyD');
});

// --- slide and long jump ---------------------------------------------------

test('a slide keeps your run-up speed rather than capping it', () => {
  const { game } = boot();
  keys.down('KeyD');
  advance(80);                       // reach top running speed
  const runSpeed = Math.abs(game.player.vx);

  tap('KeyS');
  assert.ok(Math.abs(game.player.vx) > runSpeed, 'sliding should be faster than running');
  assert.equal(game.player.sliding, true);
  assert.ok(game.player.height < 48, 'and should lower the hitbox');
  keys.up('KeyD');
});

test('jumping out of a slide is a long jump', () => {
  const plain = boot();
  keys.down('KeyD');
  advance(80);
  tap('Space');
  advance(30);
  const plainDistance = plain.game.player.x;
  keys.up('KeyD');
  plain.game.destroy();

  const long = boot();
  keys.down('KeyD');
  advance(80);
  tap('KeyS');                       // slide
  advance(2);
  tap('Space');                      // long jump out of it
  advance(30);
  keys.up('KeyD');
  assert.ok(long.game.player.x > plainDistance,
    `long jump (${long.game.player.x.toFixed(0)}) should out-range a standing jump (${plainDistance.toFixed(0)})`);
  long.game.destroy();
});

test('a slide under a low ceiling stays crouched instead of clipping', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 320, y: 380, width: 400, height: 90, type: 'static' }, // 30px crawl space
    ],
    startPos: { x: 150, y: 440 },
  });
  const { game } = boot(level);
  advance(40);
  keys.down('KeyD');
  advance(16);
  tap('KeyS');

  let crouchedUnderRoof = false;
  for (let i = 0; i < 90; i++) {
    advance(1);
    const p = game.player;
    if (p.x > 340 && p.x + p.width < 700) {
      assert.ok(p.height <= 30, `player stood up under the roof (height ${p.height})`);
      crouchedUnderRoof = true;
    }
  }
  keys.up('KeyD');
  assert.ok(crouchedUnderRoof, 'the player never entered the crawl space');
});

// --- dive ------------------------------------------------------------------

test('dive works from the ground, not just mid-air', () => {
  const { game } = boot();
  advance(60);
  assert.equal(game.player.grounded, true);

  game.aim = { x: game.player.x + 400, y: game.player.y };
  tap('KeyE');
  assert.equal(game.player.diving, true, 'should dive from standing');
  assert.ok(Math.abs(game.player.vx) > PHYSICS.moveSpeed, 'and carry real speed');
});

test('a fast dive into the ground bounces instead of stopping dead', () => {
  const { game, events } = boot();
  advance(30);                       // airborne
  game.aim = { x: game.player.x + 120, y: game.player.y + 400 }; // dive down-forward
  tap('KeyE');

  let bounced = false;
  for (let i = 0; i < 60; i++) {
    advance(1);
    if (game.player.vy < -5 && !game.player.grounded) { bounced = true; break; }
  }
  assert.ok(bounced, 'the dive should have rebounded off the floor');
  assert.ok((finalStats(game, events).get('diveBounces') ?? 0) >= 1, 'and been counted');
});

// --- charged throw ---------------------------------------------------------

test('holding the throw charges it and sends the bag further', () => {
  const short = boot();
  advance(40);
  short.canvas.dispatch('pointermove', { clientX: 400, clientY: 200, preventDefault() {} });
  short.canvas.dispatch('pointerdown', { clientX: 400, clientY: 200, preventDefault() {} });
  short.canvas.dispatch('pointerup', { clientX: 400, clientY: 200, preventDefault() {} });
  const quickSpeed = Math.hypot(short.game.food.vx, short.game.food.vy);
  short.game.destroy();

  const long = boot();
  advance(40);
  long.canvas.dispatch('pointermove', { clientX: 400, clientY: 200, preventDefault() {} });
  long.canvas.dispatch('pointerdown', { clientX: 400, clientY: 200, preventDefault() {} });
  advance(PHYSICS.throwChargeFrames + 5);       // wind all the way up
  assert.equal(long.game.chargeRatio(), 1, 'charge should reach full');
  long.canvas.dispatch('pointerup', { clientX: 400, clientY: 200, preventDefault() {} });

  const chargedSpeed = Math.hypot(long.game.food.vx, long.game.food.vy);
  assert.ok(chargedSpeed > quickSpeed * 1.4,
    `charged throw (${chargedSpeed.toFixed(1)}) should beat a tap (${quickSpeed.toFixed(1)})`);
  long.game.destroy();
});

test('the charge resets after the throw', () => {
  const { game, canvas } = boot();
  advance(40);
  canvas.dispatch('pointerdown', { clientX: 400, clientY: 200, preventDefault() {} });
  advance(20);
  canvas.dispatch('pointerup', { clientX: 400, clientY: 200, preventDefault() {} });
  assert.equal(game.chargeRatio(), 0);
  assert.equal(game.charging, false);
});

// --- powerups --------------------------------------------------------------

test('a shield absorbs a lethal hazard once, then stops protecting', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 260, y: 460, width: 300, height: 40, type: 'spike' },
    ],
    powerups: [{ id: 's', type: 'shield', pos: { x: 200, y: 440 }, width: 40, height: 60 }],
  });
  const { game, events } = boot(level);
  advance(40);
  assert.ok(game.player.buffs.shield > 0, 'shield should be picked up');

  keys.down('KeyD');
  for (let i = 0; i < 200 && !events.lose; i++) advance(1);
  keys.up('KeyD');

  assert.equal(game.player.buffs.shield, 0, 'the shield should have been consumed');
  assert.ok((finalStats(game, events).get('shieldsUsed') ?? 0) >= 1, 'and the hit recorded');
});

test('a shield does not save you from dropping the bag', () => {
  const level = fixture({
    powerups: [{ id: 's', type: 'shield', pos: { x: 200, y: 440 }, width: 40, height: 60 }],
  });
  const { game, canvas, events } = boot(level);
  advance(40);
  assert.ok(game.player.buffs.shield > 0);

  const event = { clientX: 700, clientY: 100, preventDefault() {} };
  canvas.dispatch('pointermove', event);
  canvas.dispatch('pointerdown', event);
  canvas.dispatch('pointerup', event);
  for (let i = 0; i < 300 && !events.lose; i++) advance(1);

  assert.equal(events.lose, 'DROPPED', 'losing the bag is not survivable');
});

test('a magnet reels a loose bag back in', () => {
  const level = fixture({
    powerups: [{ id: 'm', type: 'magnet', pos: { x: 200, y: 440 }, width: 40, height: 60 }],
  });
  const { game, canvas } = boot(level);
  advance(40);
  assert.ok(game.player.buffs.magnet > 0, 'magnet should be picked up');

  // Lob it up and slightly away — outside the normal catch radius.
  const event = { clientX: 300, clientY: 120, preventDefault() {} };
  canvas.dispatch('pointermove', event);
  canvas.dispatch('pointerdown', event);
  canvas.dispatch('pointerup', event);
  assert.equal(game.player.hasFood, false);

  let pulled = false;
  for (let i = 0; i < 160; i++) {
    advance(1);
    if (game.food.magnetised) pulled = true;
    if (game.player.hasFood) break;
  }
  assert.ok(pulled, 'the bag should have come under magnetic pull');
});

// --- vehicles --------------------------------------------------------------

test('a dismounted vehicle can be boarded again', () => {
  const level = fixture({
    vehicles: [{ id: 'v', type: 'bike', pos: { x: 200, y: 440 }, width: 60, height: 60 }],
  });
  const { game } = boot(level);
  advance(40);
  assert.ok(game.player.vehicle, 'should board on contact');

  tap('KeyQ');
  assert.equal(game.player.vehicle, null, 'Q dismounts');

  advance(120);                      // land, wait out the re-board lockout
  assert.ok(game.player.vehicle, 'the bike should still be usable, not consumed');
});

test('boost is one-shot until it recharges', () => {
  const level = fixture({
    vehicles: [{ id: 'v', type: 'car', pos: { x: 200, y: 440 }, width: 80, height: 40 }],
  });
  const { game, events } = boot(level);
  advance(40);
  assert.ok(game.player.vehicle);

  tap('ShiftLeft');
  assert.ok(game.player.boost > 0, 'boost should engage');

  advance(PHYSICS.boostFrames + 5);  // boost expires, recharge still running
  assert.equal(game.player.boost, 0, 'boost should have run out');
  assert.ok(game.player.boostCharge > 0, 'and still be recharging');

  tap('ShiftLeft');
  assert.equal(game.player.boost, 0, 'must not re-boost while recharging');
  assert.equal(finalStats(game, events).get('boosts') ?? 0, 1, 'exactly one boost was used');
});
