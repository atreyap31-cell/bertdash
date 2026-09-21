// Does the campaign actually need the bag?
//
// Runs the reachability search twice per level: once with every move, once
// with the bag removed — no bag bounce, no delivery by throw. A level that
// still finishes on the second run can be cleared on legs alone, which means
// the throw is decoration there rather than a mechanic.
//
// Usage: node tools/bag-audit.mjs [--verbose]

import { installGlobals } from '../tests/harness.mjs';
installGlobals();

const { LEVELS, TRAINING } = await import('../js/data/levels.js');
const { analyse, FOOT_RISE, BAG_RISE, MARGIN } = await import('./reach.mjs');

const verbose = process.argv.includes('--verbose');

const rows = [];
for (const level of LEVELS) {
  const full = analyse(level);
  const onFoot = analyse(level, { bag: false });
  rows.push({
    id: level.id,
    title: level.title,
    solvable: full.ok,
    needsBag: !onFoot.ok,
    onFootReach: onFoot.reached ?? 0,
  });
}

const needing = rows.filter(r => r.needsBag);
const optional = rows.filter(r => !r.needsBag);
const broken = rows.filter(r => !r.solvable);

console.log(`Campaign levels: ${rows.length}`);
console.log(`  require the bag:        ${needing.length}`);
console.log(`  clearable without it:   ${optional.length}`);
if (broken.length) console.log(`  NOT SOLVABLE AT ALL:    ${broken.length}`);
console.log('');
console.log(`A gate only the bag clears needs a rise above ${FOOT_RISE + MARGIN}px`);
console.log(`(the best jump on foot) and at most ${BAG_RISE}px, with no wall beside it.`);

if (verbose) {
  console.log('\nClearable without the bag:');
  for (const r of optional) console.log(`  ${String(r.id).padEnd(4)} ${r.title}`);
  if (broken.length) {
    console.log('\nNot solvable at all:');
    for (const r of broken) console.log(`  ${String(r.id).padEnd(4)} ${r.title}`);
  }
}

console.log(`\nTraining lessons are exempt: they teach one move each.`);
console.log(`(${TRAINING.length} lessons, not audited here.)`);
