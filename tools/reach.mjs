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
  { name: 'run jump',        rise: 179, gap: 329, bag: false, key: 'runJump' },
  { name: 'air jump',        rise: 223, gap: 531, bag: false, key: 'airJump' },
  { name: 'long jump',       rise: 112, gap: 712, bag: false, key: 'longJump' },
  { name: 'long jump + air', rise: 135, gap: 1139, bag: false, key: 'longJump' },
  { name: 'dive',            rise: 148, gap: 816, bag: false, key: 'dive' },
  { name: 'bag bounce',      rise: 320, gap: 416, bag: true, key: 'bag' },
  { name: 'bag bounce + air',rise: 320, gap: 695, bag: true, key: 'bag' },

  // Measured off a ledge in the engine (tools notes in build-levels.mjs): a
  // boosted bike carries 1,233px and a boosted car 1,686px, against 402px on
  // foot. Held at about 85% of that here, and only offered on a level that
  // actually has a vehicle in it.
  { name: 'bike + boost',     rise: 200, gap: 1040, bag: false, key: 'vehicle', vehicle: true },
  { name: 'car + boost',      rise: 100, gap: 1430, bag: false, key: 'vehicle', vehicle: true },
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

/** The player's width, i.e. the gap a route has to leave to be passable. */
const PLAYER_W = 32;
const SQUEEZE = PLAYER_W + 16;

/**
 * The narrowest clear horizontal gap anywhere in the corridor between two
 * surfaces.
 *
 * A climb is not a climb if there is nowhere to put the player. THE SHAFT had
 * landings spanning all but 40px of a 360px shaft, so every stage of it was a
 * 560px wall climb through a slot eight pixels wider than the courier. The
 * route search said it was fine, because it only ever asked whether the rise
 * and the gap were within a move's reach.
 */
function narrowestGap(level, from, to) {
  // Strictly between the two surfaces: each one blocks the corridor at its own
  // height by definition, and the floor you are standing on is not an obstacle.
  const top = Math.min(from.yTop, to.yTop) + 60;
  const bottom = Math.max(from.yTop, to.yTop) - 60;
  if (bottom - top < 40) return Infinity;

  // The channel is between the walls being kicked off, not the whole level.
  // Measuring wider than that counted the open floor either side of the shaft
  // as room to climb, which is exactly the space a shaft does not have.
  const mid = (Math.min(from.x1, to.x1) + Math.max(from.x2, to.x2)) / 2;
  const walls = level.platforms.filter(q =>
    isSolidType(q.type) && q.height > 100
    && q.y < bottom && q.y + q.height > top);
  const left = walls.filter(q => q.x + q.width <= mid)
    .reduce((best, q) => Math.max(best, q.x + q.width), -Infinity);
  const right = walls.filter(q => q.x >= mid)
    .reduce((best, q) => Math.min(best, q.x), Infinity);

  const lo = Number.isFinite(left) ? left : Math.min(from.x1, to.x1);
  const hi = Number.isFinite(right) ? right : Math.max(from.x2, to.x2);
  if (hi - lo < SQUEEZE) return hi - lo;

  let narrowest = Infinity;
  // Sample across the rise; a pinch anywhere in it blocks the whole route.
  const steps = Math.min(40, Math.max(4, Math.round((bottom - top) / 40)));
  for (let i = 0; i <= steps; i++) {
    const y = top + ((bottom - top) * i) / steps;
    const blocked = level.platforms
      .filter(q => q !== from.piece && q !== to.piece)
      .filter(q => isSolidType(q.type) && q.y <= y && q.y + q.height >= y
        && q.x + q.width > lo && q.x < hi)
      .map(q => [Math.max(lo, q.x), Math.min(hi, q.x + q.width)])
      .sort((a, b) => a[0] - b[0]);

    let cursor = lo;
    let widest = 0;
    for (const [a, b] of blocked) {
      widest = Math.max(widest, a - cursor);
      cursor = Math.max(cursor, b);
    }
    widest = Math.max(widest, hi - cursor);
    narrowest = Math.min(narrowest, widest);
  }
  return narrowest;
}

/**
 * Climbing to a surface means getting on top of it, which means getting around
 * its edge. This asks whether there is room to.
 *
 * THE SHAFT ended in a 400px slab laid across a 380px shaft, with Bert sitting
 * on top of it. The climb was fine, the landing surface was fine, and the two
 * were joined by a ten-pixel slot between the tops of the walls and the
 * underside of the slab. The courier is 48px tall. Nobody could finish that
 * level, and the search called it solvable three separate times, because it
 * only ever asked "can you get that high" and never "is the way out blocked by
 * the very thing you are climbing to".
 *
 * Only shafts are judged: without walls either side there is open air to swing
 * around through, and the search has other routes to try.
 */
function sealedFromBelow(level, from, to) {
  const piece = to.piece;
  if (!piece || piece.height == null) return false;
  const top = piece.y;
  const bottom = piece.y + piece.height;

  // Walls that form the shaft. Looked for a little below the slab as well as
  // beside it, because a shaft's walls typically stop at the lid rather than
  // carrying on past it.
  const walls = level.platforms.filter(q =>
    isSolidType(q.type) && q.height > 100
    && q.y < bottom + 140 && q.y + q.height > top);
  const mid = (Math.min(from.x1, to.x1) + Math.max(from.x2, to.x2)) / 2;
  const left = walls.filter(q => q.x + q.width <= mid)
    .reduce((best, q) => Math.max(best, q.x + q.width), -Infinity);
  const right = walls.filter(q => q.x >= mid)
    .reduce((best, q) => Math.min(best, q.x), Infinity);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;

  // Anything solid across the slab's own height band, including the slab.
  for (let y = top; y <= bottom; y += 8) {
    const blocked = level.platforms
      .filter(q => q !== from.piece)
      .filter(q => isSolidType(q.type) && q.y <= y && q.y + q.height >= y
        && q.x + q.width > left && q.x < right)
      .map(q => [Math.max(left, q.x), Math.min(right, q.x + q.width)])
      .sort((a, b) => a[0] - b[0]);

    let cursor = left;
    let widest = 0;
    for (const [a, b] of blocked) {
      widest = Math.max(widest, a - cursor);
      cursor = Math.max(cursor, b);
    }
    widest = Math.max(widest, right - cursor);
    if (widest < SQUEEZE) return true;
  }
  return false;
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
  const driveable = (level.vehicles?.length ?? 0) > 0;
  const useBag = opts.bag !== false;
  const gap = spanGap(from, to);
  const rise = from.yTop - to.yBottom;

  const gravity = level.physics.gravityScale || 1;
  const riseScale = 1 / gravity;

  if (rise <= 0) return gap <= Math.max(FALL_GAP, Math.max(...MOVES.map(m => m.gap)));

  // No move of any kind gets you on top of something that is lidding the shaft
  // you are in.
  if (sealedFromBelow(level, from, to)) return false;

  if (opts.wallClimb !== false
      && rise <= WALL_CLIMB * riseScale && wallBetween(level, from, to) && gap <= 420) {
    // A shaft you cannot fit up is not a route.
    return narrowestGap(level, from, to) >= SQUEEZE;
  }

  return MOVES.some(m =>
    (useBag || !m.bag)
    && (!m.vehicle || driveable)
    && opts[m.key] !== false
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
