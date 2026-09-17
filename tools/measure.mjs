// Measures what the player can actually do, by simulating the real engine.
// The numbers this prints are what the level generator designs against.

import { installGlobals, makeCanvas, advance, resetClock } from '../tests/harness.mjs';
installGlobals();

const { Game } = await import('../js/engine/game.js');

const FLOOR_Y = 600;
const START_X = 300;
const WIDTH = 8000;

function level(extra = {}) {
  return {
    id: 'm', title: 'Measure', width: WIDTH, height: 1400, background: '#000',
    theme: 'horizontal', physics: {}, vehicles: [], powerups: [],
    startPos: { x: START_X, y: FLOOR_Y - 48 },
    goalPos: { x: WIDTH - 60, y: 1350 },   // parked far away, never reached
    foodPos: { x: START_X + 30, y: FLOOR_Y - 48 },
    platforms: [{ x: 0, y: FLOOR_Y, width: WIDTH, height: 300, type: 'static' }],
    ...extra,
  };
}

function boot(lvl = level()) {
  resetClock();
  const canvas = makeCanvas({ record: false });
  const game = new Game(canvas, lvl, {
    skin: { color: '#06c167', textColor: '#fff' },
    onWin: () => {}, onLose: () => {}, onStats: () => {},
  });
  game.start();
  advance(40);                          // settle on the floor
  return game;
}

const down = c => globalThis.dispatchWindow('keydown', { code: c, repeat: false, preventDefault() {} });
const up = c => globalThis.dispatchWindow('keyup', { code: c });
const release = () => ['KeyD', 'KeyA', 'Space', 'KeyS', 'KeyE'].forEach(up);

/**
 * Runs `script`, then follows the arc from takeoff until the player lands
 * again. Returns the peak height gained and the horizontal ground covered
 * while airborne — i.e. the widest gap that jump can clear.
 */
function arc(script, { frames = 300 } = {}) {
  const game = boot();
  // Baseline is the ground the player is standing on before anything happens;
  // capturing it after the script has already run would start the measurement
  // mid-flight and report almost nothing.
  const groundY = game.player.y;
  let launchX = game.player.x;
  let airborneSeen = false;
  let peak = 0;
  let reach = 0;

  const sample = () => {
    const p = game.player;
    if (!p.grounded && !airborneSeen) { airborneSeen = true; launchX = p.x; }
    if (airborneSeen) {
      peak = Math.max(peak, groundY - p.y);
      reach = Math.max(reach, Math.abs(p.x - launchX));
    }
  };

  // The script drives input; sample after every step it takes.
  script(game, sample);

  for (let i = 0; i < frames; i++) {
    advance(1);
    sample();
    if (airborneSeen && game.player.grounded) break;
  }
  release();
  game.destroy();
  return { height: Math.round(peak), distance: Math.round(reach) };
}

/** advance() that samples each frame, for use inside a script. */
function step(sample, n) {
  for (let i = 0; i < n; i++) { advance(1); sample(); }
}

const results = {};

results.standingJump = arc((game, sample) => {
  down('Space'); step(sample, 16); up('Space');
});

results.runningJump = arc((game, sample) => {
  down('KeyD'); step(sample, 50);
  down('Space'); step(sample, 16); up('Space');
});

results.runJumpPlusAir = arc((game, sample) => {
  down('KeyD'); step(sample, 50);
  down('Space'); step(sample, 16); up('Space');
  step(sample, 14);
  down('Space'); step(sample, 2); up('Space');
});

results.longJump = arc((game, sample) => {
  down('KeyD'); step(sample, 70);
  down('KeyS'); step(sample, 1); up('KeyS');   // slide
  step(sample, 3);
  down('Space'); step(sample, 16); up('Space'); // long jump out of it
});

results.longJumpPlusAir = arc((game, sample) => {
  down('KeyD'); step(sample, 70);
  down('KeyS'); step(sample, 1); up('KeyS');
  step(sample, 3);
  down('Space'); step(sample, 16); up('Space');
  step(sample, 16);
  down('Space'); step(sample, 2); up('Space');
});

results.diveLaunch = arc((game, sample) => {
  down('KeyD'); step(sample, 50);
  down('Space'); step(sample, 10); up('Space');
  step(sample, 6);
  game.aim = { x: game.player.x + 900, y: game.player.y - 30 };
  down('KeyE'); step(sample, 1); up('KeyE');
});

