// Separates solid platforms that are embedded in each other.
//
// A ledge buried in the bottom of a wall is not a visual nit. The collision
// resolver pushes the player out of the wall while the ledge holds them up, so
// standing there jitters and snags — which is what PENTHOUSE RUN felt like.
//
// The repair is the collision resolver applied at authoring time: find the
// shallowest axis of overlap and trim the smaller piece back along it, which is
// the smallest change that separates them. A piece buried entirely inside
// another is redundant and is removed instead.
//
// Usage: node tools/unoverlap.mjs [--write]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installGlobals } from '../tests/harness.mjs';

installGlobals();

const { analyse } = await import('./reach.mjs');
const { isSolidType } = await import('../js/engine/level.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(ROOT, 'js/data/levels.js');
const src = readFileSync(path, 'utf8');

/** Reads one exported array literal out of levels.js. */
function slice(name) {
  const marker = `export const ${name} = `;
  const from = src.indexOf(marker) + marker.length;
  const crlf = src.indexOf(';\r\n', from);
  const lf = src.indexOf(';\n', from);
  const to = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
  return { from, to, value: JSON.parse(src.slice(from, to)) };
}

const levels = slice('LEVELS');
const training = slice('TRAINING');

const area = p => p.width * p.height;
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

/** Solid, and not something that moves through the world by design. */
const fixed = p => isSolidType(p.type) && p.type !== 'moving';

function pairs(level) {
  const out = [];
  const ps = level.platforms;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (!fixed(ps[i]) || !fixed(ps[j])) continue;
      if (overlaps(ps[i], ps[j])) out.push([ps[i], ps[j]]);
    }
  }
  return out;
}

const contains = (big, small) =>
  small.x >= big.x && small.y >= big.y
  && small.x + small.width <= big.x + big.width
  && small.y + small.height <= big.y + big.height;

/**
 * Trims the smaller piece out of the larger along whichever axis it is least
 * buried in.
 *
 * Trimming rather than moving matters: most of these are shelves deliberately
 * anchored into a wall, and sliding the whole shelf sideways would change the
 * level. Cutting off the buried part leaves the playable surface exactly where
 * the author put it.
 */
function separate(a, b) {
  const [small, big] = area(a) <= area(b) ? [a, b] : [b, a];

  const fromLeft = (small.x + small.width) - big.x;
  const fromRight = (big.x + big.width) - small.x;
  const fromTop = (small.y + small.height) - big.y;
  const fromBottom = (big.y + big.height) - small.y;

  const least = Math.min(fromLeft, fromRight, fromTop, fromBottom);
  if (least === fromTop) small.height -= fromTop;
  else if (least === fromBottom) { small.y += fromBottom; small.height -= fromBottom; }
  else if (least === fromLeft) small.width -= fromLeft;
  else { small.x += fromRight; small.width -= fromRight; }
  return Math.round(least);
}

let repaired = 0;
const touched = [];

for (const level of [...levels.value, ...training.value]) {
  let moved = 0;
  let removed = 0;

  // A piece entirely inside another is redundant geometry, not a shelf that
  // needs trimming. Trimming one would leave it with no size at all.
  for (let pass = 0; pass < 4; pass++) {
    const buried = pairs(level).find(([a, b]) => contains(a, b) || contains(b, a));
    if (!buried) break;
    const [a, b] = buried;
    const drop = contains(a, b) ? b : a;
    level.platforms.splice(level.platforms.indexOf(drop), 1);
    removed++;
  }

  // A trim can expose a new overlap, so keep going until it settles.
  for (let pass = 0; pass < 12; pass++) {
    const found = pairs(level);
    if (!found.length) break;
    for (const [a, b] of found) { separate(a, b); moved++; }
  }
  // Anything trimmed to nothing is gone.
  const before = level.platforms.length;
  level.platforms = level.platforms.filter(p => p.width > 0 && p.height > 0);
  removed += before - level.platforms.length;
  const left = pairs(level).length;
  if (moved || removed) {
    repaired += moved;
    const route = analyse(level);
    touched.push({ id: level.id, title: level.title, moved, removed, left, ok: route.ok, why: route.reason });
  }
}

for (const t of touched) {
  console.log(`${String(t.id).padEnd(6)} ${String(t.title).padEnd(22)} ${String(t.moved).padStart(3)} trim(s)`
    + (t.removed ? `, ${t.removed} redundant piece(s) removed` : '')
    + `${t.left ? `, ${t.left} still overlapping` : ''}`
    + `  ${t.ok ? 'still solvable' : 'BROKEN: ' + t.why}`);
}

const broken = touched.filter(t => !t.ok);
const stuck = touched.filter(t => t.left);
console.log(`\n${repaired} trim(s) across ${touched.length} level(s).`);

if (broken.length || stuck.length) {
  console.error('REFUSING TO WRITE: '
    + `${broken.length} level(s) became unsolvable, ${stuck.length} still overlap.`);
  process.exit(1);
}

if (process.argv.includes('--write')) {
  const out = src.slice(0, levels.from) + JSON.stringify(levels.value)
    + src.slice(levels.to, training.from) + JSON.stringify(training.value)
    + src.slice(training.to);
  writeFileSync(path, out);
  console.log('levels.js written.');
} else {
  console.log('(dry run — pass --write to apply)');
}
