// Engine behaviour tests. Each one pins a bug that the previous build had.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, makeCanvas, advance, keys, resetClock } from './harness.mjs';

installGlobals();

const { Game } = await import('../js/engine/game.js');
const { prepareLevel, computeParTime, starsForTime } = await import('../js/engine/level.js');
const { LEVELS, CAMPAIGN_LENGTH } = await import('../js/data/levels.js');

const FLOOR_Y = 500;

/** A small level with a floor, used as the base for most tests. */
function fixture(overrides = {}) {
  return {
    id: 'test',
    title: 'Test',
    width: 2000,
    height: 600,
    background: '#101010',
    theme: 'horizontal',
    startPos: { x: 100, y: 400 },
    goalPos: { x: 1800, y: 470 },
    foodPos: { x: 140, y: 400 },
    physics: {},
    vehicles: [],
    powerups: [],
    platforms: [{ x: 0, y: FLOOR_Y, width: 2000, height: 100, type: 'static' }],
    ...overrides,
  };
}

function boot(level = fixture(), options = {}) {
  resetClock();
  const canvas = makeCanvas();
  const events = { win: null, lose: null, stats: new Map() };
  const game = new Game(canvas, level, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: result => { events.win = result; },
    onLose: reason => { events.lose = reason; },
    onStats: batch => batch.forEach((n, k) => events.stats.set(k, (events.stats.get(k) ?? 0) + n)),
    ...options,
  });
  game.start();
  return { game, canvas, events };
}

// --- basics ----------------------------------------------------------------

test('player falls under gravity and lands on the floor', () => {
  const { game } = boot();
  advance(90);
  assert.equal(game.player.grounded, true, 'should be standing');
  assert.equal(game.player.y + game.player.height, FLOOR_Y, 'feet should rest exactly on the floor');
  assert.equal(game.player.vy, 0);
});

test('fixed timestep: the same wall-clock time advances the sim equally at any frame rate', () => {
  const a = boot();
  advance(120, 1000 / 60);          // 2s at 60Hz
  const b = boot();
  advance(288, 1000 / 144);         // 2s at 144Hz

  // Both should have covered the same simulated distance to within one step.
  assert.ok(Math.abs(a.game.elapsed - b.game.elapsed) <= 1000 / 60 + 0.001,
    `elapsed differed: ${a.game.elapsed} vs ${b.game.elapsed}`);
});

test('holding jump does not bunny-hop; it is edge triggered', () => {
  const { game } = boot();
  advance(90);
  assert.equal(game.player.grounded, true);

  keys.down('Space');
  advance(6);
  const airborne = !game.player.grounded;
  assert.ok(airborne, 'first press should jump');

  // Keep the key held for long enough to land and, in the old build, re-jump.
  advance(200);
  keys.up('Space');
  assert.equal(game.player.grounded, true, 'should have settled on the ground while still holding jump');
});

test('coyote time lets you jump just after walking off a ledge', () => {
  const level = fixture({
    platforms: [{ x: 0, y: FLOOR_Y, width: 300, height: 100, type: 'static' }],
    startPos: { x: 250, y: 400 },
  });
  const { game } = boot(level);
  advance(90);
  assert.equal(game.player.grounded, true);

  keys.down('KeyD');
  advance(12);                       // run off the edge
  keys.up('KeyD');
  assert.equal(game.player.grounded, false, 'should be off the ledge');

  keys.down('Space');
  advance(2);
  keys.up('Space');
  assert.ok(game.player.vy < 0, 'coyote jump should still produce upward velocity');
});

// --- win / lose latching ---------------------------------------------------

test('reaching the goal fires onWin exactly once', () => {
  const level = fixture({ goalPos: { x: 120, y: 430 } });
  const { game, events } = boot(level);
  advance(240);
  assert.ok(events.win, 'should have won');
  const first = events.win;
  events.win = null;
  advance(120);
  assert.equal(events.win, null, 'onWin must not fire again while standing on the goal');
  assert.ok(first.timeMs > 0);
});

