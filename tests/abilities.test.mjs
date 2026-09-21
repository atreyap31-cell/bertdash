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

  tap('KeyE');
  assert.equal(game.player.diving, true, 'should dive from standing');
  assert.ok(Math.abs(game.player.vx) > PHYSICS.moveSpeed, 'and carry real speed');
});

test('a fast dive into the ground bounces instead of stopping dead', () => {
  const { game, events } = boot();
  advance(40);                       // settle on the floor
  keys.down('KeyD');
  advance(30);
  jump(16);                          // get height
  advance(10);

  // Dash forward off the top of the jump, still holding the bag, so the dive
  // is a flat one and gravity brings it down hard onto the floor.
  tap('KeyE');
  assert.equal(game.player.diving, true, 'the dive should have started');

  let bounced = false;
  for (let i = 0; i < 120; i++) {
    advance(1);
    if (game.player.vy < -5 && !game.player.grounded) { bounced = true; break; }
  }
  keys.up('KeyD');

  assert.ok(bounced, 'the dive should have rebounded off the floor');
  assert.ok((finalStats(game, events).get('diveBounces') ?? 0) >= 1, 'and been counted');
});

test('diving chases a thrown bag, so the throw chooses the direction', () => {
  const { game, canvas } = boot();
  advance(40);
  keys.down('KeyD');
  advance(30);
  jump(16);
  advance(8);

  // Throw down and forward, then dive: the dive should head at the bag.
  throwDir(['down', 'right'], 1);
  advance(2);
  const bagX = game.food.x;
  const bagY = game.food.y;

  tap('KeyE');
  keys.up('KeyD');

  assert.equal(game.player.diving, true, 'the dive should have started');
  const towardsBagX = bagX - game.player.x;
  const towardsBagY = bagY - game.player.y;
  assert.ok(Math.sign(game.player.vx) === Math.sign(towardsBagX) || towardsBagX === 0,
    'the dive should travel towards the bag horizontally');
  assert.ok(game.player.vy > 0 && towardsBagY > 0,
    'and downwards, because that is where the bag was thrown');
  game.destroy();
});

// --- charged throw ---------------------------------------------------------

test('holding the throw charges it and sends the bag further', () => {
  const short = boot();
  advance(40);
  throwDir('right', 1);
  const quickSpeed = Math.hypot(short.game.food.vx, short.game.food.vy);
  short.game.destroy();

  const long = boot();
  advance(40);
  keys.down('ArrowRight');
  advance(PHYSICS.throwChargeFrames + 5);       // wind all the way up
  assert.equal(long.game.chargeRatio(), 1, 'charge should reach full');
  keys.up('ArrowRight');
  advance(1);

  const chargedSpeed = Math.hypot(long.game.food.vx, long.game.food.vy);
  assert.ok(chargedSpeed > quickSpeed * 1.4,
    `charged throw (${chargedSpeed.toFixed(1)}) should beat a tap (${quickSpeed.toFixed(1)})`);
  long.game.destroy();
});