// Bag bounce: throw the bag up, jump after it, catch it mid-air for a launch.
{
  const game = boot();
  const canvas = game.canvas;
  const groundY = game.player.y;
  const throwAt = (wx, wy) => {
    const ev = { clientX: wx - game.camera.x, clientY: wy - game.camera.y, preventDefault() {} };
    canvas.dispatch('pointermove', ev);
    canvas.dispatch('pointerdown', ev);
    canvas.dispatch('pointerup', ev);
  };

  down('KeyD'); advance(40);
  // Lob the bag up and slightly ahead.
  throwAt(game.player.x + 40, game.player.y - 500);   // toss it straight up
  advance(12);
  down('Space'); advance(16); up('Space');           // jump into it

  let peak = 0;
  let bounced = false;
  const launchX = game.player.x;
  let reach = 0;
  for (let i = 0; i < 260; i++) {
    advance(1);
    peak = Math.max(peak, groundY - game.player.y);
    reach = Math.max(reach, Math.abs(game.player.x - launchX));
    if (game.player.hasFood && !bounced && i > 2) bounced = true;
    if (bounced && game.player.grounded) break;
  }
  release();
  game.destroy();
  results.bagBounce = { height: Math.round(peak), distance: Math.round(reach) };
}

// Bag bounce followed by an air jump: the highest the player can get.
{
  const game = boot();
  const canvas = game.canvas;
  const groundY = game.player.y;
  const throwAt = (wx, wy) => {
    const ev = { clientX: wx - game.camera.x, clientY: wy - game.camera.y, preventDefault() {} };
    canvas.dispatch('pointermove', ev);
    canvas.dispatch('pointerdown', ev);
    canvas.dispatch('pointerup', ev);
  };

  down('KeyD'); advance(40);
  throwAt(game.player.x + 40, game.player.y - 500);
  advance(12);
  down('Space'); advance(16); up('Space');

  let peak = 0;
  let usedAir = false;
  const launchX = game.player.x;
  let reach = 0;
  for (let i = 0; i < 300; i++) {
    advance(1);
    peak = Math.max(peak, groundY - game.player.y);
    reach = Math.max(reach, Math.abs(game.player.x - launchX));
    // Spend the refunded air jump once the bounce has fired and we're falling.
    if (!usedAir && game.player.hasFood && game.player.vy > 0 && i > 30) {
      down('Space'); advance(1); up('Space');
      usedAir = true;
    }
    if (usedAir && game.player.grounded) break;
  }
  release();
  game.destroy();
  results.bagBouncePlusAir = { height: Math.round(peak), distance: Math.round(reach) };
}

// Wall climb: how far up a shaft repeated kicks carry you.
{
  const shaft = level({
    platforms: [
      { x: 0, y: FLOOR_Y, width: WIDTH, height: 300, type: 'static' },
      { x: 700, y: -200, width: 60, height: 800, type: 'static' },
    ],
    startPos: { x: 560, y: FLOOR_Y - 48 },
  });
  const game = boot(shaft);
  const y0 = game.player.y;
  let peak = 0;
  down('KeyD');
  down('Space'); advance(14); up('Space');   // jump into the wall first
  for (let i = 0; i < 600; i++) {
    advance(1);
    peak = Math.max(peak, y0 - game.player.y);
    // Kick the moment the cling engages, then keep pressing into the wall.
    if (game.player.wallSliding) {
      down('Space'); advance(1); up('Space');
      advance(6);
      down('KeyD');
    }
  }
  release();
  game.destroy();
  results.wallClimb = { height: Math.round(peak), distance: 0 };
}

// Terminal running speed, for pacing.
{
  const game = boot();
  down('KeyD');
  advance(90);
  results.runSpeed = Math.round(Math.abs(game.player.vx) * 10) / 10;
  release();
  game.destroy();
}

console.log('Movement envelope (pixels):\n');
for (const [name, v] of Object.entries(results)) {
  if (typeof v === 'number') { console.log(`  ${name.padEnd(17)} ${v}`); continue; }
  console.log(`  ${name.padEnd(17)} rise ${String(v.height).padStart(4)}   gap ${String(v.distance).padStart(4)}`);
}
