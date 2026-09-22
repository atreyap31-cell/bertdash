// Does a level actually make you do what it says?
//
// The training lessons each teach one move and claim you cannot finish without
// it. The campaign makes the same claim implicitly with crawl spaces and wide
// gaps. Neither claim was ever checked, and several of them are false: the
// throw lesson can be jumped, and low gaps meant to force a slide can be
// cleared over the top.
//
// This runs the route search with one move removed at a time. If the level
// still finishes without the move it is supposed to teach, the level is not
// teaching it.
//
// Usage: node tools/gate-audit.mjs [--verbose]

import { installGlobals } from '../tests/harness.mjs';
installGlobals();

const { LEVELS, TRAINING } = await import('../js/data/levels.js');
const { analyse } = await import('./reach.mjs');

/** What each lesson claims to be about, and the moves that would bypass it. */
const LESSON_MOVES = {
  't-move': null,                       // teaches running; nothing to gate
  't-air': 'airJump',
  't-slide': 'longJump',
  't-wall': 'wallClimb',
  't-throw': 'bag',
  't-bounce': 'bag',
  't-dive': 'dive',
  't-hazard': null,                     // teaches hazards, not a move
};

const verbose = process.argv.includes('--verbose');

function requires(level, without) {
  return !analyse(level, without).ok;
}

console.log('Training lessons\n');
for (const lesson of TRAINING) {
  const move = LESSON_MOVES[lesson.id];
  if (!move) {
    console.log(`  ${lesson.id.padEnd(10)} ${lesson.teaches.padEnd(30)} (no move to gate)`);
    continue;
  }
  const gated = requires(lesson, { [move]: false });
  console.log(`  ${lesson.id.padEnd(10)} ${lesson.teaches.padEnd(30)} `
    + `${gated ? 'requires it' : 'CAN BE SKIPPED'}`);
}

console.log('\nCampaign');
const skippable = { bag: [], airJump: [], wallClimb: [] };
for (const level of LEVELS) {
  if (!analyse(level).ok) continue;
  for (const move of Object.keys(skippable)) {
    if (!requires(level, { [move]: false })) skippable[move].push(level.id);
  }
}
for (const [move, ids] of Object.entries(skippable)) {
  console.log(`  ${move.padEnd(10)} not required by ${ids.length}/${LEVELS.length} levels`);
  if (verbose && ids.length) console.log(`      ${ids.join(', ')}`);
}