test('the charge resets after the throw', () => {
  const { game, canvas } = boot();
  advance(40);
  throwDir('right', 20);
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

  throwDir('right', 1);
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

  // Lob it up and away — outside the normal catch radius.
  throwDir(['up', 'right'], 1);
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

// --- bag bounce ------------------------------------------------------------

/**
 * Throws the bag straight up, then jumps when it is on its way back down and
 * within reach — which is how a player actually times a bag bounce. Fixed
 * frame counts do not survive the throw inheriting the player's momentum.
 */
function bagBounce(game, canvas, { spendAirJump = false } = {}) {
  throwDir('up', 1);

  for (let i = 0; i < 200; i++) {
    const f = game.food;
    const p = game.player;
    const above = (p.y + p.height / 2) - (f.y + f.size / 2);
    // Descending, and close enough overhead that a jump will meet it.
    if (f.vy > 0 && above > 0 && above < 190) break;
    advance(1);
  }

  keys.down('Space');
  advance(2);
  if (spendAirJump) game.player.airJumps = 0;
  advance(14);
  keys.up('Space');

  for (let i = 0; i < 90 && !game.player.hasFood; i++) advance(1);
}

/**
 * Throws the bag. Aiming is on the arrow keys: hold one or more to aim and
 * charge, release to let go. `dirs` is any of 'up' 'down' 'left' 'right';
 * two together throw on the diagonal.
 */
function throwDir(dirs, charge = 1) {
  const map = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const codes = [].concat(dirs).map(d => map[d]);
  codes.forEach(keys.down);
  advance(Math.max(1, charge));
  codes.forEach(keys.up);
  advance(1);                 // the release frame is when the bag leaves
}

test('catching the bag in mid-air launches you far above jump height', () => {
  // Baseline: how high a plain running jump gets.
  const plain = boot();
  advance(40);
  const groundY = plain.game.player.y;
  keys.down('KeyD');
  jump(16);
  let plainPeak = 0;
  for (let i = 0; i < 80; i++) { advance(1); plainPeak = Math.max(plainPeak, groundY - plain.game.player.y); }
  keys.up('KeyD');
  plain.game.destroy();

  // Now throw the bag straight up, jump into it, and catch it.
  const { game, canvas } = boot();
  advance(40);
  keys.down('KeyD');
  advance(30);
  bagBounce(game, canvas);

  let peak = groundY - game.player.y;
  for (let i = 0; i < 120; i++) { advance(1); peak = Math.max(peak, groundY - game.player.y); }
  keys.up('KeyD');

  assert.equal(game.player.hasFood, true, 'the bag should have been caught');
  assert.ok(peak > plainPeak * 1.5,
    `bag bounce (${peak.toFixed(0)}px) should clear far more than a plain jump (${plainPeak.toFixed(0)}px)`);
  game.destroy();
});

test('the bag bounce refunds the air jump', () => {
  const { game, canvas } = boot();
  advance(40);
  keys.down('KeyD');
  advance(30);
  // Spend the air jump on the way up, so the refund on the catch is visible.
  bagBounce(game, canvas, { spendAirJump: true });
  keys.up('KeyD');

  assert.equal(game.player.hasFood, true, 'the bag should have been caught');
  assert.equal(game.player.airJumps, PHYSICS.airJumps, 'the catch should hand the air jump back');
  game.destroy();
});

test('catching the bag on the ground does not launch you', () => {
  const { game, canvas } = boot();
  advance(40);
  // Lob it almost straight up from standing and wait on the ground for it.
  throwDir('up', 1);

  let launched = false;
  for (let i = 0; i < 200; i++) {
    advance(1);
    if (game.player.hasFood) {
      launched = game.player.vy < -12;
      break;
    }
  }
  assert.equal(launched, false, 'a catch made while standing is just a catch');
  game.destroy();
});

test('the bag bounce is counted', () => {
  const { game, canvas, events } = boot();
  advance(40);
  keys.down('KeyD');
  advance(30);
  bagBounce(game, canvas);
  keys.up('KeyD');
  assert.ok((finalStats(game, events).get('bagBounces') ?? 0) >= 1, 'the bounce should be recorded');
});

// --- the clock and the flow chain ------------------------------------------

test('the clock does not start until you move', () => {
  const { game } = boot();
  advance(120);                        // two seconds of standing still
  assert.equal(game.started, false, 'the run should not have started');
  assert.equal(game.elapsed, 0, 'no time should be on the clock');

  keys.down('KeyD');
  advance(30);
  keys.up('KeyD');
  assert.equal(game.started, true, 'moving should start the run');
  assert.ok(game.elapsed > 0, 'and the clock should now be running');
});

test('jumping also starts the clock', () => {
  const { game } = boot();
  advance(60);
  assert.equal(game.elapsed, 0);
  tap('Space');
  advance(5);
  assert.ok(game.elapsed > 0, 'a jump counts as starting the run');
});

test('flow builds as you chain moves and lapses when you stop', () => {
  const { game } = boot();
  advance(40);

  keys.down('KeyD');
  jump(12);
  advance(6);
  tap('Space');                        // air jump
  advance(20);
  keys.up('KeyD');

  assert.ok(game.flow > 0, 'chaining moves should build flow');
  const peak = game.flow;
  assert.ok(game.flowMultiplier() > 1, 'flow should raise the payout multiplier');

  advance(200);                        // stand around until the chain lapses
  assert.equal(game.flow, 0, 'flow should decay to nothing');
  assert.equal(game.bestFlow, peak, 'but the best held is remembered for the payout');
});

test('mashing one move does not build flow as fast as varying them', () => {
  const same = boot();
  advance(40);
  for (let i = 0; i < 4; i++) { tap('Space'); advance(3); }   // repeated jumps
  const sameFlow = same.game.flow;
  same.game.destroy();

  const varied = boot();
  advance(40);
  keys.down('KeyD');
  jump(12);
  advance(4);
  tap('Space');                        // air jump
  advance(4);
  tap('KeyE');                         // dive
  keys.up('KeyD');
  const variedFlow = varied.game.flow;
  varied.game.destroy();

  assert.ok(variedFlow > sameFlow,
    `varied moves (${variedFlow}) should out-earn repeats (${sameFlow})`);
});

// --- a thrown bag is recoverable -------------------------------------------

test('a bag thrown at the floor breaks on impact', () => {
  const { game, events } = boot();
  advance(40);
  throwDir(['down', 'right'], 1);        // straight into the floor

  for (let i = 0; i < 200 && !events.lose; i++) advance(1);
  assert.equal(events.lose, 'DROPPED', 'hitting the ground ends the delivery');
  assert.equal(game.food.wallBouncesLeft, PHYSICS.bagWallBounces,
    'a floor hit should not have spent a wall glance — it just breaks');
});

test('a bag thrown at a wall glances off instead of breaking', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 600, y: -200, width: 60, height: 700, type: 'static' },  // a tall wall
    ],
  });
  const { game, events } = boot(level);
  advance(40);

  // Lofted into the wall's side: thrown flat it would reach the floor first.
  throwDir(['up', 'right'], PHYSICS.throwChargeFrames);

  let glanced = false;
  for (let i = 0; i < 60; i++) {
    advance(1);
    if (game.food.wallBouncesLeft < PHYSICS.bagWallBounces) { glanced = true; break; }
  }

  assert.ok(glanced, 'the bag should have glanced off the wall');
  assert.equal(events.lose, null, 'and not been lost');
  assert.ok(game.food.airborne, 'it should still be in play');
});

test('a wall glance barely rebounds, so the bag stays catchable', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 600, y: -200, width: 60, height: 700, type: 'static' },
    ],
  });
  const { game } = boot(level);
  advance(40);

  throwDir(['up', 'right'], PHYSICS.throwChargeFrames);
  const thrownSpeed = Math.abs(game.food.vx);

  for (let i = 0; i < 60; i++) {
    advance(1);
    if (game.food.wallBouncesLeft < PHYSICS.bagWallBounces) break;
  }

  assert.ok(Math.abs(game.food.vx) < thrownSpeed * 0.5,
    `the rebound (${Math.abs(game.food.vx).toFixed(1)}) should be far softer than the throw `
    + `(${thrownSpeed.toFixed(1)})`);
  assert.ok(game.food.vx < 0, 'and should come back towards the player');
  game.destroy();
});

test('a bag that has used up its wall glances breaks on the next one', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 600, y: -200, width: 60, height: 700, type: 'static' },
    ],
  });
  const { game, events } = boot(level);
  advance(40);

  throwDir(['up', 'right'], PHYSICS.throwChargeFrames);
  game.food.wallBouncesLeft = 0;       // as if it had already glanced twice

  for (let i = 0; i < 120 && !events.lose; i++) advance(1);
  assert.equal(events.lose, 'DROPPED', 'the glances are not unlimited');
});

// --- gear ------------------------------------------------------------------

