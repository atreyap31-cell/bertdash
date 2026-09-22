// Generates the training levels and writes them into js/data/levels.js as
// TRAINING, separate from the campaign so adding one never shifts a level
// index (which would orphan every saved best time).
//
// Each one teaches exactly one move and cannot be finished without it, with
// hint zones that say what to press at the moment it matters.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const solid = (x, y, width, height = 200) => ({ x, y, width, height, type: 'static' });
const ledge = (x, y, width = 160) => ({ x, y, width, height: 20, type: 'static' });
const wall = (x, y, height, width = 40) => ({ x, y, width, height, type: 'static' });
const spikes = (x, y, width) => ({ x, y, width, height: 20, type: 'spike' });
const hint = (x, y, text, width = 460, height = 340) => ({ x, y, width, height, text });
const pickup = (type, x, y) => ({ id: `pu-${type}-${x}`, type, pos: { x, y }, width: 30, height: 30 });

function lesson(id, title, teaches, body) {
  return {
    id, title, teaches, description: teaches,
    isFinalLevel: false, vehicles: [], powerups: [], physics: {}, hints: [], ...body,
  };
}

const TRAINING = [];

TRAINING.push(lesson('t-move', 'Getting Around', 'Run and jump', {
  width: 2600, height: 700, theme: 'horizontal', background: '#1f2937',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 }, goalPos: { x: 2440, y: 450 },
  platforms: [solid(0, 500, 700), solid(940, 500, 640), solid(1820, 500, 780)],
  hints: [
    hint(40, 260, 'A and D run. Space jumps. You are carrying Bert’s order — get it to him.'),
    hint(640, 260, 'Hold Space for a higher jump. Let go early to cut it short.'),
    hint(1520, 260, 'Bert is at the end of every level. Reach him holding the bag.'),
  ],
}));

TRAINING.push(lesson('t-air', 'Second Wind', 'The air jump', {
  width: 3000, height: 700, theme: 'horizontal', background: '#111827',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 }, goalPos: { x: 2840, y: 450 },
  platforms: [
    solid(0, 500, 560),
    // 200px up each time. A run jump manages 179 and a long jump only 135, so
    // height is what forces the second jump — a wide gap never did, because a
    // long jump clears 712px of it and a dive clears 816.
    ledge(760, 300, 220),
    ledge(1180, 300, 220),
    ledge(1600, 300, 220),
    solid(2020, 500, 980),
    spikes(580, 680, 1420),
  ],
  hints: [
    hint(40, 240, 'These shelves are too high for one jump. Press Space <b>again in mid-air</b> for a second one.'),
    hint(700, 60, 'Steer while you air-jump and it sends you that way too.'),
  ],
}));

TRAINING.push(lesson('t-slide', 'Low Bridge', 'Sliding and the long jump', {
  width: 3400, height: 700, theme: 'horizontal', background: '#1c1917',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 }, goalPos: { x: 3240, y: 450 },
  platforms: [
    solid(0, 500, 1500),
    // Tall, not a lintel. At 90px high you could simply jump onto the top of
    // it and walk over, which is what made the lesson optional; from the floor
    // a jump reaches 179px, so a block rising 260px cannot be climbed.
    solid(700, 240, 500, 230),
    solid(2100, 500, 1300),
    spikes(1520, 680, 560),
  ],
  hints: [
    hint(40, 240, 'That gap is too low to stand in. Press <b>S</b> to slide under it.'),
    hint(1180, 240, 'Now slide again, and press <b>Space</b> while sliding: a long jump, far further than a normal one.'),
  ],
}));

TRAINING.push(lesson('t-wall', 'Up The Shaft', 'Wall kicks', {
  width: 800, height: 1300, theme: 'vertical', background: '#0f172a',
  startPos: { x: 360, y: 1172 }, foodPos: { x: 400, y: 1172 }, goalPos: { x: 400, y: 380 },
  platforms: [
    solid(0, 1220, 800, 80),
    // A 720px shaft: comfortably inside the ~1000px a chain of kicks covers,
    // so the climb actually reaches the top rather than stalling halfway.
    wall(140, 500, 720, 60),
    wall(600, 500, 720, 60),
    solid(280, 420, 240, 40),
  ],
  physics: { wallSlideEnabled: true },
  hints: [
    hint(80, 940, 'Jump at a wall and you cling to it. Press <b>Space</b> to kick off — then do it again on the other side.', 640, 280),
    hint(80, 600, 'Every kick hands your air jump back, so a shaft like this has no ceiling.', 640, 300),
  ],
}));

TRAINING.push(lesson('t-throw', 'The Bag', 'Aiming and throwing', {
  width: 3200, height: 800, theme: 'horizontal', background: '#0c4a6e',
  startPos: { x: 90, y: 552 }, foodPos: { x: 130, y: 552 }, goalPos: { x: 2900, y: 300 },
  platforms: [
    solid(0, 600, 900),
    solid(1500, 600, 700),
    // Bert sits 260px up. Every move on foot tops out at 223 (the air jump),
    // so the only ways onto that ledge are a bag bounce or landing the throw
    // on him — both of which are the bag. He used to be 140px up, which any
    // jump cleared, so the lesson could be walked past.
    solid(2700, 340, 500, 460),
    spikes(920, 780, 560),
  ],
  powerups: [pickup('magnet', 400, 540), pickup('magnet', 1700, 540)],
  hints: [
    hint(40, 320, 'The <b>arrow keys</b> throw the bag. Hold one to aim and charge, let go to throw. Two together throws diagonally.'),
    hint(560, 320, 'Watch the dotted arc — that is exactly where it will land. If the bag hits a floor, the delivery is over.'),
    hint(1480, 300, 'Those orange pickups are magnets: they pull a loose bag back to you.'),
    hint(2400, 200, 'Bert is too high to climb to. Throw the bag straight at him.', 520, 420),
  ],
}));

