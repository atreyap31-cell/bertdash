// Structural solvability check.
//
// Builds a graph of every surface the player can stand on and connects two
// surfaces when some move in the measured envelope gets you from one to the
// other, then breadth-first searches from the spawn to the goal. A level that
// fails this is definitely unfinishable; passing is a necessary condition, not
// a guarantee that the timing is fair.
//
// The envelope numbers come from tools/measure.mjs, which drives the real
// engine. Keep them in sync if the physics change.

import test from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals } from './harness.mjs';

installGlobals();

const { LEVELS } = await import('../js/data/levels.js');
const { prepareLevel, isSolidType } = await import('../js/engine/level.js');

// rise / gap each move can manage, with a safety margin already applied.
const MOVES = [
  { name: 'run jump',        rise: 179, gap: 329 },
  { name: 'air jump',        rise: 223, gap: 531 },
  { name: 'long jump',       rise: 112, gap: 712 },
  { name: 'long jump + air', rise: 135, gap: 1139 },
  { name: 'dive',            rise: 148, gap: 816 },
  { name: 'bag bounce',      rise: 320, gap: 416 },
  { name: 'bag bounce + air',rise: 320, gap: 695 },
];

const MAX_RISE = Math.max(...MOVES.map(m => m.rise));
const MAX_GAP = Math.max(...MOVES.map(m => m.gap));
const FALL_GAP = 760;     // how far you can drift sideways on the way down
const WALL_CLIMB = 800;   // rise achievable by kicking between two walls
const WALL_NEAR = 150;    // how close a wall must be to help
const MARGIN = 12;        // required clearance, so nothing is frame-perfect

/**
 * Every surface the player can land on, as a travel envelope rather than a
 * point: a moving platform is reachable anywhere along its run, which is what
 * makes a vertical lift a route rather than a ledge.
 */
function surfaces(level) {
  return level.platforms
    .filter(p => isSolidType(p.type))
    .map((p, i) => {
      let x1 = p.x;
      let x2 = p.x + p.width;
      let yTop = p.y;
      let yBottom = p.y;
      if (p.type === 'moving' && p.range > 0) {
        if (p.velX) { x1 = Math.min(x1, p.minX); x2 = Math.max(x2, p.maxX + p.width); }
        if (p.velY) { yTop = Math.min(yTop, p.minY); yBottom = Math.max(yBottom, p.maxY); }
      }
      return { i, x1, x2, yTop, yBottom, piece: p };
    });
}

/** Shortest horizontal distance between two spans (0 if they overlap). */
function spanGap(a, b) {
  if (a.x2 < b.x1) return b.x1 - a.x2;
  if (b.x2 < a.x1) return a.x1 - b.x2;
  return 0;
}

/** Is there a tall wall close enough to either surface to kick off? */
function wallBetween(level, a, b) {
  const lo = Math.min(a.x1, b.x1) - WALL_NEAR;
  const hi = Math.max(a.x2, b.x2) + WALL_NEAR;
  const top = Math.min(a.yTop, b.yTop);
  const bottom = Math.max(a.yBottom, b.yBottom);
  return level.platforms.some(p =>
    isSolidType(p.type) && p.height > 100 &&
    p.x + p.width > lo && p.x < hi &&
    p.y < bottom && p.y + p.height > top);
}

function canReach(level, from, to) {
  const gap = spanGap(from, to);
  // Best case: standing at the highest point `from` reaches, landing on the
  // lowest point `to` offers.
  const rise = from.yTop - to.yBottom;

  // Lower gravity means every jump goes higher, which is the whole point of
  // the low-gravity levels.
  const gravity = level.physics.gravityScale || 1;
  const riseScale = 1 / gravity;

  if (rise <= 0) {
    // Level or downhill: falling drifts a long way, and any jump's horizontal
    // reach is available too.
    return gap <= Math.max(FALL_GAP, MAX_GAP);
  }
  if (rise <= WALL_CLIMB * riseScale && wallBetween(level, from, to) && gap <= 420) {
    return true;                       // climb the shaft on wall kicks
  }
  return MOVES.some(m => rise + MARGIN <= m.rise * riseScale && gap + MARGIN <= m.gap);
}

