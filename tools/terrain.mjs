// Turns floating bars into terrain.
//
// Forty of the sixty-eight campaign levels were a row of thin ledges hanging in
// empty space, which is why so many of them look like the same level.
//
// The trick that makes this safe is that a platform is only ever extended
// *downward*. Its standable top stays exactly where the author put it, so every
// jump, gap and route in the level is untouched — what changes is that the bar
// becomes a mesa, a pillar or a building instead of a floating line.
//
// Anything that would swallow a hazard, close a gap the route falls through, or
// collide with what is below it is left alone, and the whole campaign is
// re-checked for solvability before a single byte is written.
//
// Usage: node tools/terrain.mjs [--write]

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

function slice(name) {
  const marker = `export const ${name} = `;
  const from = src.indexOf(marker) + marker.length;
  const crlf = src.indexOf(';\r\n', from);
  const lf = src.indexOf(';\n', from);
  const to = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
  return { from, to, value: JSON.parse(src.slice(from, to)) };
}

const levels = slice('LEVELS');

/** Deterministic per level and platform, so re-running gives the same shapes. */
const rand = (a, b) => ((a * 9301 + b * 49297 + 233280) % 233280) / 233280;

const THIN = 30;
const CLEAR = 60;          // room left between a new pillar and whatever is under it

/** How far down this bar can grow before it hits something. */
function room(level, plat) {
  const below = level.platforms
    .filter(q => q !== plat && isSolidType(q.type)
      && q.x < plat.x + plat.width && q.x + q.width > plat.x
      && q.y >= plat.y + plat.height)
    .map(q => q.y);
  const hazard = level.platforms
    .filter(q => q !== plat && !isSolidType(q.type)
      && q.x < plat.x + plat.width && q.x + q.width > plat.x
      && q.y >= plat.y + plat.height)
    .map(q => q.y);
  // Nothing may grow down onto where the player starts, where the bag starts,
  // or onto Bert. In a vertical climb the bar above the spawn is the obvious
  // trap: it has clear space beneath it right up until it swallows you.
  const marks = [level.startPos, level.foodPos, level.goalPos]
    .filter(m => m && m.x + 60 > plat.x && m.x - 20 < plat.x + plat.width)
    .map(m => m.y - 90);

  const floor = Math.min(level.height, ...below, ...hazard, ...marks);
  return floor - (plat.y + plat.height) - CLEAR;
}

let changed = 0;
const touched = [];

for (const level of levels.value) {
  const solid = level.platforms.filter(p => isSolidType(p.type) && p.type !== 'moving');
  const bars = solid.filter(p => p.height <= THIN && p.width >= 80);
  if (bars.length < 3) continue;

  const before = JSON.stringify(level.platforms);
  let grown = 0;

  bars.forEach((bar, i) => {
    // Leave roughly a third floating: terrain with nothing hanging in it reads
    // as flat, and some of these bars are deliberately platforms in the air.
    if (rand(level.id + 7, i * 13) < 0.34) return;

    const available = room(level, bar);
    if (available < 70) return;

    // Vary the shape: some reach whatever is below, some stop short as ledges
    // on a face, so a level is not a row of identical columns.
    const style = rand(level.id * 3, i * 29);
    const depth = style < 0.45 ? available
      : style < 0.75 ? available * 0.55
      : available * 0.3;

    bar.height += Math.round(Math.max(60, depth));
    grown++;
  });

  if (!grown) continue;

  if (!analyse(level).ok) {
    level.platforms = JSON.parse(before);   // put it back, untouched
    continue;
  }
  changed += grown;
  touched.push({ id: level.id, title: level.title, grown, of: bars.length });
}

for (const t of touched) {
  console.log(`${String(t.id).padStart(2)} ${String(t.title).padEnd(22)} `
    + `${String(t.grown).padStart(2)} of ${String(t.of).padStart(2)} bars became terrain`);
}

const stillBars = levels.value.filter(l => {
  const s = l.platforms.filter(p => isSolidType(p.type) && p.type !== 'moving');
  return s.length && s.filter(p => p.height <= THIN).length / s.length >= 0.7;
});

console.log(`\n${changed} platform(s) across ${touched.length} level(s).`);
console.log(`levels still made mostly of floating bars: ${stillBars.length} `
  + `(${stillBars.map(l => l.id).join(', ') || 'none'})`);

const broken = levels.value.filter(l => !analyse(l).ok);
if (broken.length) {
  console.error(`REFUSING TO WRITE: ${broken.length} level(s) unsolvable.`);
  process.exit(1);
}

if (process.argv.includes('--write')) {
  writeFileSync(path, src.slice(0, levels.from) + JSON.stringify(levels.value) + src.slice(levels.to));
  console.log('levels.js written.');
} else {
  console.log('(dry run — pass --write to apply)');
}