test('a death fires onLose once and reports the first cause', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 2000, height: 100, type: 'static' },
      { x: 90, y: 440, width: 200, height: 40, type: 'spike' },
    ],
  });
  const { game, events } = boot(level);
  advance(240);
  assert.equal(events.lose, 'SPIKE');
  events.lose = null;
  advance(240);
  assert.equal(events.lose, null, 'onLose must not repeat');
});

test('falling out of the world is a loss', () => {
  const level = fixture({ platforms: [] });
  const { events } = boot(level);
  advance(400);
  assert.equal(events.lose, 'FELL');
});

test('you cannot win without the bag', () => {
  // The goal is inside the win radius at spawn, so empty the player's hands
  // before the first step rather than after it.
  const level = fixture({ goalPos: { x: 120, y: 430 } });
  const { game, events } = boot(level);
  game.player.hasFood = false;
  game.food.airborne = true;
  game.food.x = 400;               // out of catch range, above the floor
  game.food.y = -5000;
  game.food.vx = 0;
  game.food.vy = 0;
  advance(30);
  assert.equal(events.win, null, 'the delivery only counts with the bag in hand');
  assert.equal(events.lose, null, 'and it has not been dropped either');
});

// --- platform types --------------------------------------------------------

test('moving platforms ping-pong and carry the player', () => {
  const level = fixture({
    platforms: [{
      x: 100, y: FLOOR_Y, width: 200, height: 20, type: 'moving',
      velX: 3, range: 240, startPos: { x: 100, y: FLOOR_Y },
    }],
    startPos: { x: 150, y: 400 },
  });
  const { game } = boot(level);
  advance(60);
  const plat = game.level.platforms[0];
  assert.equal(game.player.grounded, true, 'should be riding the platform');

  const platStart = plat.x;
  const playerStart = game.player.x;
  advance(40);
  assert.notEqual(plat.x, platStart, 'platform should have moved');
  assert.ok(Math.abs((game.player.x - playerStart) - (plat.x - platStart)) < 2,
    'player should travel with the platform');

  // It must reverse rather than run away forever.
  advance(400);
  assert.ok(plat.x >= 100 - 1 && plat.x <= 100 + 240 + 1, `platform escaped its range: ${plat.x}`);
});

test('lasers cycle on and off and only kill while on', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 2000, height: 100, type: 'static' },
      { x: 600, y: 300, width: 10, height: 200, type: 'laser', interval: 2000, offset: 0 },
    ],
  });
  const { game } = boot(level);
  const laser = game.level.platforms[1];
  advance(10);
  const early = laser.active;
  advance(70);                      // ~1.2s later, past the half-interval
  assert.notEqual(laser.active, early, 'laser should have toggled within one interval');
});

test('vanishing platforms fade after being stood on, then return', () => {
  const level = fixture({
    platforms: [{ x: 60, y: FLOOR_Y, width: 200, height: 20, type: 'vanishing', opacity: 1 }],
    startPos: { x: 100, y: 400 },
  });
  const { game } = boot(level);
  const plat = game.level.platforms[0];
  advance(40);
  assert.equal(game.player.grounded, true, 'should land on it first');

  advance(45);                      // ~750ms of standing
  assert.ok(plat.opacity < 1, 'should be fading');

  advance(160);                     // let it disappear and come back
  assert.ok(plat.opacity > 0.4, `should have respawned, opacity was ${plat.opacity}`);
});

test('conveyors push whatever stands on them', () => {
  const level = fixture({
    platforms: [{ x: 0, y: FLOOR_Y, width: 2000, height: 100, type: 'static', conveyorVel: 4 }],
  });
  const { game } = boot(level);
  advance(60);
  const before = game.player.x;
  advance(30);
  assert.ok(game.player.x > before + 50, `conveyor should have carried the player, moved ${game.player.x - before}`);
});