/** The surface the player starts on, i.e. the first one below the spawn. */
function surfaceUnder(all, x, y) {
  const below = all
    .filter(s => x + 32 > s.x1 && x < s.x2 && s.yBottom >= y - 40)
    .sort((a, b) => a.yBottom - b.yBottom);
  return below[0] ?? null;
}

function analyse(raw) {
  const level = prepareLevel(raw);
  const all = surfaces(level);
  if (!all.length) return { ok: false, reason: 'no solid platforms' };

  const start = surfaceUnder(all, level.startPos.x, level.startPos.y);
  if (!start) return { ok: false, reason: 'nothing to stand on under the start marker' };

  // Any surface you could deliver from: within reach of Bert.
  const goalSurfaces = all.filter(s =>
    level.goalPos.x > s.x1 - 90 && level.goalPos.x < s.x2 + 90 &&
    s.yBottom > level.goalPos.y - 40 && s.yTop < level.goalPos.y + 220);
  if (!goalSurfaces.length) return { ok: false, reason: 'nothing to stand on near Bert' };

  const seen = new Set([start.i]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (goalSurfaces.some(g => g.i === current.i)) return { ok: true };
    for (const next of all) {
      if (seen.has(next.i)) continue;
      if (!canReach(level, current, next)) continue;
      seen.add(next.i);
      queue.push(next);
    }
  }
  return {
    ok: false,
    reason: `no route from the spawn to Bert (${seen.size}/${all.length} surfaces reachable)`,
  };
}

test('every level has a route from the spawn to Bert', () => {
  const broken = [];
  for (const raw of LEVELS) {
    const result = analyse(raw);
    if (!result.ok) broken.push(`level ${raw.id} "${raw.title}": ${result.reason}`);
  }
  assert.deepEqual(broken, [], `\n${broken.join('\n')}`);
});

test('the spawn is never buried inside solid geometry', () => {
  const buried = [];
  for (const raw of LEVELS) {
    const level = prepareLevel(raw);
    const box = { x: level.startPos.x, y: level.startPos.y, width: 32, height: 48 };
    const hit = level.platforms.find(p =>
      isSolidType(p.type) && p.height > 24 &&
      box.x < p.x + p.width && box.x + box.width > p.x &&
      box.y < p.y + p.height && box.y + box.height > p.y);
    if (hit) buried.push(`level ${raw.id} "${raw.title}" spawns inside a ${hit.type} at (${hit.x},${hit.y})`);
  }
  assert.deepEqual(buried, [], `\n${buried.join('\n')}`);
});

test('the bag never starts somewhere it would immediately be lost', () => {
  const bad = [];
  for (const raw of LEVELS) {
    const level = prepareLevel(raw);
    // The bag starts in hand, so it only needs to be near the player.
    const d = Math.hypot(level.foodPos.x - level.startPos.x, level.foodPos.y - level.startPos.y);
    if (d > 120) bad.push(`level ${raw.id} "${raw.title}": bag is ${Math.round(d)}px from the spawn`);
  }
  assert.deepEqual(bad, [], `\n${bad.join('\n')}`);
});

test('no level asks for a rise that no move can clear', () => {
  // Catches a shelf placed above even the bag bounce, which would be a
  // dead end that the route search might route around but a player could not.
  const problems = [];
  for (const raw of LEVELS) {
    const level = prepareLevel(raw);
    const all = surfaces(level);
    for (const s of all) {
      const reachable = all.some(other => other.i !== s.i && canReach(level, other, s));
      const isFloor = s.yBottom >= level.height - 220;
      if (!reachable && !isFloor) {
        problems.push(
          `level ${raw.id} "${raw.title}": surface at (${s.x1},${s.yTop}) is unreachable `
          + `(highest rise available is ${MAX_RISE}px)`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.slice(0, 12).join('\n')}`);
});