test('gear changes what the player can do', () => {
  const canvas = makeCanvas();
  resetClock();
  const game = new Game(canvas, fixture(), {
    skin: { color: '#06c167', textColor: '#fff' },
    loadout: { airJumps: 3, catchRadius: 120, bagWallBounces: 5 },
    onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  game.start();
  advance(40);

  assert.equal(game.player.airJumps, 3, 'extra air jumps should be granted');
  assert.equal(game.food.wallBouncesLeft, 5, 'a reinforced bag should take more wall glances');

  // All three air jumps should be spendable.
  jump(12);
  for (let i = 0; i < 3; i++) { advance(4); tap('Space'); }
  assert.equal(game.player.airJumps, 0, 'and all of them usable');
  game.destroy();
});

// --- throwing the bag to Bert ----------------------------------------------

/** Bert on a shelf across a gap far too wide to jump with the bag in hand. */
const THROW_LEVEL = fixture({
  width: 4000, height: 900,
  goalPos: { x: 2300, y: 430 },
  platforms: [
    { x: 0, y: FLOOR_Y, width: 1500, height: 400, type: 'static' },
    { x: 2150, y: 470, width: 500, height: 430, type: 'static' },
  ],
});

/** Runs up, settles, then lofts a fully charged throw at Bert. */
function longThrowAtBert(game, canvas) {
  keys.down('KeyD');
  while (game.player.x < 1280) advance(1);
  keys.up('KeyD');
  // Let the run bleed off first: charging takes ~40 frames, and still moving
  // would walk the player off the edge before the bag is released.
  while (Math.abs(game.player.vx) > 0.2) advance(1);

  // Charged and lofted: up+right throws on the diagonal.
  throwDir(['up', 'right'], PHYSICS.throwChargeFrames + 2);
}

test('a thrown bag that reaches Bert completes the delivery', () => {
  const { game, canvas, events } = boot(THROW_LEVEL);
  advance(40);
  longThrowAtBert(game, canvas);
  for (let i = 0; i < 300 && !events.win && !events.lose; i++) advance(1);

  assert.ok(events.win, 'the throw should have delivered');
  assert.equal(events.win.byThrow, true, 'and be recorded as a thrown delivery');
  assert.equal(events.win.clutch, true, 'a thrown delivery always counts as clutch');
  game.destroy();
});

test('a thrown delivery fires onWin exactly once', () => {
  const { game, canvas, events } = boot(THROW_LEVEL);
  advance(40);
  longThrowAtBert(game, canvas);
  for (let i = 0; i < 300 && !events.win; i++) advance(1);
  assert.ok(events.win, 'the throw should have delivered');

  events.win = null;
  advance(120);
  assert.equal(events.win, null, 'it must not fire again');
  game.destroy();
});

test('a thrown delivery is worth the most flow in the game', () => {
  const { game, canvas, events } = boot(THROW_LEVEL);
  advance(40);
  longThrowAtBert(game, canvas);
  for (let i = 0; i < 300 && !events.win; i++) advance(1);

  assert.ok(events.win.bestFlow >= 10, 'landing one should pay out a large chain');
  assert.ok((finalStats(game, events).get('airDeliveries') ?? 0) >= 1, 'and be counted');
});

test('momentum carries into the throw', () => {
  // Standing throw.
  const still = boot();
  advance(40);
  throwDir('right', 1);
  const stillSpeed = Math.hypot(still.game.food.vx, still.game.food.vy);
  still.game.destroy();

  // Same throw at a full sprint.
  const running = boot();
  advance(40);
  keys.down('KeyD');
  advance(60);
  throwDir('right', 1);
  const runningSpeed = Math.hypot(running.game.food.vx, running.game.food.vy);
  keys.up('KeyD');
  running.game.destroy();

  assert.ok(runningSpeed > stillSpeed * 1.3,
    `a running throw (${runningSpeed.toFixed(1)}) should beat a standing one (${stillSpeed.toFixed(1)})`);
});

test('vertical momentum carries too', () => {
  const ground = boot();
  advance(40);
  throwDir(['up', 'right'], 1);
  const groundVy = ground.game.food.vy;
  ground.game.destroy();

  // Throwing while still rising out of a jump should send it higher.
  const rising = boot();
  advance(40);
  keys.down('Space');
  advance(4);
  throwDir(['up', 'right'], 1);
  const risingVy = rising.game.food.vy;
  keys.up('Space');
  rising.game.destroy();

  assert.ok(risingVy < groundVy,
    `throwing while rising (${risingVy.toFixed(1)}) should launch the bag harder than from standing (${groundVy.toFixed(1)})`);
});

test('the aim preview matches the throw it predicts', () => {
  const { game, canvas } = boot();
  advance(40);
  keys.down('KeyD');
  advance(40);

  keys.down('ArrowUp');
  keys.down('ArrowRight');
  advance(1);
  const arc = game.predictThrow();
  assert.ok(arc.length > 2, 'there should be a trajectory to compare against');
  const predicted = arc[0];

  keys.up('ArrowUp');
  keys.up('ArrowRight');
  advance(1);
  keys.up('KeyD');

  const actual = { x: game.food.x + game.food.size / 2, y: game.food.y + game.food.size / 2 };
  assert.ok(Math.hypot(actual.x - predicted.x, actual.y - predicted.y) < 30,
    `preview (${predicted.x.toFixed(0)},${predicted.y.toFixed(0)}) should match the real throw `
    + `(${actual.x.toFixed(0)},${actual.y.toFixed(0)})`);
});

// --- ground feel -----------------------------------------------------------

test('landing does not leave you skating', () => {
  const { game } = boot();
  advance(40);
  keys.down('KeyD');
  advance(50);                         // up to running speed
  keys.up('KeyD');

  // Count the frames spent drifting after the input stops.
  let frames = 0;
  while (Math.abs(game.player.vx) > 0 && frames < 120) { advance(1); frames++; }

  assert.equal(game.player.vx, 0, 'the player should come to a complete stop');
  assert.ok(frames <= 1, `stopping took ${frames} frames; there should be no slide at all`);
});

test('a level can still ask for ice', () => {
  const { game } = boot(fixture({ physics: { friction: 0.985 } }));
  advance(40);
  keys.down('KeyD');
  advance(50);
  keys.up('KeyD');

  advance(10);
  assert.ok(Math.abs(game.player.vx) > 3,
    'on ice the player should still be sliding well after the input stops');
});

// --- movement smoothness ---------------------------------------------------

test('the simulation never drops a frame at a steady refresh rate', () => {
  // A frame arriving a hair under the fixed timestep used to run no simulation
  // step at all, which reads as a periodic stutter for no visible reason.
  // A long level, so the run never reaches the far wall and every stalled
  // frame is a genuine dropped step rather than the player being blocked.
  const { game } = boot(fixture({
    width: 12000,
    platforms: [{ x: 0, y: FLOOR_Y, width: 12000, height: 200, type: 'static' }],
    goalPos: { x: 11800, y: 470 },
  }));
  advance(40);
  keys.down('KeyD');
  advance(60);                         // up to a constant speed

  const speed = Math.abs(game.player.vx);
  assert.ok(speed > 6, 'should be running by now');

  let stalled = 0;
  for (let i = 0; i < 400; i++) {
    const before = game.player.x;
    advance(1);
    if (Math.abs(game.player.x - before) < speed * 0.5) stalled++;
  }
  keys.up('KeyD');

  assert.equal(stalled, 0, `${stalled} frames advanced the player barely at all`);
});

test('holding both directions turns instead of stopping dead', () => {
  const { game } = boot();
  advance(40);

  keys.down('KeyD');
  advance(40);
  assert.ok(game.player.vx > 4, 'running right');

  // Roll onto the other key without releasing the first, the way a player does.
  keys.down('KeyA');
  advance(20);
  assert.ok(game.player.vx < -2,
    `the newer key should win, got vx ${game.player.vx.toFixed(2)}`);

  // And back again.
  keys.down('KeyD');
  advance(20);
  assert.ok(game.player.vx > 2, 'rolling back should turn again');
  keys.up('KeyA');
  keys.up('KeyD');
});

test('a small lip is stepped over rather than stopping you', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 600, y: FLOOR_Y - 12, width: 400, height: 40, type: 'static' },  // 12px lip
    ],
  });
  const { game } = boot(level);
  advance(40);
  keys.down('KeyD');
  for (let i = 0; i < 160; i++) advance(1);
  keys.up('KeyD');

  assert.ok(game.player.x > 700, `should have walked over the lip, stopped at ${game.player.x.toFixed(0)}`);
  assert.equal(game.player.grounded, true, 'and still be on the ground');
});

