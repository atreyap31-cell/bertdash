// Makes the campaign actually need the bag.
//
// 51 of 62 levels could be finished on legs alone — air jump plus wall kicks
// reach almost anything, so the throw was decoration. This raises Bert onto a
// shelf that only a bag bounce reaches, which turns the last stretch of each
// level into the move the whole game is built around.
//
// The early levels are left alone on purpose: levels 0-9 are still teaching
// you to run and jump, and gating those behind the hardest move in the game
// would be backwards.
//
// The search is driven by the reachability analyser rather than by geometry I
// work out here. For each level it lifts Bert a little further until the level
// stops being solvable on foot, and refuses any lift that would also make it
// unsolvable with the bag. That way the tool cannot talk itself into a level
// nobody can finish.
//
// Usage: node tools/bag-gate.mjs [--write]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installGlobals } from '../tests/harness.mjs';

installGlobals();

const { analyse, canReach, surfaces, surfaceUnder, WALL_NEAR } = await import('./reach.mjs');
const { prepareLevel, isSolidType } = await import('../js/engine/level.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Below this the campaign is still teaching the basics. */
const GATE_FROM = 10;

/** Drops to try, in pixels. Small steps first: gate it, do not chasm it. */
const DROPS = [244, 252, 260, 268, 276, 284, 292, 300];

/** A wall this tall beside the gap would let a climb bypass it entirely. */
const BYPASS_HEIGHT = 100;

/** Nothing may be pushed below this much headroom above the level's floor. */
const FLOOR_CLEARANCE = 120;

const levelsPath = join(ROOT, 'js/data/levels.js');
const source = readFileSync(levelsPath, 'utf8');
const marker = 'export const LEVELS = ';
const start = source.indexOf(marker) + marker.length;
const end = source.indexOf(';\n', start);
const LEVELS = JSON.parse(source.slice(start, end));

const clone = v => JSON.parse(JSON.stringify(v));

/** The solid piece Bert is standing on, if any. */
function goalPiece(level) {
  const prepared = prepareLevel(clone(level));
  const all = surfaces(prepared);
  const under = surfaceUnder(all, level.goalPos.x, level.goalPos.y);
  if (!under) return null;
  // Map back to the raw platform by identity of position and size.
  const p = under.piece;
  const index = level.platforms.findIndex(q =>
    q.x === p.x && q.y === p.y && q.width === p.width && q.height === p.height);
  return index >= 0 ? index : null;
}

/** Would this piece land on something if it dropped by `drop`? */
function blocked(level, index, drop) {
  const piece = level.platforms[index];
  const moved = { x: piece.x, y: piece.y + drop, width: piece.width, height: piece.height };
  if (moved.y + moved.height > level.height - FLOOR_CLEARANCE) return true;
  return level.platforms.some((q, i) =>
    i !== index && isSolidType(q.type)
    && moved.x < q.x + q.width && moved.x + moved.width > q.x
    // Leave standing room on top of it, not merely non-overlap.
    && moved.y - 70 < q.y + q.height && moved.y + moved.height > q.y);
}

/** Tall walls beside the new gap, which a climb would use to skip it. */
function bypassWalls(level, indices) {
  const lo = Math.min(...indices.map(i => level.platforms[i].x)) - WALL_NEAR;
  const hi = Math.max(...indices.map(i => level.platforms[i].x + level.platforms[i].width)) + WALL_NEAR;
  return level.platforms
    .map((q, i) => ({ q, i }))
    .filter(({ q, i }) =>
      !indices.includes(i) && isSolidType(q.type) && q.height > BYPASS_HEIGHT
      && q.x + q.width > lo && q.x < hi);
}

/**
 * Every surface that can currently reach Bert on foot.
 *
 * Lowering these rather than raising Bert is what makes this work at all: in a
 * vertical level Bert is already near the ceiling, so there is nowhere to lift
 * him to, and gating only one approach leaves the others open anyway.
 */
function footApproaches(level) {
  const prepared = prepareLevel(clone(level));
  const all = surfaces(prepared);
  const goal = surfaceUnder(all, level.goalPos.x, level.goalPos.y);
  if (!goal) return null;

  const rawIndex = surface => level.platforms.findIndex(q =>
    q.x === surface.piece.x && q.y === surface.piece.y
    && q.width === surface.piece.width && q.height === surface.piece.height);

  const approaches = all
    .filter(s => s.i !== goal.i && canReach(prepared, s, goal, { bag: false }))
    .map(rawIndex)
    .filter(i => i >= 0 && i !== rawIndex(goal));

  return { goal: rawIndex(goal), approaches: [...new Set(approaches)] };
}

function gate(level) {
  const found = footApproaches(level);
  if (!found) return { ok: false, why: 'Bert is not standing on anything' };
  if (!found.approaches.length) return { ok: false, why: 'nothing reaches Bert on foot to lower' };
  // Lowering the ground itself would drop the whole level, not gate it.
  const movable = found.approaches.filter(i => level.platforms[i].width < level.width * 0.6);
  if (!movable.length) return { ok: false, why: 'the only approach is the level floor' };

  for (const drop of DROPS) {
    if (movable.some(i => blocked(level, i, drop))) continue;

    const candidate = clone(level);
    for (const i of movable) candidate.platforms[i].y += drop;

    // A wall beside the new gap makes the drop pointless — you would climb it.
    // Shortening keeps it as scenery and as a surface.
    for (const { i } of bypassWalls(candidate, [...movable, found.goal])) {
      const w = candidate.platforms[i];
      const ceiling = candidate.platforms[found.goal].y + 40;
      if (w.y < ceiling && w.y + w.height > ceiling) {
        w.height = Math.max(20, w.y + w.height - ceiling);
        w.y = ceiling;
      }
    }

    const withBag = analyse(candidate);
    const onFoot = analyse(candidate, { bag: false });
    if (withBag.ok && !onFoot.ok) return { ok: true, drop, moved: movable.length, level: candidate };
  }
  return { ok: false, why: 'no drop both gates the level and keeps it solvable' };
}

const out = [];
const gated = [];
const skipped = [];
const failed = [];

for (const level of LEVELS) {
  const onFoot = analyse(level, { bag: false });
  if (level.id < GATE_FROM || !onFoot.ok) {
    out.push(level);
    if (level.id >= GATE_FROM) skipped.push(level);   // already needs the bag
    continue;
  }
  const result = gate(level);
  if (result.ok) {
    out.push(result.level);
    gated.push({ level, drop: result.drop, moved: result.moved });
  } else {
    out.push(level);
    failed.push({ level, why: result.why });
  }
}

console.log(`Levels ${GATE_FROM}+ gated behind a bag bounce: ${gated.length}`);
for (const g of gated) {
  console.log(`  ${String(g.level.id).padStart(2)}  ${g.level.title.padEnd(22)} ${g.moved} approach(es) lowered ${g.drop}px`);
}
console.log(`\nAlready required the bag: ${skipped.length}`);
console.log(`Left alone (levels 0-${GATE_FROM - 1}, still teaching): ` +
  `${LEVELS.filter(l => l.id < GATE_FROM).length}`);
if (failed.length) {
  console.log(`\nCould not gate ${failed.length}:`);
  for (const f of failed) console.log(`  ${String(f.level.id).padStart(2)}  ${f.level.title.padEnd(22)} ${f.why}`);
}

// Re-check the whole campaign before writing anything.
const stillBroken = out.filter(l => !analyse(l).ok);
if (stillBroken.length) {
  console.error(`\nREFUSING TO WRITE: ${stillBroken.length} level(s) became unsolvable.`);
  for (const l of stillBroken) console.error(`  ${l.id} ${l.title}`);
  process.exit(1);
}

const needing = out.filter(l => !analyse(l, { bag: false }).ok).length;
console.log(`\nCampaign now: ${needing}/${out.length} levels require the bag.`);

if (process.argv.includes('--write')) {
  const header = source.slice(0, source.indexOf(marker));
  const tail = source.slice(end);
  writeFileSync(levelsPath, `${header}${marker}${JSON.stringify(out)}${tail}`);
  console.log('levels.js written.');
} else {
  console.log('\n(dry run — pass --write to apply)');
}