TRAINING.push(lesson('t-bounce', 'Up And Over', 'The bag bounce', {
  width: 3000, height: 1100, theme: 'horizontal', background: '#312e81',
  startPos: { x: 90, y: 852 }, foodPos: { x: 130, y: 852 }, goalPos: { x: 2800, y: 300 },
  platforms: [
    solid(0, 900, 800),
    ledge(1000, 620, 260),      // 280 up: no jump reaches this
    ledge(1600, 620, 260),
    ledge(2200, 620, 260),
    solid(2600, 360, 400, 740),
    spikes(820, 1080, 1760),
  ],
  powerups: [pickup('magnet', 300, 840), pickup('magnet', 1060, 560)],
  hints: [
    hint(40, 520, 'This shelf is higher than any jump. Throw the bag <b>straight up</b>, stay under it, jump after it and catch it in mid-air.', 560, 360),
    hint(940, 300, 'That catch launches you higher than you can jump — and gives your air jump back.', 520, 300),
    hint(1560, 300, 'Same again. The bag goes exactly where you point it, so stand where it will come down.', 520, 300),
    hint(2160, 300, 'Last one, and Bert is up on the ledge above.', 520, 300),
  ],
}));

TRAINING.push(lesson('t-dive', 'Recovery', 'Diving after a bad throw', {
  width: 3400, height: 900, theme: 'horizontal', background: '#3b0764',
  startPos: { x: 90, y: 652 }, foodPos: { x: 130, y: 652 }, goalPos: { x: 3240, y: 650 },
  platforms: [
    solid(0, 700, 1100),
    solid(1800, 700, 700),
    solid(2900, 700, 500),
    spikes(1120, 880, 660),
    spikes(2520, 880, 360),
  ],
  hints: [
    hint(40, 400, 'Press <b>E</b> to dive. With the bag in hand it is a flat dash the way you are facing.'),
    hint(700, 380, 'Throw the bag across the gap, then press <b>E</b>: the dive chases whatever you threw.', 520, 340),
    hint(1760, 380, 'Land a dive fast enough and you rebound off the ground instead of stopping.', 520, 320),
  ],
}));

TRAINING.push(lesson('t-hazard', 'The Floor Is Not Your Friend', 'Hazards, shields and flow', {
  width: 3600, height: 700, theme: 'horizontal', background: '#450a0a',
  startPos: { x: 90, y: 452 }, foodPos: { x: 130, y: 452 }, goalPos: { x: 3440, y: 450 },
  platforms: [
    solid(0, 500, 3600),
    { x: 900, y: 220, width: 10, height: 280, type: 'laser', interval: 2000, offset: 0 },
    { x: 1500, y: 220, width: 10, height: 280, type: 'laser', interval: 2000, offset: 700 },
    { x: 2100, y: 220, width: 10, height: 280, type: 'laser', interval: 2000, offset: 1400 },
    spikes(2600, 480, 300),
  ],
  powerups: [pickup('shield', 600, 440), pickup('speed', 1800, 440)],
  hints: [
    hint(40, 240, 'Lasers cycle on and off. Time them. A <b>shield</b> absorbs one hit — but never a dropped bag.'),
    hint(2400, 240, 'Chaining moves builds <b>flow</b>, shown on the left. It multiplies your tips, so moving well pays.'),
  ],
}));

// --- write into levels.js --------------------------------------------------

const path = join(ROOT, 'js/data/levels.js');
const src = readFileSync(path, 'utf8');

// Find a previously written block by index rather than by pattern.
//
// This used to strip it with a regex anchored on "\n". Git rewrites this file
// with CRLF on checkout, at which point the pattern quietly matched nothing and
// the generator appended a *second* `export const TRAINING`, leaving a file
// that would not parse. Indexes do not care about line endings.
const HEADER = '// Training: short lessons';
const MARKER = 'export const CAMPAIGN_LENGTH';

const markerAt = src.indexOf(MARKER);
if (markerAt < 0) throw new Error('levels.js has no CAMPAIGN_LENGTH to write before');

const existingAt = src.indexOf(HEADER);
const head = src.slice(0, existingAt >= 0 && existingAt < markerAt ? existingAt : markerAt);

const block = `// Training: short lessons, one move each, kept out of the campaign numbering so
// adding one never shifts a level index and orphans saved best times.
export const TRAINING = ${JSON.stringify(TRAINING)};

`;

writeFileSync(path, head + block + src.slice(markerAt));
console.log(`wrote ${TRAINING.length} training levels`);
for (const t of TRAINING) console.log(`  ${t.id.padEnd(10)} ${t.title.padEnd(28)} ${t.teaches}`);