test('a tall step is not climbed', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 600, y: FLOOR_Y - 60, width: 400, height: 90, type: 'static' },  // 60px wall
    ],
  });
  const { game } = boot(level);
  advance(40);
  keys.down('KeyD');
  for (let i = 0; i < 160; i++) advance(1);
  keys.up('KeyD');

  assert.ok(game.player.x + game.player.width <= 601,
    `a 60px step should still block, player reached ${game.player.x.toFixed(0)}`);
});

test('clipping the corner of a ceiling nudges you past it', () => {
  // A ceiling whose edge the player will just catch on the way up.
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      // Overlaps the player's right edge by 8px — inside the correction window.
      { x: 224, y: 300, width: 400, height: 60, type: 'static' },
    ],
    startPos: { x: 200, y: 440 },
  });
  const { game } = boot(level);
  advance(40);

  const startX = game.player.x;
  const ceilingBottom = 360;
  jump(16);
  let peak = game.player.y;
  for (let i = 0; i < 40; i++) { advance(1); peak = Math.min(peak, game.player.y); }

  assert.ok(game.player.x < startX - 4,
    `the player should have been nudged clear of the corner, moved ${(game.player.x - startX).toFixed(1)}`);
  assert.ok(peak < ceilingBottom - 20,
    `and carried on up past the ceiling, peaked at ${peak.toFixed(0)}`);
});

// --- camera ----------------------------------------------------------------

/** Peak frame-to-frame change in camera velocity: how violently it moves. */
function cameraJerk(game, script) {
  let prevX = game.camera.x;
  let prevVel = 0;
  let worst = 0;
  script(() => {
    advance(1);
    const vel = game.camera.x - prevX;
    worst = Math.max(worst, Math.abs(vel - prevVel));
    prevX = game.camera.x;
    prevVel = vel;
  });
  return worst;
}

test('stopping does not make the camera lurch', () => {
  // Ground friction snaps the player's speed to zero the moment a key is
  // released. Feeding that straight to the camera's look-ahead moved the
  // target a hundred pixels in one frame, which read as the screen shaking.
  const { game } = boot(fixture({
    width: 12000,
    platforms: [{ x: 0, y: FLOOR_Y, width: 12000, height: 200, type: 'static' }],
    goalPos: { x: 11800, y: 470 },
  }));
  advance(40);

  const worst = cameraJerk(game, step => {
    for (let i = 0; i < 5; i++) {
      keys.down('KeyD');
      for (let f = 0; f < 35; f++) step();
      keys.up('KeyD');
      for (let f = 0; f < 25; f++) step();
    }
  });

  assert.ok(worst < 4,
    `camera jerk peaked at ${worst.toFixed(2)}px/frame^2, which is visible as shake`);
});

