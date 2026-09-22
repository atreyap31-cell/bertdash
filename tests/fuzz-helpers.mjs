// Shared setup for the two fuzzing suites.
//
// They are two files rather than one because the work is split across two
// processes on purpose: see tools/run-tests.mjs for the V8 access violation
// this machine hits, whose likelihood climbs sharply with how much one
// process does.

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

export { Game, LEVELS, TRAINING, ALL, isSolidType, rng, KEYS, overlaps, penetration, runLevel };
