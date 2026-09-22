// The second half of the fuzzing: the hand-aimed invariants rather than the
// random-input sweep. Split from fuzz.test.mjs so neither process carries the
// whole workload — see tools/run-tests.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCanvas, advance, resetClock } from './harness.mjs';
import { Game, ALL, isSolidType, rng, KEYS, overlaps, penetration, runLevel } from './fuzz-helpers.mjs';

test('sliding into a low tunnel and standing up must not clip the ceiling', () => {
  // A 30px gap: tall enough to slide through (26px), too short to stand in
  // (48px). The player must stay crouched instead of growing into the roof.
  const ROOF = { x: 300, y: 380, width: 500, height: 90, type: 'static' };
  const level = {
    id: 'crawl', title: 'Crawl', width: 1400, height: 600, background: '#000',
    theme: 'horizontal', physics: {}, vehicles: [], powerups: [],
    startPos: { x: 120, y: 440 },
    goalPos: { x: 1300, y: 460 },
    foodPos: { x: 150, y: 440 },
    platforms: [{ x: 0, y: 500, width: 1400, height: 100, type: 'static' }, ROOF],
  };

  resetClock();
  const canvas = makeCanvas({ record: false });
  const game = new Game(canvas, level, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  game.start();

  const down = code => globalThis.dispatchWindow('keydown', { code, repeat: false, preventDefault() {} });
  const up = code => globalThis.dispatchWindow('keyup', { code });

  advance(40);                       // settle on the floor
  down('KeyD');
  advance(14);                       // build up speed toward the tunnel mouth
  down('KeyS'); advance(1); up('KeyS');  // slide in

  let enteredTunnel = false;
  const worst = { depth: 0, frame: -1, height: 0 };

  for (let frame = 0; frame < 220; frame++) {
    advance(1);
    const p = game.player;
    // "Inside the tunnel" means horizontally within the roof's span.
    if (p.x > ROOF.x + 20 && p.x + p.width < ROOF.x + ROOF.width - 20) enteredTunnel = true;
    if (overlaps(p, ROOF)) {
      const depth = penetration(p, ROOF);
      if (depth > worst.depth) { worst.depth = depth; worst.frame = frame; worst.height = p.height; }
    }
    // Keep trying to stand up while under the roof.
    if (frame % 30 === 0) { down('KeyS'); advance(1); up('KeyS'); }
  }
  up('KeyD');
  game.destroy();

  assert.ok(enteredTunnel, 'the player never reached the tunnel, so this test proved nothing');
  assert.ok(worst.depth <= 4,
    `player clipped ${worst.depth.toFixed(1)}px into the ceiling at frame ${worst.frame} `
    + `(height ${worst.height})`);
});

test('standing still at the spawn is survivable in every level', () => {
  // The strongest form of the check: actually run each level for two seconds
  // with no input at all, and make sure nothing kills you.
  const deaths = [];
  for (const raw of ALL) {
    resetClock();
    const canvas = makeCanvas({ record: false });
    let cause = null;
    const game = new Game(canvas, raw, {
      skin: { color: '#06c167', textColor: '#fff' },
      onWin: () => {}, onLose: reason => { cause ??= reason; }, onStats: () => {},
    });
    game.start();
    advance(150);                      // ~2.5 seconds of doing nothing
    game.destroy();
    if (cause) deaths.push(`level ${raw.id} "${raw.title}" died doing nothing: ${cause}`);
  }
  assert.deepEqual(deaths, [], `\n${deaths.join('\n')}`);
});