test('screen shake can be turned off entirely', () => {
  resetClock();
  const canvas = makeCanvas();
  const game = new Game(canvas, fixture(), {
    skin: { color: '#06c167', textColor: '#fff' },
    shakeScale: 0,
    onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  game.start();
  advance(40);

  // Force the biggest shake in the game.
  game.player.y = -5000;               // fall out of the world
  for (let i = 0; i < 20; i++) advance(1);

  assert.equal(game.shake, 0, 'no shake should ever be applied');
  game.destroy();
});

test('shake settles quickly rather than rumbling on', () => {
  const { game } = boot();
  advance(40);
  game.shake = 10;                     // as if something big just happened

  let frames = 0;
  while (game.shake > 0 && frames < 120) { advance(1); frames++; }
  assert.ok(frames <= 15, `shake took ${frames} frames to settle`);
});

// --- gear effects ----------------------------------------------------------

/** Boots a game with a specific loadout applied. */
function bootGeared(loadout, level = fixture()) {
  resetClock();
  const canvas = makeCanvas({ record: false });
  const events = { win: null, lose: null, stats: new Map() };
  const game = new Game(canvas, level, {
    skin: { color: '#06c167', textColor: '#fff' },
    loadout,
    onWin: r => { events.win = r; },
    onLose: r => { events.lose = r; },
    onStats: batch => batch.forEach((n, k) => events.stats.set(k, (events.stats.get(k) ?? 0) + n)),
  });
  game.start();
  return { game, canvas, events };
}

test('Long Arms throws the bag harder', () => {
  const plain = boot();
  advance(40);
  throwDir('right', 1);
  const base = Math.abs(plain.game.food.vx);
  plain.game.destroy();

  const geared = bootGeared({ throwStrength: PHYSICS.throwStrength * 1.25 });
  advance(40);
  throwDir('right', 1);
  assert.ok(Math.abs(geared.game.food.vx) > base * 1.15,
    `geared throw ${Math.abs(geared.game.food.vx).toFixed(1)} should beat ${base.toFixed(1)}`);
  geared.game.destroy();
});

test('Dust Brakes makes slides last longer', () => {
  const { game } = bootGeared({ slideFrames: PHYSICS.slideFrames * 1.4 });
  advance(40);
  keys.down('KeyD');
  advance(40);
  tap('KeyS');
  assert.ok(game.player.slideTimer > PHYSICS.slideFrames,
    `slide should start longer than the base ${PHYSICS.slideFrames} frames`);
  keys.up('KeyD');
  game.destroy();
});

test('Coyote Kit widens the grace after leaving a ledge', () => {
  const { game } = bootGeared({ coyoteFrames: PHYSICS.coyoteFrames + 4 });
  advance(40);
  assert.equal(game.player.grounded, true);
  advance(1);
  assert.equal(game.player.coyote, PHYSICS.coyoteFrames + 4,
    'the extra grace frames should be in effect');
  game.destroy();
});

test('Wall Boots kicks harder off a wall', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 3000, height: 200, type: 'static' },
      { x: 400, y: 100, width: 40, height: 400, type: 'static' },
    ],
    startPos: { x: 300, y: 200 },
  });

  const reach = loadout => {
    const { game } = loadout ? bootGeared(loadout, level) : boot(level);
    keys.down('KeyD');
    advance(24);
    advance(4);
    tap('Space');
    const vy = game.player.vy;
    keys.up('KeyD');
    game.destroy();
    return vy;
  };

  const base = reach(null);
  const geared = reach({
    wallJumpX: PHYSICS.wallJump.x * 1.15,
    wallJumpY: PHYSICS.wallJump.y * 1.15,
  });
  assert.ok(geared < base, `geared kick (${geared.toFixed(1)}) should rise faster than base (${base.toFixed(1)})`);
});

test('Deep Pockets launches you higher off a bag catch', () => {
  const launch = loadout => {
    const ctx = loadout ? bootGeared(loadout) : boot();
    advance(40);
    keys.down('KeyD');
    advance(30);
    bagBounce(ctx.game, ctx.canvas);
    const vy = ctx.game.player.vy;
    keys.up('KeyD');
    ctx.game.destroy();
    return vy;
  };

  const base = launch(null);
  const geared = launch({ catchBoost: PHYSICS.catchBoost * 1.15 });
  assert.ok(geared < base,
    `geared launch (${geared.toFixed(1)}) should be stronger than base (${base.toFixed(1)})`);
});

test('Cold Chain saves the bag from exactly one floor hit', () => {
  const { game, events } = bootGeared({ floorSaves: 1 });
  advance(40);
  throwDir(['down', 'right'], 1);      // straight into the floor

  let saved = false;
  for (let i = 0; i < 60; i++) {
    advance(1);
    if (game.food.floorSavesLeft === 0) { saved = true; break; }
  }
  assert.ok(saved, 'the first floor hit should have been absorbed');
  assert.equal(events.lose, null, 'and the bag still in play');

  // The next one is not survivable.
  for (let i = 0; i < 300 && !events.lose; i++) advance(1);
  assert.equal(events.lose, 'DROPPED', 'the save is one-shot');
});

test('without Cold Chain the floor still breaks the bag immediately', () => {
  const { game, events } = boot();
  advance(40);
  assert.equal(game.food.floorSavesLeft, 0, 'no saves by default');
  throwDir(['down', 'right'], 1);
  for (let i = 0; i < 200 && !events.lose; i++) advance(1);
  assert.equal(events.lose, 'DROPPED');
});

// --- aiming honesty --------------------------------------------------------

const AIM_CODES = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** Angle in degrees, normalised to (-180, 180]. */
function angleOf(x, y) { return Math.atan2(y, x) * 180 / Math.PI; }
function angleGap(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
}

