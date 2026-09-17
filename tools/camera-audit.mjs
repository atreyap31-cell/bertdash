// Measures how violently the camera moves. Shake is jerk: sudden changes in
// camera velocity. A smooth camera has small, consistent frame-to-frame deltas.
import { installGlobals, makeCanvas, advance, resetClock } from '../tests/harness.mjs';
installGlobals();
const { Game } = await import('../js/engine/game.js');
const { LEVELS } = await import('../js/data/levels.js');

function run(level, script) {
  resetClock();
  const game = new Game(makeCanvas({ record: false }), level, {
    skin: { color: '#0c6', textColor: '#fff' }, onWin(){}, onLose(){}, onStats(){},
  });
  game.start();
  const down = c => globalThis.dispatchWindow('keydown', { code: c, repeat: false, preventDefault(){} });
  const up = c => globalThis.dispatchWindow('keyup', { code: c });

  let prevX = game.camera.x, prevVX = 0;
  let maxJerk = 0, totalJerk = 0, frames = 0;
  const sample = () => {
    const vx = game.camera.x - prevX;
    const jerk = Math.abs(vx - prevVX);
    maxJerk = Math.max(maxJerk, jerk);
    totalJerk += jerk;
    frames++;
    prevX = game.camera.x;
    prevVX = vx;
  };
  script({ game, down, up, step: n => { for (let i=0;i<n;i++) { advance(1); sample(); } } });
  game.destroy();
  return { maxJerk, avgJerk: totalJerk / Math.max(1, frames) };
}

const level = LEVELS[2];

// Run, then stop dead — the worst case for a velocity-driven camera.
const startStop = run(level, ({ down, up, step }) => {
  step(40);
  for (let i = 0; i < 6; i++) { down('KeyD'); step(35); up('KeyD'); step(25); }
});

// Rapid direction changes.
const weaving = run(level, ({ down, up, step }) => {
  step(40);
  for (let i = 0; i < 8; i++) { down('KeyD'); step(18); up('KeyD'); down('KeyA'); step(18); up('KeyA'); }
});

// Steady run, the baseline.
const steady = run(level, ({ down, up, step }) => {
  step(40); down('KeyD'); step(220); up('KeyD');
});

console.log('camera jerk (px/frame^2) — lower is smoother\n');
for (const [name, r] of Object.entries({ steady, startStop, weaving })) {
  console.log(`  ${name.padEnd(11)} max ${r.maxJerk.toFixed(2).padStart(7)}   avg ${r.avgJerk.toFixed(3)}`);
}
