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