test('doors are solid while closed and passable while open', () => {
  const level = fixture({
    platforms: [
      { x: 0, y: FLOOR_Y, width: 2000, height: 100, type: 'static' },
      { x: 400, y: 380, width: 40, height: 120, type: 'door', interval: 100000, offset: 0 },
    ],
  });
  const { game } = boot(level);
  const door = game.level.platforms[1];
  advance(40);
  assert.equal(door.active, true, 'door starts closed with this interval');

  keys.down('KeyD');
  advance(120);
  keys.up('KeyD');
  assert.ok(game.player.x + game.player.width <= 401, `player should be stopped by the door, at ${game.player.x}`);
});

// --- food ------------------------------------------------------------------

/**
 * Throws at a world point, mirroring how the canvas maps pointer coords.
 * Press starts the wind-up and release lets go, so a throw needs both.
 * `chargeFrames` holds the button down to build power first.
 */
function throwAt(game, canvas, worldX, worldY, chargeFrames = 0) {
  const event = {
    clientX: worldX - game.camera.x,
    clientY: worldY - game.camera.y,
    preventDefault() {},
  };
  canvas.dispatch('pointermove', event);
  canvas.dispatch('pointerdown', event);
  if (chargeFrames) advance(chargeFrames);
  canvas.dispatch('pointerup', event);
}

test('throwing releases the bag and hitting a surface loses the run', () => {
  const { game, canvas, events } = boot();
  advance(60);
  assert.equal(game.player.hasFood, true);

  throwAt(game, canvas, game.player.x + 300, game.player.y);
  assert.equal(game.player.hasFood, false, 'throw should release the bag');
  assert.equal(game.food.airborne, true);

  advance(300);
  assert.equal(events.lose, 'DROPPED', 'the bag landing is a failed delivery');
});

test('the bag can be caught back out of the air', () => {
  const { game, canvas, events } = boot();
  advance(60);
  // Throw straight up so it falls back into the catch radius.
  throwAt(game, canvas, game.player.x + 16, game.player.y - 400);
  assert.equal(game.player.hasFood, false);

  advance(200);
  assert.equal(events.lose, null, 'a caught bag is not a loss');
  assert.equal(game.player.hasFood, true, 'the bag should be back in hand');
});

test('the aim preview stops at the first surface it would hit', () => {
  const { game } = boot();
  advance(60);
  game.aim = { x: game.player.x + 400, y: game.player.y };
  const arc = game.predictThrow();
  assert.ok(arc.length > 1, 'should produce a trajectory');
  const last = arc.at(-1);
  assert.ok(last.y <= FLOOR_Y + 40, `preview ran past the floor to y=${last.y}`);
});

// --- pickups and vehicles --------------------------------------------------

test('powerups apply a timed buff and are consumed once', () => {
  const level = fixture({
    powerups: [{ id: 'p1', type: 'speed', pos: { x: 100, y: 440 }, width: 40, height: 60 }],
  });
  const { game } = boot(level);
  advance(80);
  assert.ok(game.player.buffs.speed > 0, 'speed buff should be active');
  assert.equal(game.level.powerups[0].collected, true);
});

test('vehicles are boarded on contact and left with Q', () => {
  const level = fixture({
    vehicles: [{ id: 'v1', type: 'bike', pos: { x: 100, y: 440 }, width: 60, height: 60 }],
  });
  const { game } = boot(level);
  advance(80);
  assert.ok(game.player.vehicle, 'should have boarded the bike');

  keys.down('KeyQ');
  advance(2);
  keys.up('KeyQ');
  assert.equal(game.player.vehicle, null, 'Q should dismount');
});

// --- per-level physics -----------------------------------------------------

test('gravityScale actually changes the fall', () => {
  const light = boot(fixture({ physics: { gravityScale: 0.3 } }));
  const heavy = boot(fixture({ physics: { gravityScale: 1.8 } }));
  advance(0);
  // Step each the same number of frames and compare how far they fell.
  const fall = ({ game }) => {
    const y0 = game.player.y;
    advance(20);
    return game.player.y - y0;
  };
  const lightFall = fall(light);
  resetClock();
  light.game.destroy();

  const heavy2 = boot(fixture({ physics: { gravityScale: 1.8 } }));
  const heavyFall = fall(heavy2);
  assert.ok(heavyFall > lightFall, `heavier gravity should fall further (${heavyFall} vs ${lightFall})`);
  heavy.game.destroy();
  heavy2.game.destroy();
});

