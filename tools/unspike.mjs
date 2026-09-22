// Leaves somewhere to land on platforms that are entirely covered in spikes.
//
// FREE FALL had eleven of them: every surface for 3,100px was lethal, so the
// level was one continuous fall threading twelve alternating slots. Measured in
// the engine, falling the 260px between its rows buys about 430px of sideways
// reach, and the level asks for 520. It was not hard, it was impossible, and
// the route search never noticed because it treats hazards as thin air.
//
// The repair leaves a landing strip on each covered platform, on the side under
// the gap above it, so the descent becomes land-reposition-drop rather than one
// unbroken thread.
//
// Usage: node tools/unspike.mjs [--write]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installGlobals } from '../tests/harness.mjs';

installGlobals();
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
const training = slice('TRAINING');

const LETHAL = new Set(['spike', 'laser']);

/** A strip this wide is somewhere you can actually stand and set off from. */
const STRIP = 200;

/** Hazards that cover the whole standable top of a platform. */
function coverings(level, plat) {
  return level.platforms.filter(q => LETHAL.has(q.type)
    && q.x <= plat.x + 2 && q.x + q.width >= plat.x + plat.width - 2
    && q.y + q.height >= plat.y - 6 && q.y <= plat.y + 8);
}

let repaired = 0;
const touched = [];

for (const level of [...levels.value, ...training.value]) {
  let fixed = 0;
  for (const plat of level.platforms) {
    if (!isSolidType(plat.type) || plat.type === 'moving') continue;
    if (plat.width < STRIP + 60) continue;
    const covers = coverings(level, plat);
    if (!covers.length) continue;

    // The landing zone is where this platform sits under the opening in the
    // row above — that is where you arrive, having walked off that row's edge.
    // A fixed strip on one side is not good enough: you come down at the edge,
    // not at the far end.
    const above = level.platforms
      .filter(q => isSolidType(q.type) && q.type !== 'moving' && q.y < plat.y - 40)
      .sort((a2, b2) => b2.y - a2.y)[0];

    const right = plat.x + plat.width;
    let zoneStart = plat.x;
    let zoneEnd = right;
    if (above) {
      const aboveEnd = above.x + above.width;
      // The wider of the two openings either side of the row above.
      const gap = (level.width - aboveEnd) >= above.x
        ? [aboveEnd, level.width]
        : [0, above.x];
      zoneStart = Math.max(plat.x, gap[0]);
      zoneEnd = Math.min(right, gap[1]);
      if (zoneEnd - zoneStart < STRIP) { zoneStart = plat.x; zoneEnd = right; }
    }
    const safeStart = Math.max(plat.x, Math.min(zoneStart, right - STRIP));
    const safeEnd = Math.min(right, safeStart + Math.max(STRIP, zoneEnd - zoneStart));

    for (const hazard of covers) {
      // Spikes take whichever side of the landing zone is larger; the zone
      // itself is left clear.
      if (safeStart - plat.x >= right - safeEnd) {
        hazard.x = plat.x;
        hazard.width = Math.max(30, safeStart - plat.x);
      } else {
        hazard.x = safeEnd;
        hazard.width = Math.max(30, right - safeEnd);
      }
      fixed++;
    }
  }
  if (fixed) { repaired += fixed; touched.push({ id: level.id, title: level.title, fixed }); }
}

for (const t of touched) {
  console.log(`${String(t.id).padEnd(5)} ${String(t.title).padEnd(22)} ${t.fixed} spike run(s) cut back`);
}
console.log(`\n${repaired} across ${touched.length} level(s); every covered platform now has a ${STRIP}px landing strip.`);

// Nothing should still be fully covered.
let left = 0;
for (const level of [...levels.value, ...training.value]) {
  for (const plat of level.platforms) {
    if (!isSolidType(plat.type) || plat.type === 'moving') continue;
    if (plat.width < STRIP + 60) continue;
    if (coverings(level, plat).length) left++;
  }
}
if (left) { console.error(`REFUSING TO WRITE: ${left} platform(s) still fully covered.`); process.exit(1); }

if (process.argv.includes('--write')) {
  writeFileSync(path, src.slice(0, levels.from) + JSON.stringify(levels.value)
    + src.slice(levels.to, training.from) + JSON.stringify(training.value)
    + src.slice(training.to));
  console.log('levels.js written.');
} else {
  console.log('(dry run — pass --write to apply)');
}
