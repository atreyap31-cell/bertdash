// Checks that no level drops you straight onto something lethal.
import { installGlobals } from '../tests/harness.mjs';
installGlobals();
const { LEVELS } = await import('../js/data/levels.js');
const { prepareLevel, isSolidType } = await import('../js/engine/level.js');

const PLAYER = { w: 32, h: 48 };
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;

// A little margin: landing drift and the spawn settling a frame or two.
const GRACE = 6;

const problems = [];
for (const raw of LEVELS) {
  const level = prepareLevel(raw);
  const box = {
    x: level.startPos.x - GRACE, y: level.startPos.y - GRACE,
    width: PLAYER.w + GRACE * 2, height: PLAYER.h + GRACE * 2,
  };

  for (const p of level.platforms) {
    if (p.type === 'spike' && overlaps(box, p)) {
      problems.push(`level ${raw.id} "${raw.title}": spawns on spikes at (${p.x},${p.y})`);
    }
    // Lasers cycle, so overlapping one at all means death within a second.
    if (p.type === 'laser' && overlaps(box, p)) {
      problems.push(`level ${raw.id} "${raw.title}": spawns inside a laser at (${p.x},${p.y})`);
    }
    if (p.type === 'door' && p.height > 24 && overlaps(box, p)) {
      problems.push(`level ${raw.id} "${raw.title}": spawns inside a door at (${p.x},${p.y})`);
    }
  }

  // Is there anything at all to land on below the spawn?
  const feet = level.startPos.y + PLAYER.h;
  const ground = level.platforms.filter(p =>
    isSolidType(p.type) &&
    level.startPos.x + PLAYER.w > p.x && level.startPos.x < p.x + p.width &&
    p.y >= feet - 4);
  if (!ground.length) {
    problems.push(`level ${raw.id} "${raw.title}": nothing below the spawn — straight into the void`);
  } else {
    // How far is the drop, and is the landing itself lethal?
    const nearest = ground.reduce((a, b) => (a.y <= b.y ? a : b));
    const drop = nearest.y - feet;
    if (drop > 400) {
      problems.push(`level ${raw.id} "${raw.title}": spawns ${Math.round(drop)}px above the nearest ground`);
    }
    const landing = { x: level.startPos.x, y: nearest.y - PLAYER.h, width: PLAYER.w, height: PLAYER.h };
    for (const p of level.platforms) {
      if ((p.type === 'spike' || p.type === 'laser') && overlaps(landing, p)) {
        problems.push(`level ${raw.id} "${raw.title}": the spot it falls onto is a ${p.type}`);
      }
    }
  }

  // The bag rides with you, but check it is not spawned inside geometry.
  const bag = { x: level.foodPos.x, y: level.foodPos.y, width: 26, height: 26 };
  for (const p of level.platforms) {
    if (p.type === 'spike' && overlaps(bag, p)) {
      problems.push(`level ${raw.id} "${raw.title}": the bag spawns on spikes`);
    }
  }
}

console.log(problems.length ? problems.join('\n') : 'no lethal spawns');
console.log(`\n${problems.length} problem(s) across ${LEVELS.length} levels`);
