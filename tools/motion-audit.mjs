// Hunts for discontinuities in the player's motion.
//
// "Weird movement" almost always means the player moved further in one frame
// than their velocity accounts for, or their velocity changed by more than any
// force should have applied. This drives every level with random input and
// reports the worst offenders, with the state that produced them.

import { installGlobals, makeCanvas, advance, resetClock } from '../tests/harness.mjs';
installGlobals();

const { Game } = await import('../js/engine/game.js');
const { LEVELS } = await import('../js/data/levels.js');
const { PHYSICS } = await import('../js/data/config.js');

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}

const KEYS = ['KeyA', 'KeyD', 'Space', 'KeyS', 'KeyE', 'KeyQ', 'ShiftLeft',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

// A frame may legitimately move the player by their velocity plus whatever a
// moving platform carried them. Anything well past that is a teleport.
const POS_SLACK = 14;
// Velocity may change by gravity, or by a deliberate impulse (jump, dive,
// bounce). Those are all flagged and then filtered by whether an impulse fired.
const VEL_SLACK = 3;

const findings = [];

function audit(levelSource, seed, frames = 700) {
  resetClock();
  const canvas = makeCanvas({ record: false });
  let dead = false;
  const game = new Game(canvas, levelSource, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: () => { dead = true; },
    onLose: () => { dead = true; },
    onStats: () => {},
  });
  game.start();

  const random = rng(seed);
  const held = new Set();
  let prev = null;

  for (let frame = 0; frame < frames && !dead; frame++) {
    if (frame % 6 === 0) {
      const key = KEYS[Math.floor(random() * KEYS.length)];
      if (held.has(key)) { held.delete(key); globalThis.dispatchWindow('keyup', { code: key }); }
      else { held.add(key); globalThis.dispatchWindow('keydown', { code: key, repeat: false, preventDefault() {} }); }
    }

    const before = snapshot(game);
    advance(1);
    const after = snapshot(game);

    // While the death animation plays the player is deliberately frozen with
    // their velocity intact; that is not a movement anomaly.
    if (prev && !game.deathReason && !game.finished) {
      // Expected travel: the velocity we had going in, plus a platform ride.
      const carried = before.groundPlat
        ? Math.abs(before.groundPlat.deltaX) + Math.abs(before.groundPlat.conveyorVel ?? 0)
        : 0;
      // Measure the feet, not the top-left: a slide resizes the box on purpose,
      // which moves p.y without the player actually going anywhere.
      const movedX = Math.abs(after.x - before.x);
      const movedY = Math.abs((after.y + after.height) - (before.y + before.height));
      // An impulse (jump, dive, bounce) sets the velocity that then applies in
      // the same frame, so the larger of the two velocities explains the move.
      const allowedX = Math.max(Math.abs(before.vx), Math.abs(after.vx)) + carried + POS_SLACK;
      const allowedY = Math.max(Math.abs(before.vy), Math.abs(after.vy))
        + Math.abs(before.groundPlat?.deltaY ?? 0) + POS_SLACK;

      if (movedX > allowedX) {
        findings.push({
          kind: 'x-teleport', level: levelSource.id, seed, frame,
          moved: movedX.toFixed(1), allowed: allowedX.toFixed(1),
          state: describe(before, after),
        });
      }
      if (movedY > allowedY) {
        findings.push({
          kind: 'y-teleport', level: levelSource.id, seed, frame,
          moved: movedY.toFixed(1), allowed: allowedY.toFixed(1),
          state: describe(before, after),
        });
      }
      // Stuck: real speed going in, almost no movement out, and not against a
      // wall on purpose. This is what "caught on the scenery" feels like.
      // Pressing into a wall is a legitimate stop; flag only the frames where
      // the player still has speed afterwards, i.e. they were held up without
      // the collision actually absorbing them.
      const absorbed = Math.abs(after.vx) < 0.01;
      if (Math.abs(before.vx) > 4 && movedX < 0.5 && !absorbed
          && !before.wallSliding && !after.wallSliding) {
        findings.push({
          kind: 'snagged', level: levelSource.id, seed, frame,
          moved: movedX.toFixed(2), allowed: `vx ${before.vx.toFixed(1)}`,
          state: describe(before, after),
        });
      }

      // A height change mid-air is the slide box resizing where it should not.
      if (before.height !== after.height && !before.grounded && !after.grounded) {
        findings.push({
          kind: 'airborne-resize', level: levelSource.id, seed, frame,
          moved: `${before.height}->${after.height}`, allowed: 'grounded only',
          state: describe(before, after),
        });
      }
    }
    prev = after;
  }
  game.destroy();
}

function snapshot(game) {
  const p = game.player;
  return {
    x: p.x, y: p.y, vx: p.vx, vy: p.vy,
    grounded: p.grounded, sliding: p.sliding, diving: p.diving,
    wallSliding: p.wallSliding, height: p.height,
    groundPlat: p.groundPlatform,
  };
}

function describe(before, after) {
  const flags = k => [
    k.grounded ? 'grounded' : 'air',
    k.sliding ? 'sliding' : '',
    k.diving ? 'diving' : '',
    k.wallSliding ? 'wall' : '',
  ].filter(Boolean).join('+');
  return `${flags(before)} -> ${flags(after)}`
    + ` | vy ${before.vy.toFixed(1)}->${after.vy.toFixed(1)}`
    + ` | h ${before.height}->${after.height}`;
}

for (const level of LEVELS) {
  for (const seed of [3, 11]) audit(level, seed);
}

console.log(`${findings.length} motion discontinuities\n`);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`${kind}: ${list.length}`);
  for (const f of list.slice(0, 6)) {
    console.log(`  level ${f.level} seed ${f.seed} frame ${f.frame}: `
      + `moved ${f.moved} (allowed ${f.allowed})  ${f.state}`);
  }
  console.log();
}