test('windX pushes the player sideways', () => {
  const calm = boot(fixture());
  advance(60);
  const calmX = calm.game.player.x;
  calm.game.destroy();

  const windy = boot(fixture({ physics: { windX: -0.8 } }));
  advance(60);
  assert.ok(windy.game.player.x < calmX - 5, 'wind should have moved the player left');
  windy.game.destroy();
});

test('wallSlideEnabled:false disables wall sliding', () => {
  const level = fixture({
    physics: { wallSlideEnabled: false },
    platforms: [
      { x: 0, y: FLOOR_Y, width: 2000, height: 100, type: 'static' },
      { x: 200, y: 200, width: 40, height: 300, type: 'static' },
    ],
    startPos: { x: 150, y: 250 },
  });
  const { game } = boot(level);
  keys.down('KeyD');
  advance(30);
  keys.up('KeyD');
  assert.equal(game.player.wallSliding, false);
});

// --- teardown --------------------------------------------------------------

test('destroy stops the loop and removes listeners', () => {
  const { game } = boot();
  advance(10);
  const elapsed = game.elapsed;
  game.destroy();
  const ran = advance(10);
  assert.equal(ran, 0, 'no further frames should be scheduled');
  assert.equal(game.elapsed, elapsed);
});

// --- level data integrity --------------------------------------------------

test('every shipped level prepares and is internally consistent', () => {
  assert.ok(LEVELS.length >= 34, 'the campaign should not shrink');
  assert.equal(LEVELS.length, CAMPAIGN_LENGTH + 1, 'CAMPAIGN_LENGTH excludes the tutorial');
  for (const raw of LEVELS) {
    const level = prepareLevel(raw);
    const where = `level ${raw.id} (${raw.title})`;

    assert.ok(level.width > 0 && level.height > 0, `${where}: bad dimensions`);
    assert.ok(Number.isFinite(level.parTime) && level.parTime > 0, `${where}: bad par time`);

    for (const point of ['startPos', 'goalPos', 'foodPos']) {
      const { x, y } = level[point];
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${where}: ${point} is not finite`);
      assert.ok(x >= -200 && x <= level.width + 200, `${where}: ${point}.x out of bounds (${x})`);
      assert.ok(y >= -200 && y <= level.height + 400, `${where}: ${point}.y out of bounds (${y})`);
    }

    for (const p of level.platforms) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${where}: platform position not finite`);
      assert.ok(p.width > 0 && p.height > 0, `${where}: platform has no area`);
      if (p.type === 'moving') {
        assert.ok(p.range > 0, `${where}: moving platform has no range`);
        assert.ok(p.velX !== 0 || p.velY !== 0, `${where}: moving platform has no velocity`);
      }
    }
  }
});

test('par times are sane and stars are monotonic', () => {
  for (const raw of LEVELS) {
    const par = computeParTime(prepareLevel(raw));
    assert.ok(par >= 6 && par < 200, `level ${raw.id} par ${par} is out of range`);
  }
  const par = 20;
  const grades = [10, 20, 26, 35, 51, 90].map(s => starsForTime(s, par));
  for (let i = 1; i < grades.length; i++) {
    assert.ok(grades[i] <= grades[i - 1], `stars should never increase with time: ${grades}`);
  }
  assert.equal(starsForTime(par, par), 5);
  assert.equal(starsForTime(par * 5, par), 1);
});

test('every level is reachable from the level select', () => {
  // The menu offers LEVELS.slice(1) as levels 1..N plus the tutorial at 0, so
  // the ids have to be a gapless run starting at 0 or the buttons mislabel.
  assert.equal(LEVELS[0].id, 0);
  const ids = LEVELS.map(l => l.id);
  assert.deepEqual(ids, [...Array(LEVELS.length).keys()],
    `level ids should be 0..${LEVELS.length - 1} in order`);
});