test('the aim arrow points where the bag actually goes', () => {
  // The throw inherits the player's momentum, so the bag does not travel along
  // the raw aim direction. The indicator has to be drawn from the real launch
  // vector or it points somewhere the bag will never reach — running and
  // aiming straight up used to be 37 degrees out.
  const cases = [
    { label: 'standing, up', run: 0, aim: ['up'] },
    { label: 'running, up', run: 60, aim: ['up'] },
    { label: 'running, up+right', run: 60, aim: ['up', 'right'] },
    { label: 'running, down', run: 60, aim: ['down'] },
  ];

  for (const { label, run, aim } of cases) {
    const { game } = boot(fixture({
      width: 6000,
      platforms: [{ x: 0, y: FLOOR_Y, width: 6000, height: 200, type: 'static' }],
      goalPos: { x: 5900, y: 470 },
    }));
    advance(40);
    if (run) { keys.down('KeyD'); advance(run); }

    const codes = aim.map(d => AIM_CODES[d]);
    codes.forEach(keys.down);
    advance(1);
    const shown = game.launchVelocity();
    const shownAngle = angleOf(shown.x, shown.y);
    codes.forEach(keys.up);
    advance(1);

    const actual = angleOf(game.food.vx, game.food.vy);
    keys.up('KeyD');

    assert.ok(angleGap(shownAngle, actual) <= 8,
      `${label}: arrow showed ${shownAngle.toFixed(0)}deg but the bag went ${actual.toFixed(0)}deg`);
    game.destroy();
  }
});

test('the aim arrow and the predicted arc agree', () => {
  const { game } = boot();
  advance(40);
  keys.down('KeyD');
  advance(50);

  keys.down('ArrowUp');
  advance(1);
  const shown = game.launchVelocity();
  const arc = game.predictThrow();
  keys.up('ArrowUp');
  keys.up('KeyD');

  assert.ok(arc.length > 1, 'there should be an arc');
  // The first sampled point of the arc should lie along the launch vector.
  const origin = { x: game.player.x + game.player.width / 2, y: game.player.y + game.player.height / 2 };
  const toArc = angleOf(arc[0].x - origin.x, arc[0].y - origin.y);
  assert.ok(angleGap(angleOf(shown.x, shown.y), toArc) <= 12,
    'the arrow and the dotted arc should point the same way');
  game.destroy();
});


// --- the bag glow ----------------------------------------------------------
// The engine decides whether a loose bag is coming back to you or is gone; the
// HUD only paints what it is told. These pin the decision, not the paint.

/** Runs until the outlook settles on something other than the bag being held. */
function outlookAfter(game, frames) {
  advance(frames);
  return game.getHudState().bag;
}

test('a bag in hand shows no glow at all', () => {
  const { game } = boot();
  advance(20);
  assert.equal(game.getHudState().bag.state, 'none');
  assert.equal(game.getHudState().bag.urgency, 0);
  game.destroy();
});

test('a bag thrown down at the floor reads as lost', () => {
  const { game } = boot();
  advance(30);
  throwDir('down', 40);
  const bag = outlookAfter(game, 6);
  assert.equal(bag.state, 'bad', 'a bag thrown at the ground is not coming back');
  assert.ok(bag.urgency > 0, 'a doomed bag should glow');
  game.destroy();
});

test('a bag tossed straight up reads as catchable', () => {
  const { game } = boot();
  advance(30);
  // Straight up while running: the bag keeps the player's speed, so it comes
  // back down onto them. This is the bag bounce, and it should read green.
  throwDir('up', 40);
  const bag = outlookAfter(game, 6);
  assert.equal(bag.state, 'good', 'a bag thrown up over your own head is catchable');
  game.destroy();
});

test('the glow turns green the moment the bag is caught', () => {
  const { game } = boot();
  keys.down('KeyD');
  advance(30);
  throwDir('up', 30);
  // Chase it down. The catch itself should flip the glow green and hold it.
  let caught = false;
  for (let i = 0; i < 180 && !caught; i++) {
    advance(1);
    if (game.player.hasFood) caught = true;
  }
  keys.up('KeyD');
  assert.ok(caught, 'the bag should have been caught');
  const bag = game.getHudState().bag;
  assert.equal(bag.state, 'good');
  assert.ok(bag.urgency > 0.5, 'a fresh catch should glow brightly');
  game.destroy();
});

test('the warning gets stronger as the bag nears the ground', () => {
  const { game } = boot();
  advance(30);
  throwDir('right', 40);
  const early = game.getHudState().bag;
  assert.equal(early.state, 'bad', 'a bag flung away from you is not coming back');

  // Run it almost to the floor and sample again.
  let late = early;
  for (let i = 0; i < 200 && game.food.airborne; i++) {
    advance(1);
    const now = game.getHudState().bag;
    if (now.state === 'bad') late = now;
  }
  assert.ok(late.urgency > early.urgency,
    `urgency should climb from ${early.urgency.toFixed(2)} towards impact, ended at ${late.urgency.toFixed(2)}`);
  game.destroy();
});

// --- the new gear ----------------------------------------------------------

test('Air Brake keeps the bag in the air longer', () => {
  const fall = (foodGravity) => {
    const { game } = bootGeared({ foodGravity });
    advance(30);
    throwDir('up', 30);
    let frames = 0;
    while (game.food.airborne && frames < 400) { advance(1); frames++; }
    game.destroy();
    return frames;
  };
  const plain = fall(1);
  const braked = fall(0.75);
  assert.ok(braked > plain,
    `a braked bag should hang longer than ${plain} frames, got ${braked}`);
});

test('Drag Chute lowers the speed you fall at', () => {
  const drop = (terminalVelocity) => {
    // A tall shaft, so both runs are still falling when the speed is read.
    const { game } = bootGeared({ terminalVelocity }, fixture({
      height: 2200, startPos: { x: 200, y: 60 }, foodPos: { x: 240, y: 60 },
      platforms: [{ x: 0, y: 2000, width: 3000, height: 200, type: 'static' }],
    }));
    advance(60);
    const vy = game.player.vy;
    game.destroy();
    return vy;
  };
  assert.ok(drop(PHYSICS.terminalVelocity * 0.8) < drop(PHYSICS.terminalVelocity),
    'the chute should cap fall speed lower');
});

