// Structural solvability: which surfaces can reach which, and can the spawn
// reach Bert.
//
// Shared by tests/reachability.test.mjs (which asserts every level is
// finishable) and tools/bag-audit.mjs (which asks the opposite question: is a
// level finishable *without* the bag, i.e. does it actually teach the throw).
// Keeping one copy matters — two drifting copies of a movement model would
// have the audit and the test disagreeing about what the player can do.
//
// The envelope numbers come from tools/measure.mjs, which drives the real
// engine. Keep them in sync if the physics change.

import { prepareLevel, isSolidType } from '../js/engine/level.js';

/** rise / gap each move can manage, with a safety margin already applied. */
export const MOVES = [
  { name: 'run jump',        rise: 179, gap: 329, bag: false },
  { name: 'air jump',        rise: 223, gap: 531, bag: false },
  { name: 'long jump',       rise: 112, gap: 712, bag: false },
  { name: 'long jump + air', rise: 135, gap: 1139, bag: false },
  { name: 'dive',            rise: 148, gap: 816, bag: false },
  { name: 'bag bounce',      rise: 320, gap: 416, bag: true },
  { name: 'bag bounce + air',rise: 320, gap: 695, bag: true },
];

export const FALL_GAP = 760;     // how far you can drift sideways on the way down
export const WALL_CLIMB = 800;   // rise achievable by kicking between two walls
export const WALL_NEAR = 150;    // how close a wall must be to help
export const MARGIN = 12;        // required clearance, so nothing is frame-perfect

/** Reach of a charged 45-degree throw, from tools/throw-range.mjs. */
export const THROW_GAP = 700;
export const THROW_RISE = 250;

/** The best rise available without ever touching the bag. */
export const FOOT_RISE = Math.max(...MOVES.filter(m => !m.bag).map(m => m.rise));
/** The best rise available at all. */
export const BAG_RISE = Math.max(...MOVES.map(m => m.rise));

/** Height of the player, i.e. the headroom a surface needs to be stood on. */
const STAND_HEIGHT = 48;

/**
 * Is there room to stand anywhere along the top of this piece?
 *
 * Stacked wall segments look like a row of ledges to a naive reading, but
 * their tops are buried inside the segment above them. THE SHAFT was built
 * from nine 300px segments per side and the search happily hopped up the
 * phantom ledges, when in reality it is one unbroken 2,580px wall climb
 * against a measured limit of about 847px. The level was impossible and the
 * analyser said it was fine.
 */
function standable(level, piece) {
  const top = piece.y;
  const covers = level.platforms.filter(q =>
    q !== piece && isSolidType(q.type)
    && q.x < piece.x + piece.width && q.x + q.width > piece.x
    // Strictly above: a piece sharing this one's top surface is coplanar with
    // it, not standing on it. Two ground slabs at the same y are common.
    && q.y < top && q.y + q.height > top - STAND_HEIGHT);
  if (!covers.length) return true;

  // Any uncovered run along the top wide enough to stand in is enough.
  const spans = covers
    .map(q => [Math.max(piece.x, q.x), Math.min(piece.x + piece.width, q.x + q.width)])
    .sort((a, b) => a[0] - b[0]);
  let cursor = piece.x;
  for (const [a, b] of spans) {
    if (a - cursor >= 24) return true;
    cursor = Math.max(cursor, b);
  }
  return piece.x + piece.width - cursor >= 24;
}

export function surfaces(level) {
  return level.platforms
    .filter(p => isSolidType(p.type))
    .filter(p => standable(level, p))
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

export function spanGap(a, b) {
  if (a.x2 < b.x1) return b.x1 - a.x2;
  if (b.x2 < a.x1) return a.x1 - b.x2;
  return 0;
}

export function wallBetween(level, a, b) {
  const lo = Math.min(a.x1, b.x1) - WALL_NEAR;
  const hi = Math.max(a.x2, b.x2) + WALL_NEAR;
  const top = Math.min(a.yTop, b.yTop);
  const bottom = Math.max(a.yBottom, b.yBottom);
  return level.platforms.some(p =>
    isSolidType(p.type) && p.height > 100 &&
    p.x + p.width > lo && p.x < hi &&
    p.y < bottom && p.y + p.height > top);
}

/**
 * @param {object} opts `bag: false` removes every move that needs the bag, and
 *   with it the wall-climb shortcut is kept — the point of the restricted run
 *   is to model exactly what a player can do on foot.
 */
export function canReach(level, from, to, opts = {}) {
  const useBag = opts.bag !== false;
  const gap = spanGap(from, to);
  const rise = from.yTop - to.yBottom;

  const gravity = level.physics.gravityScale || 1;
  const riseScale = 1 / gravity;

  if (rise <= 0) return gap <= Math.max(FALL_GAP, Math.max(...MOVES.map(m => m.gap)));
  if (rise <= WALL_CLIMB * riseScale && wallBetween(level, from, to) && gap <= 420) return true;

  return MOVES.some(m =>
    (useBag || !m.bag)
    && rise + MARGIN <= m.rise * riseScale
    && gap + MARGIN <= m.gap);
}

export function surfaceUnder(all, x, y) {
  const below = all
    .filter(s => x + 32 > s.x1 && x < s.x2 && s.yBottom >= y - 40)
    .sort((a, b) => a.yBottom - b.yBottom);
  return below[0] ?? null;
}

/**
 * Breadth-first search from the spawn to Bert.
 *
 * @param {object} opts `bag: false` asks whether the level can be finished
 *   without ever using the bag as a launch, and also without delivering by
 *   throw — the question "does this level need the bag at all".
 */
export function analyse(raw, opts = {}) {
  const useBag = opts.bag !== false;
  const level = prepareLevel(raw);
  const all = surfaces(level);
  if (!all.length) return { ok: false, reason: 'no solid platforms' };

  const start = surfaceUnder(all, level.startPos.x, level.startPos.y);
  if (!start) return { ok: false, reason: 'nothing to stand on under the start marker' };

  const goalSurfaces = all.filter(s =>
    level.goalPos.x > s.x1 - 90 && level.goalPos.x < s.x2 + 90 &&
    s.yBottom > level.goalPos.y - 40 && s.yTop < level.goalPos.y + 220);

  const canThrowTo = surface => {
    const gap = Math.max(0,
      Math.max(surface.x1 - level.goalPos.x, level.goalPos.x - surface.x2));
    const rise = surface.yTop - level.goalPos.y;
    return gap <= THROW_GAP && rise <= THROW_RISE;
  };

  if (useBag && !goalSurfaces.length && !all.some(canThrowTo)) {
    return { ok: false, reason: 'Bert is neither standable-next-to nor within throwing range' };
  }

  const seen = new Set([start.i]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (goalSurfaces.some(g => g.i === current.i)) return { ok: true, reached: seen.size };
    // Delivering by throw is itself a use of the bag, so it does not count
    // when asking whether the level can be done without one.
    if (useBag && canThrowTo(current)) return { ok: true, reached: seen.size };
    for (const next of all) {
      if (seen.has(next.i)) continue;
      if (!canReach(level, current, next, opts)) continue;
      seen.add(next.i);
      queue.push(next);
    }
  }
  return {
    ok: false,
    reached: seen.size,
    total: all.length,
    reason: `no route from the spawn to Bert (${seen.size}/${all.length} surfaces reachable)`,
  };
}
