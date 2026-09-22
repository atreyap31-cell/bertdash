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

const { LEVELS, TRAINING } = await import('../js/data/levels.js');

// Training lessons get exactly the same scrutiny as the campaign.
const ALL = [...LEVELS, ...TRAINING];
const { prepareLevel, isSolidType } = await import('../js/engine/level.js');

// The movement model lives in tools/reach.mjs, shared with tools/bag-audit.mjs
// so the audit and this test can never disagree about what the player can do.
const {
  MOVES, surfaces, canReach, analyse, surfaceUnder,
} = await import('../tools/reach.mjs');

const MAX_RISE = Math.max(...MOVES.map(m => m.rise));

test('every level has a route from the spawn to Bert', () => {
  const broken = [];
  for (const raw of ALL) {
    const result = analyse(raw);
    if (!result.ok) broken.push(`level ${raw.id} "${raw.title}": ${result.reason}`);
  }
  assert.deepEqual(broken, [], `\n${broken.join('\n')}`);
});

test('the spawn is never buried inside solid geometry', () => {
  const buried = [];
  for (const raw of ALL) {
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
  for (const raw of ALL) {
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
  for (const raw of ALL) {
    const level = prepareLevel(raw);
    const all = surfaces(level);
    // The surface you start on never needs to be reachable — you are already
    // standing on it. In a descent level that is the highest thing there is,
    // and demanding a route up to it would be asking the player to climb back
    // to the start.
    const spawn = surfaceUnder(all, level.startPos.x, level.startPos.y);
    for (const s of all) {
      const reachable = all.some(other => other.i !== s.i && canReach(level, other, s));
      const isFloor = s.yBottom >= level.height - 220;
      if (!reachable && !isFloor && s.i !== spawn?.i) {
        problems.push(
          `level ${raw.id} "${raw.title}": surface at (${s.x1},${s.yTop}) is unreachable `
          + `(highest rise available is ${MAX_RISE}px)`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.slice(0, 12).join('\n')}`);
});

// --- spawn safety ----------------------------------------------------------

const PLAYER_BOX = { width: 32, height: 48 };
// Margin for the spawn settling and for landing drift.
const SPAWN_GRACE = 6;

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
      && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('no level spawns the player on something lethal', () => {
  const problems = [];
  for (const raw of ALL) {
    const level = prepareLevel(raw);
    const box = {
      x: level.startPos.x - SPAWN_GRACE,
      y: level.startPos.y - SPAWN_GRACE,
      width: PLAYER_BOX.width + SPAWN_GRACE * 2,
      height: PLAYER_BOX.height + SPAWN_GRACE * 2,
    };
    for (const p of level.platforms) {
      // Lasers cycle, so merely overlapping one means death within a second.
      const lethal = p.type === 'spike' || p.type === 'laser'
        || (p.type === 'door' && p.height > 24);
      if (lethal && boxesOverlap(box, p)) {
        problems.push(`level ${raw.id} "${raw.title}" spawns on a ${p.type} at (${p.x},${p.y})`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('no level drops the player onto something lethal', () => {
  // Standing still at the spawn must not land you on spikes either.
  const problems = [];
  for (const raw of ALL) {
    const level = prepareLevel(raw);
    const feet = level.startPos.y + PLAYER_BOX.height;
    const below = level.platforms.filter(p =>
      isSolidType(p.type)
      && level.startPos.x + PLAYER_BOX.width > p.x && level.startPos.x < p.x + p.width
      && p.y >= feet - 4);

    if (!below.length) {
      problems.push(`level ${raw.id} "${raw.title}": nothing below the spawn to land on`);
      continue;
    }
    const nearest = below.reduce((a, b) => (a.y <= b.y ? a : b));
    const drop = nearest.y - feet;
    if (drop > 400) {
      problems.push(`level ${raw.id} "${raw.title}": spawns ${Math.round(drop)}px above any ground`);
    }
    const landing = {
      x: level.startPos.x, y: nearest.y - PLAYER_BOX.height,
      width: PLAYER_BOX.width, height: PLAYER_BOX.height,
    };
    for (const p of level.platforms) {
      if ((p.type === 'spike' || p.type === 'laser') && boxesOverlap(landing, p)) {
        problems.push(`level ${raw.id} "${raw.title}": lands on a ${p.type} at (${p.x},${p.y})`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});


test('no two solid platforms are embedded in each other', () => {
  // A ledge buried in the side of a wall makes the collision resolver fight
  // itself: it pushes the player out of the wall while the ledge holds them
  // up, so standing there jitters and snags. PENTHOUSE RUN had a ledge 10px
  // into the bottom of a wall and read as glitchy because of it.
  //
  // Platforms that move are exempt — passing through things is what a lift
  // does. tools/unoverlap.mjs repairs anything this catches.
  const overlaps = (a, b) =>
    a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;

  const problems = [];
  for (const raw of ALL) {
    const level = prepareLevel(raw);
    const solid = level.platforms.filter(p => isSolidType(p.type) && p.type !== 'moving');
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        if (!overlaps(solid[i], solid[j])) continue;
        problems.push(`level ${raw.id} "${raw.title}": `
          + `${solid[i].type} at (${solid[i].x},${solid[i].y}) overlaps `
          + `${solid[j].type} at (${solid[j].x},${solid[j].y})`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.slice(0, 10).join('\n')}`);
});