test('Kick Plate rebounds a dive higher', () => {
  const rebound = (diveBounce) => {
    const { game } = bootGeared({ diveBounce });
    advance(30);
    // Run, not aim: the arrow keys charge and throw the bag, so using one to
    // face right also lobbed the bag away and ended the run in a drop.
    keys.down('KeyD');
    advance(10);
    jump(12);
    advance(6);
    tap('KeyE');
    let best = 0;
    for (let i = 0; i < 90; i++) {
      advance(1);
      if (game.player.vy < best) best = game.player.vy;
    }
    keys.up('KeyD');
    game.destroy();
    return best;
  };
  const plain = rebound(PHYSICS.diveBounce);
  const plated = rebound(PHYSICS.diveBounce * 1.2);
  assert.ok(plated < plain,
    `a plated rebound (${plated.toFixed(1)}) should beat ${plain.toFixed(1)}`);
});

test('Slipstream only helps once the bag has left your hands', () => {
  const { game } = bootGeared({ emptyHandBonus: PHYSICS.emptyHandBonus * 1.12 });
  keys.down('KeyD');
  advance(60);
  const carrying = Math.abs(game.player.vx);
  throwDir('right', 1);
  advance(40);
  const freed = Math.abs(game.player.vx);
  keys.up('KeyD');
  game.destroy();
  assert.ok(freed > carrying,
    `empty-handed (${freed.toFixed(1)}) should beat carrying (${carrying.toFixed(1)})`);
});

test('Jet Soles make a dive travel faster', () => {
  const speed = (diveSpeed) => {
    const { game } = bootGeared({ diveSpeed });
    advance(30);
    keys.down('ArrowRight');
    tap('KeyE');
    keys.up('ArrowRight');
    advance(2);
    const vx = Math.abs(game.player.vx);
    game.destroy();
    return vx;
  };
  assert.ok(speed(PHYSICS.diveSpeed * 1.12) > speed(PHYSICS.diveSpeed),
    'jetted dives should be quicker');
});

test('Overtime raises the flow ceiling but not the floor', () => {
  const plain = bootGeared({ flowMaxMultiplier: 3 });
  assert.equal(plain.game.flowMultiplier(), 1, 'no flow is worth 1x either way');
  plain.game.bestFlow = 999;
  assert.ok(Math.abs(plain.game.flowMultiplier() - 3) < 1e-9);
  plain.game.destroy();

  const geared = bootGeared({ flowMaxMultiplier: 4 });
  assert.equal(geared.game.flowMultiplier(), 1);
  geared.game.bestFlow = 999;
  assert.ok(Math.abs(geared.game.flowMultiplier() - 4) < 1e-9);
  geared.game.destroy();
});

test('every gear effect is understood by the loadout resolver', async () => {
  const { GEAR, resolveLoadout } = await import('../js/data/config.js');
  const base = resolveLoadout([]);
  for (const piece of GEAR) {
    const with_ = resolveLoadout([piece.id]);
    const changed = Object.keys(base).some(k => base[k] !== with_[k]);
    assert.ok(changed, `${piece.id} has an effect the resolver silently ignores`);
  }
});

test('the ungeared default matches a resolved empty loadout', async () => {
  const { resolveLoadout } = await import('../js/data/config.js');
  const { game } = boot();
  const resolved = resolveLoadout([]);
  for (const key of Object.keys(resolved)) {
    assert.equal(game.loadout[key], resolved[key], `loadout.${key} drifted`);
  }
  game.destroy();
});


// --- throws go where you aimed --------------------------------------------
// Carried momentum used to be added to a throw unconditionally, so falling at
// terminal velocity added more downward speed than an uncharged upward throw
// had going up: aiming up while falling threw the bag at the floor.

/** A shaft tall enough to reach terminal velocity in. */
const SHAFT = () => fixture({
  height: 3000, startPos: { x: 200, y: 100 }, foodPos: { x: 240, y: 100 },
  goalPos: { x: 2900, y: 2700 },
  platforms: [{ x: 0, y: 2800, width: 3000, height: 200, type: 'static' }],
});

/** Falls for `frames`, throws in `dirs`, and returns the bag's velocity. */
function throwWhileFalling(dirs, frames) {
  const { game } = boot(SHAFT());
  advance(frames);
  const playerVy = game.player.vy;
  throwDir(dirs, 1);
  const bag = { x: game.food.vx, y: game.food.vy };
  game.destroy();
  return { bag, playerVy };
}

test('aiming up while falling throws the bag up, not down', () => {
  const fast = throwWhileFalling('up', 50);
  assert.ok(fast.playerVy > 14, `should be falling hard, was ${fast.playerVy.toFixed(1)}`);
  assert.ok(fast.bag.y < 0,
    `a bag aimed up must leave your hand going up, got vy ${fast.bag.y.toFixed(1)}`);
});

test('aiming diagonally up while falling throws up and along', () => {
  const { bag, playerVy } = throwWhileFalling(['up', 'right'], 50);
  assert.ok(playerVy > 14, 'should be falling hard');
  assert.ok(bag.y < 0, `must go up, got vy ${bag.y.toFixed(1)}`);
  assert.ok(bag.x > 0, `must go right, got vx ${bag.x.toFixed(1)}`);
});

test('falling barely weakens an upward throw', () => {
  const still = boot(SHAFT());
  throwDir('up', 1);
  const standing = still.game.food.vy;
  still.game.destroy();

  const falling = throwWhileFalling('up', 50).bag.y;
  // It may take the edge off, but not most of it.
  assert.ok(falling < standing * 0.5,
    `a falling throw (${falling.toFixed(1)}) should stay close to a standing one (${standing.toFixed(1)})`);
});

test('momentum that agrees with the aim still amplifies the throw', () => {
  // Throwing down while falling is the whole point of carrying momentum.
  const still = boot(SHAFT());
  throwDir('down', 1);
  const standing = still.game.food.vy;
  still.game.destroy();

  const falling = throwWhileFalling('down', 50).bag.y;
  assert.ok(falling > standing * 2,
    `throwing down while falling (${falling.toFixed(1)}) should far exceed standing (${standing.toFixed(1)})`);
});

