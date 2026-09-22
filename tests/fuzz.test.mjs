// Invariant fuzzing: drive every shipped level with pseudo-random input and
// assert the simulation never breaks its own rules.
//
// This is the net that catches geometry glitches — clipping into walls, NaN
// velocities, the player escaping the level — which are easy to miss by eye and
// impossible to cover with hand-written cases.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCanvas, advance, resetClock } from './harness.mjs';
import { Game, LEVELS, ALL, isSolidType, rng, KEYS, overlaps, penetration, runLevel } from './fuzz-helpers.mjs';

test('no level produces a geometry or numeric glitch under random input', () => {
  const failures = [];
  for (const level of LEVELS) {
    for (const seed of [1, 7]) {
      const { problems } = runLevel(level, seed);
      if (problems.length) {
        failures.push(`level ${level.id} "${level.title}" seed ${seed}: ${problems[0]}`);
      }
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

test('the simulation stays stable when the player is spawned inside a wall', () => {
  // Defensive: a custom level can easily place the start marker inside geometry.
  const level = {
    id: 'stuck', title: 'Stuck', width: 1200, height: 600, background: '#000',
    theme: 'horizontal', physics: {}, vehicles: [], powerups: [],
    startPos: { x: 200, y: 300 },
    goalPos: { x: 1000, y: 460 },
    foodPos: { x: 240, y: 300 },
    platforms: [
      { x: 0, y: 500, width: 1200, height: 100, type: 'static' },
      { x: 180, y: 280, width: 200, height: 200, type: 'static' }, // swallows the spawn
    ],
  };
  const { problems } = runLevel(level, 99, 300);
  const fatal = problems.filter(p => p.includes('is NaN') || p.includes('is Infinity'));
  assert.deepEqual(fatal, [], problems.join('\n'));
});

test('extreme per-level physics do not destabilise the loop', () => {
  const base = {
    id: 'x', title: 'Extreme', width: 2000, height: 800, background: '#000',
    theme: 'horizontal', vehicles: [], powerups: [],
    startPos: { x: 100, y: 400 }, goalPos: { x: 1900, y: 660 }, foodPos: { x: 140, y: 400 },
    platforms: [{ x: 0, y: 700, width: 2000, height: 100, type: 'static' }],
  };
  const extremes = [
    { gravityScale: 0.05 }, { gravityScale: 4 },
    { moveSpeedScale: 0.1 }, { moveSpeedScale: 4 },
    { jumpForceScale: 0.2 }, { jumpForceScale: 3 },
    { windX: -4 }, { windX: 4 },
    { friction: 0.2 }, { friction: 0.999 },
  ];
  for (const physics of extremes) {
    const { problems } = runLevel({ ...base, physics }, 5, 400);
    assert.deepEqual(problems, [], `physics ${JSON.stringify(physics)}:\n${problems.join('\n')}`);
  }
});

