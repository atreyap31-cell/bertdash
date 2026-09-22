// Scores how hard each level is, so the campaign can be ordered honestly.
//
// "Too easy" and "too hard" are not opinions you can act on until they are
// numbers. This measures four things that actually make a level hard and
// combines them:
//
//   tightness  how close the hardest move on the route is to the limit of what
//              the move can do. A 210px rise where the best jump manages 223 is
//              far harder than a 100px one, and this is the single biggest
//              factor in whether a section feels fair.
//   demands    whether the route needs the bag or a wall climb at all.
//   pressure   hazards and anything on a timer: spikes, lasers, doors, movers,
//              and platforms that vanish under you.
//   length     par time, because a long level is more chances to fail.
//
// It is a model, not a playtest. What it is good for is spotting a level that
// sits far off the curve its neighbours are on.
//
// Usage: node tools/difficulty.mjs [--verbose] [--csv]

import { installGlobals } from '../tests/harness.mjs';
installGlobals();

const { LEVELS } = await import('../js/data/levels.js');
const { prepareLevel, isSolidType } = await import('../js/engine/level.js');
const {
  MOVES, surfaces, spanGap, surfaceUnder, canReach, WALL_CLIMB, WALL_NEAR,
} = await import('./reach.mjs');

/** Cheapest move that makes a hop, and how much of its envelope it uses. */
function effort(level, from, to) {
  const gap = spanGap(from, to);
  const rise = from.yTop - to.yBottom;
  const gravity = level.physics.gravityScale || 1;
  const riseScale = 1 / gravity;

  if (rise <= 0) {
    // Falling is not free. What makes a descent hard is how small the thing
    // you have to land on is, and how far you drift getting there — scoring
    // every downward hop as zero rated a spike-lined shaft as easier than a
    // flat corridor.
    const landing = to.x2 - to.x1;
    const precision = 1 - Math.min(1, landing / 420);
    const drift = Math.min(1, gap / 760);
    return { use: Math.max(precision, drift * 0.8), move: 'fall' };
  }

  let best = null;
  for (const m of MOVES) {
    if (rise + 12 > m.rise * riseScale || gap + 12 > m.gap) continue;
    // How much of the move this hop consumes, on its tighter axis.
    const use = Math.max(rise / (m.rise * riseScale), gap / m.gap);
    if (!best || use < best.use) best = { use, move: m.name };
  }
  if (best) return best;

  // Only a wall climb is left, which is the least precise thing in the game.
  return { use: Math.min(1, rise / (WALL_CLIMB * riseScale)), move: 'wall climb' };
}

/** The route the search actually takes, as a list of hops. */
function route(raw) {
  const level = prepareLevel(raw);
  const all = surfaces(level);
  const start = surfaceUnder(all, level.startPos.x, level.startPos.y);
  if (!start) return null;

  const goals = all.filter(s =>
    level.goalPos.x > s.x1 - 90 && level.goalPos.x < s.x2 + 90
    && s.yBottom > level.goalPos.y - 40 && s.yTop < level.goalPos.y + 220);

  const prev = new Map([[start.i, null]]);
  const queue = [start];
  let end = null;
  while (queue.length && !end) {
    const at = queue.shift();
    if (goals.some(g => g.i === at.i)) { end = at; break; }
    for (const next of all) {
      if (prev.has(next.i)) continue;
      if (!canReach(level, at, next)) continue;
      prev.set(next.i, at);
      queue.push(next);
    }
  }
  if (!end) return null;

  const hops = [];
  for (let at = end; prev.get(at.i); at = prev.get(at.i)) {
    hops.push(effort(level, prev.get(at.i), at));
  }
  return { level, hops: hops.reverse() };
}

const HAZARDS = new Set(['spike', 'laser']);
const TIMED = new Set(['vanishing', 'moving', 'door', 'laser', 'crumbling']);

export function score(raw) {
  const found = route(raw);
  if (!found) return null;
  const { level, hops } = found;

  // Tightness: the hardest hop dominates, but a route full of tight ones is
  // harder than a route with a single spike in it.
  const uses = hops.map(h => h.use);
  const hardest = uses.length ? Math.max(...uses) : 0;
  const typical = uses.length ? uses.reduce((a, b) => a + b, 0) / uses.length : 0;
  const tightness = hardest * 0.7 + typical * 0.3;

  const needsBag = hops.some(h => h.move.startsWith('bag'));
  const needsWall = hops.some(h => h.move === 'wall climb');
  const demands = (needsBag ? 0.6 : 0) + (needsWall ? 0.4 : 0);

  const hazards = level.platforms.filter(p => HAZARDS.has(p.type)).length;
  const timed = level.platforms.filter(p => TIMED.has(p.type)).length;
  const vanishing = level.platforms.filter(p => p.type === 'vanishing').length;
  const area = (level.width * level.height) / 1e6;
  const pressure = Math.min(1,
    (hazards * 0.6 + timed * 0.5 + vanishing * 1.2) / Math.max(1, area * 6));

  const length = Math.min(1, (level.parTime ?? 0) / 45);

  const total = tightness * 45 + demands * 20 + pressure * 22 + length * 13;
  return {
    id: raw.id, title: raw.title,
    score: Math.round(total),
    tightness: +tightness.toFixed(2),
    demands: +demands.toFixed(2),
    pressure: +pressure.toFixed(2),
    length: +length.toFixed(2),
    hops: hops.length,
    needsBag, needsWall,
    par: +(level.parTime ?? 0).toFixed(1),
  };
}

const rows = LEVELS.map(score).filter(Boolean);

if (process.argv.includes('--csv')) {
  console.log('id,title,score,tightness,demands,pressure,length,par');
  for (const r of rows) {
    console.log([r.id, JSON.stringify(r.title), r.score, r.tightness, r.demands,
      r.pressure, r.length, r.par].join(','));
  }
} else {
  // How far each level sits from the line its position implies. The campaign
  // should climb: level 50 ought to be harder than level 5.
  const n = rows.length;
  const first = rows.slice(0, 8).reduce((a, r) => a + r.score, 0) / 8;
  const last = rows.slice(-8).reduce((a, r) => a + r.score, 0) / 8;
  const expected = i => first + (last - first) * (i / (n - 1));

  const off = rows
    .map((r, i) => ({ ...r, want: Math.round(expected(i)), delta: r.score - Math.round(expected(i)) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log(`Campaign difficulty, ${n} levels`);
  console.log(`  early levels average ${Math.round(first)}, late levels average ${Math.round(last)}\n`);

  console.log('Furthest from the curve their position implies:');
  for (const r of off.slice(0, 14)) {
    const tag = r.delta > 0 ? 'HARDER than its slot' : 'easier than its slot';
    console.log(`  ${String(r.id).padStart(2)} ${r.title.padEnd(22)} `
      + `score ${String(r.score).padStart(3)} vs ${String(r.want).padStart(3)} expected  `
      + `${String(r.delta > 0 ? '+' : '') + r.delta}  ${tag}`);
  }

  if (process.argv.includes('--verbose')) {
    console.log('\nEvery level in order:');
    for (const r of rows) {
      console.log(`  ${String(r.id).padStart(2)} ${r.title.padEnd(22)} ${String(r.score).padStart(3)}`
        + `  tight ${r.tightness.toFixed(2)}  demand ${r.demands.toFixed(2)}`
        + `  pressure ${r.pressure.toFixed(2)}  par ${r.par}s`);
    }
  }
}