test('a throw thrown up at the top of a jump still launches harder', () => {
  const still = boot();
  advance(30);
  throwDir('up', 1);
  const standing = still.game.food.vy;
  still.game.destroy();

  const { game } = boot();
  advance(30);
  keys.down('Space');
  advance(5);                 // still rising
  assert.ok(game.player.vy < -5, 'should be on the way up');
  throwDir('up', 1);
  const rising = game.food.vy;
  keys.up('Space');
  game.destroy();

  assert.ok(rising < standing * 1.5,
    `a rising throw (${rising.toFixed(1)}) should beat a standing one (${standing.toFixed(1)})`);
});

test('the bag bounce still keeps every bit of your running speed', () => {
  // Tossing it straight up while running must leave the bag travelling exactly
  // alongside you — that is what makes the move reliable rather than a trick.
  const { game } = boot();
  keys.down('KeyD');
  advance(60);
  const runSpeed = game.player.vx;
  throwDir('up', 1);
  keys.up('KeyD');
  const carried = game.food.vx;
  game.destroy();

  assert.ok(carried >= runSpeed,
    `the bag should keep the runner's speed: ${carried.toFixed(1)} vs ${runSpeed.toFixed(1)}`);
});


// --- the dive chases, and does not fling you the other way ------------------

/** Angle of a vector in degrees. */
const angleOfVec = (x, y) => Math.atan2(y, x) * 180 / Math.PI;
const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Puts a still bag at an offset from the player and dives at it. */
function diveAt(dx, dy) {
  const { game } = boot();
  advance(20);
  const p = game.player;
  p.hasFood = false;
  game.food.airborne = true;
  game.food.vx = 0;
  game.food.vy = 0;
  game.food.x = p.x + p.width / 2 + dx;
  game.food.y = p.y + p.height / 2 + dy;
  tap('KeyE');
  const went = angleOfVec(p.vx, p.vy);
  game.destroy();
  return { went, wanted: angleOfVec(dx, dy) };
}

test('diving at a bag below you does not throw you upwards', () => {
  // Starting a dive clears `grounded`, so a downward dive used to satisfy
  // "was airborne, now landed" on its own first frame: it bounced off the
  // floor underfoot and fired you the opposite way. Straight down became
  // straight up, a 177-degree error.
  const { went } = diveAt(0, 400);
  assert.ok(went > -60,
    `a dive at a bag directly below should not go upwards, went ${went.toFixed(0)}deg`);
});

test('a grounded dive heads towards the bag, not away from it', () => {
  for (const [dx, dy, label] of [[300, 150, 'below-right'], [-300, 300, 'below-left']]) {
    const { went, wanted } = diveAt(dx, dy);
    // Standing on a floor you cannot dive through it, so the vertical part is
    // lost; the horizontal part must still point the right way.
    assert.ok(Math.sign(Math.cos(went * Math.PI / 180)) === Math.sign(dx),
      `${label}: dive went ${went.toFixed(0)}deg, bag was at ${wanted.toFixed(0)}deg`);
  }
});

test('an airborne dive points straight at the bag', () => {
  const { game } = boot();
  advance(20);
  jump(12);
  advance(4);
  const p = game.player;
  p.hasFood = false;
  game.food.airborne = true;
  game.food.vx = 0;
  game.food.vy = 0;
  game.food.x = p.x + p.width / 2 + 260;
  game.food.y = p.y + p.height / 2 + 180;
  tap('KeyE');
  const err = angleDiff(angleOfVec(p.vx, p.vy), angleOfVec(260, 180));
  game.destroy();
  assert.ok(err < 20, `dive should track the bag, was ${err.toFixed(0)}deg off`);
});

test('a dive keeps steering towards a bag that is falling away', () => {
  const { game } = boot(fixture({
    height: 2600, startPos: { x: 200, y: 100 }, foodPos: { x: 240, y: 100 },
    platforms: [{ x: 0, y: 2500, width: 3000, height: 100, type: 'static' }],
  }));
  advance(20);
  const p = game.player;
  p.hasFood = false;
  game.food.airborne = true;
  game.food.vx = 2;
  game.food.vy = 6;
  game.food.x = p.x + 240;
  game.food.y = p.y + 150;
  tap('KeyE');

  // Over the dive it should bend towards the bag rather than hold its opening
  // line, so the angle to the bag shrinks.
  const err = () => angleDiff(angleOfVec(p.vx, p.vy),
    angleOfVec((game.food.x - p.x), (game.food.y - p.y)));
  const first = err();
  let best = first;
  for (let i = 0; i < 12; i++) { advance(1); best = Math.min(best, err()); }
  game.destroy();
  assert.ok(best <= first + 1,
    `the dive should track, error went from ${first.toFixed(0)} to ${best.toFixed(0)}`);
});

// --- the air jump is visible ------------------------------------------------

test('an air jump spins the courier and leaves a ring', () => {
  const { game } = boot();
  advance(20);
  jump(10);
  advance(4);
  assert.equal(game.player.spin, 0, 'a plain jump does not spin');
  assert.equal(game.rings.length, 0);

  tap('Space');                       // the air jump
  assert.ok(game.player.spin > 0, 'the air jump should start a flip');
  assert.equal(game.rings.length, 1, 'and leave a ring behind it');

  // It settles: the flip must be over well before a landing.
  for (let i = 0; i < PHYSICS.airJumpSpinFrames + 2; i++) advance(1);
  assert.equal(game.player.spin, 0, 'the flip should finish');
  game.destroy();
});

test('the flip is animation only and never moves the player', () => {
  const run = (withSpin) => {
    const { game } = boot();
    advance(20);
    keys.down('KeyD');
    jump(10);
    advance(4);
    tap('Space');
    if (!withSpin) game.player.spin = 0;   // same jump, no flip
    advance(40);
    const at = { x: game.player.x, y: game.player.y };
    keys.up('KeyD');
    game.destroy();
    return at;
  };
  assert.deepEqual(run(true), run(false),
    'the flip must not change where the air jump takes you');
});
