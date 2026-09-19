// Invariant fuzzing: drive every shipped level with pseudo-random input and
// assert the simulation never breaks its own rules.
//
// This is the net that catches geometry glitches — clipping into walls, NaN
// velocities, the player escaping the level — which are easy to miss by eye and
// impossible to cover with hand-written cases across 34 levels.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, makeCanvas, advance, resetClock } from './harness.mjs';

installGlobals();

const { Game } = await import('../js/engine/game.js');
const { LEVELS, TRAINING } = await import('../js/data/levels.js');
const ALL = [...LEVELS, ...TRAINING];
const { isSolidType } = await import('../js/engine/level.js');

/** Deterministic PRNG so a failure can be reproduced from its seed. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Movement is WASD; the arrows aim and throw the bag.
const KEYS = ['KeyA', 'KeyD', 'Space', 'KeyS', 'KeyE', 'KeyQ', 'ShiftLeft',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** How deeply the player is buried inside a solid, non-pass-through platform. */
function penetration(player, plat) {
  const dx = Math.min(player.x + player.width - plat.x, plat.x + plat.width - player.x);
  const dy = Math.min(player.y + player.height - plat.y, plat.y + plat.height - player.y);
  return Math.min(dx, dy);
}

function runLevel(levelSource, seed, frames = 600) {
  resetClock();
  const canvas = makeCanvas({ record: false });
  const problems = [];
  let outcome = null;

  const game = new Game(canvas, levelSource, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: () => { outcome = 'win'; },
    onLose: reason => { outcome = reason; },
    onStats: () => {},
  });
  game.start();

  const random = rng(seed);
  const held = new Set();

  for (let frame = 0; frame < frames; frame++) {
    // Churn the input set a few times a second.
    if (frame % 7 === 0) {
      const key = KEYS[Math.floor(random() * KEYS.length)];
      if (held.has(key)) { held.delete(key); globalThis.dispatchWindow('keyup', { code: key }); }
      else { held.add(key); globalThis.dispatchWindow('keydown', { code: key, repeat: false, preventDefault() {} }); }
    }

    advance(1);

    const p = game.player;
    const f = game.food;

    // 1. Nothing may go non-finite.
    for (const [name, value] of Object.entries({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, fx: f.x, fy: f.y })) {
      if (!Number.isFinite(value)) problems.push(`frame ${frame}: player.${name} is ${value}`);
    }

    // 2. The player must stay inside the level horizontally.
    if (p.x < -1 || p.x + p.width > game.level.width + 1) {
      problems.push(`frame ${frame}: player escaped horizontally at x=${p.x.toFixed(1)}`);
    }

    // 3. The player must never be buried inside solid geometry. Small
    //    overlaps are normal mid-resolution; deep ones mean clipping.
    if (!game.deathReason && !game.finished) {
      for (const plat of game.level.platforms) {
        if (!isSolidType(plat.type) || plat.oneWay) continue;
        if (plat.type === 'door' && !plat.active) continue;
        if (plat.type === 'vanishing' && (plat.opacity <= 0.05 || plat.respawnAt > 0)) continue;
        if (!overlaps(p, plat)) continue;
        const depth = penetration(p, plat);
        if (depth > 12) {
          problems.push(
            `frame ${frame}: player ${depth.toFixed(1)}px inside ${plat.type} `
            + `at (${plat.x},${plat.y}) ${plat.width}x${plat.height}`);
        }
      }
    }

    // 4. The player box must stay coherent.
    if (p.height <= 0 || p.width <= 0) problems.push(`frame ${frame}: bad player size ${p.width}x${p.height}`);

    if (problems.length) break; // one report per run is enough
    if (outcome) break;
  }

  game.destroy();
  return { problems, outcome };
}

// 54 levels x 2 seeds x 600 frames is about 65k simulated frames. Pushing much
// past this intermittently trips a V8 crash in the Node 24 test runner's child
// processes (a fatal "unreachable code", not a failure in the game), so the
// workload is deliberately held here.
test('no level produces a geometry or numeric glitch under random input', () => {
  const failures = [];
  for (const level of LEVELS) {
    for (const seed of [1, 7]) {
      const { problems } = runLevel(level, seed);
      if (problems.length) {
        failures.push(`level ${level.id} "${level.title}" seed ${seed}: ${problems[0]}`);
      }
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

test('the simulation stays stable when the player is spawned inside a wall', () => {
  // Defensive: a custom level can easily place the start marker inside geometry.
  const level = {
    id: 'stuck', title: 'Stuck', width: 1200, height: 600, background: '#000',
    theme: 'horizontal', physics: {}, vehicles: [], powerups: [],
    startPos: { x: 200, y: 300 },
    goalPos: { x: 1000, y: 460 },
    foodPos: { x: 240, y: 300 },
    platforms: [
      { x: 0, y: 500, width: 1200, height: 100, type: 'static' },
      { x: 180, y: 280, width: 200, height: 200, type: 'static' }, // swallows the spawn
    ],
  };
  const { problems } = runLevel(level, 99, 300);
  const fatal = problems.filter(p => p.includes('is NaN') || p.includes('is Infinity'));
  assert.deepEqual(fatal, [], problems.join('\n'));
});

test('extreme per-level physics do not destabilise the loop', () => {
  const base = {
    id: 'x', title: 'Extreme', width: 2000, height: 800, background: '#000',
    theme: 'horizontal', vehicles: [], powerups: [],
    startPos: { x: 100, y: 400 }, goalPos: { x: 1900, y: 660 }, foodPos: { x: 140, y: 400 },
    platforms: [{ x: 0, y: 700, width: 2000, height: 100, type: 'static' }],
  };
  const extremes = [
    { gravityScale: 0.05 }, { gravityScale: 4 },
    { moveSpeedScale: 0.1 }, { moveSpeedScale: 4 },
    { jumpForceScale: 0.2 }, { jumpForceScale: 3 },
    { windX: -4 }, { windX: 4 },
    { friction: 0.2 }, { friction: 0.999 },
  ];
  for (const physics of extremes) {
    const { problems } = runLevel({ ...base, physics }, 5, 400);
    assert.deepEqual(problems, [], `physics ${JSON.stringify(physics)}:\n${problems.join('\n')}`);
  }
});

test('sliding into a low tunnel and standing up must not clip the ceiling', () => {
  // A 30px gap: tall enough to slide through (26px), too short to stand in
  // (48px). The player must stay crouched instead of growing into the roof.
  const ROOF = { x: 300, y: 380, width: 500, height: 90, type: 'static' };
  const level = {
    id: 'crawl', title: 'Crawl', width: 1400, height: 600, background: '#000',
    theme: 'horizontal', physics: {}, vehicles: [], powerups: [],
    startPos: { x: 120, y: 440 },
    goalPos: { x: 1300, y: 460 },
    foodPos: { x: 150, y: 440 },
    platforms: [{ x: 0, y: 500, width: 1400, height: 100, type: 'static' }, ROOF],
  };

  resetClock();
  const canvas = makeCanvas({ record: false });
  const game = new Game(canvas, level, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  game.start();

  const down = code => globalThis.dispatchWindow('keydown', { code, repeat: false, preventDefault() {} });
  const up = code => globalThis.dispatchWindow('keyup', { code });

  advance(40);                       // settle on the floor
  down('KeyD');
  advance(14);                       // build up speed toward the tunnel mouth
  down('KeyS'); advance(1); up('KeyS');  // slide in

  let enteredTunnel = false;
  const worst = { depth: 0, frame: -1, height: 0 };

  for (let frame = 0; frame < 220; frame++) {
    advance(1);
    const p = game.player;
    // "Inside the tunnel" means horizontally within the roof's span.
    if (p.x > ROOF.x + 20 && p.x + p.width < ROOF.x + ROOF.width - 20) enteredTunnel = true;
    if (overlaps(p, ROOF)) {
      const depth = penetration(p, ROOF);
      if (depth > worst.depth) { worst.depth = depth; worst.frame = frame; worst.height = p.height; }
    }
    // Keep trying to stand up while under the roof.
    if (frame % 30 === 0) { down('KeyS'); advance(1); up('KeyS'); }
  }
  up('KeyD');
  game.destroy();

  assert.ok(enteredTunnel, 'the player never reached the tunnel, so this test proved nothing');
  assert.ok(worst.depth <= 4,
    `player clipped ${worst.depth.toFixed(1)}px into the ceiling at frame ${worst.frame} `
    + `(height ${worst.height})`);
});

test('standing still at the spawn is survivable in every level', () => {
  // The strongest form of the check: actually run each level for two seconds
  // with no input at all, and make sure nothing kills you.
  const deaths = [];
  for (const raw of ALL) {
    resetClock();
    const canvas = makeCanvas({ record: false });
    let cause = null;
    const game = new Game(canvas, raw, {
      skin: { color: '#06c167', textColor: '#fff' },
      onWin: () => {}, onLose: reason => { cause ??= reason; }, onStats: () => {},
    });
    game.start();
    advance(150);                      // ~2.5 seconds of doing nothing
    game.destroy();
    if (cause) deaths.push(`level ${raw.id} "${raw.title}" died doing nothing: ${cause}`);
  }
  assert.deepEqual(deaths, [], `\n${deaths.join('\n')}`);
});
